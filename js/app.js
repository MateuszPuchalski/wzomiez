import { startCamera, stopCamera, isCameraRunning } from './camera.js';

const $ = id => document.getElementById(id);
const statusEl = $('status');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const video = $('video');
const chip = $('chip');

const COLORS = ['#34d399', '#fbbf24', '#f87171', '#a78bfa', '#38bdf8', '#fb923c', '#e879f9'];
const UNITS = {
  mm: { factor: 1, digits: 0, label: 'mm' },
  cm: { factor: 0.1, digits: 2, label: 'cm' },
  in: { factor: 1 / 25.4, digits: 2, label: 'in' },
};

const offscreen = document.createElement('canvas');
const offctx = offscreen.getContext('2d', { willReadFrequently: true });

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

function settings() {
  return {
    markerSizeMM: Math.max(5, Number($('marker-size').value) || 50),
    units: UNITS[$('units').value] || UNITS.cm,
  };
}

function fmt(mm, units) {
  return (mm * units.factor).toFixed(units.digits);
}

// ---------- worker ----------

const worker = new Worker('js/worker.js');
let workerBusy = false;
let seq = 0;
const jobs = new Map(); // seq -> {kind: 'upload'|'camera'}

function sendFrame(kind, sourceEl, width, height) {
  offscreen.width = width;
  offscreen.height = height;
  offctx.drawImage(sourceEl, 0, 0, width, height);
  const imageData = offctx.getImageData(0, 0, width, height);
  workerBusy = true;
  jobs.set(++seq, { kind });
  worker.postMessage({ type: 'frame', imageData, markerSizeMM: settings().markerSizeMM, seq });
}

worker.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'ready') {
    setStatus('Ready. Print a marker, put it next to your objects, and take a picture.', 'ok');
    wireUI();
    return;
  }
  const job = jobs.get(msg.seq);
  jobs.delete(msg.seq);
  workerBusy = false;
  if (msg.type === 'error') {
    setStatus(`Processing error: ${msg.message}`, 'error');
    return;
  }
  if (job?.kind === 'upload') onUploadResult(msg);
  else if (job?.kind === 'camera') onCameraResult(msg);
};

worker.onerror = e => setStatus(`Worker failed: ${e.message}`, 'error');

// ---------- rendering ----------

function drawQuad(pts, color, lineWidth) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawLabel(text, x, y, color, fontPx) {
  ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  const padX = fontPx * 0.4, padY = fontPx * 0.3;
  ctx.fillStyle = 'rgba(16, 24, 40, 0.85)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2 - padX, y - fontPx / 2 - padY, w + padX * 2, fontPx + padY * 2, fontPx * 0.3);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

function drawOverlay(marker, objects, opts) {
  const lineW = Math.max(2, canvas.width / 400);
  const fontPx = Math.max(13, Math.round(canvas.width / 45));
  if (marker) {
    drawQuad(marker.corners, '#3b82f6', lineW);
    const mc = marker.corners;
    drawLabel(`marker ${opts.markerSizeMM} mm`, (mc[0].x + mc[2].x) / 2, (mc[0].y + mc[2].y) / 2, '#93c5fd', fontPx * 0.85);
  }
  objects.forEach((obj, i) => {
    const color = COLORS[i % COLORS.length];
    drawQuad(obj.cornersImg, color, lineW);
    const cx = obj.cornersImg.reduce((s, p) => s + p.x, 0) / 4;
    const cy = obj.cornersImg.reduce((s, p) => s + p.y, 0) / 4;
    drawLabel(`${fmt(obj.widthMM, opts.units)} × ${fmt(obj.heightMM, opts.units)} ${opts.units.label}`, cx, cy, color, fontPx);
  });
}

function renderTable(marker, objects, opts) {
  const el = $('results');
  el.hidden = false;
  if (!marker) {
    el.innerHTML = `<h2>No marker found</h2>
      <p class="hint">Place a printed ArUco marker (4×4 dictionary) flat in the frame, on the same
      surface as the objects. <a class="marker-link" href="marker/marker.html" target="_blank">Print one here</a>.</p>`;
    return;
  }
  if (objects.length === 0) {
    el.innerHTML = `<h2>Marker found (id ${marker.id}) — no objects detected</h2>
      <p class="hint">Use a contrasting background and make sure objects don't touch the image edges.</p>`;
    return;
  }
  const u = opts.units;
  const rows = objects.map((o, i) => `<tr>
      <td><span class="swatch" style="background:${COLORS[i % COLORS.length]}"></span>Object ${i + 1}</td>
      <td>${fmt(o.widthMM, u)} ${u.label}</td>
      <td>${fmt(o.heightMM, u)} ${u.label}</td>
    </tr>`).join('');
  el.innerHTML = `<h2>Measurements (marker id ${marker.id}, ${opts.markerSizeMM} mm)</h2>
    <table><tr><th></th><th>Width</th><th>Height</th></tr>${rows}</table>`;
}

// ---------- upload mode ----------

let lastImage = null;

function processImageFile(file) {
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    lastImage = img;
    submitUpload();
  };
  img.onerror = () => setStatus('Could not read that image file.', 'error');
  img.src = URL.createObjectURL(file);
}

function submitUpload() {
  if (!lastImage || workerBusy) return;
  // Downscale very large photos for speed; measurements are scale-invariant.
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(lastImage.width, lastImage.height));
  sendFrame('upload', lastImage, Math.round(lastImage.width * scale), Math.round(lastImage.height * scale));
}

function onUploadResult(msg) {
  const opts = settings();
  canvas.width = offscreen.width;
  canvas.height = offscreen.height;
  ctx.drawImage(offscreen, 0, 0);
  canvas.hidden = false;
  drawOverlay(msg.marker, msg.objects, opts);
  renderTable(msg.marker, msg.objects, opts);
}

// ---------- camera mode: tracker with temporal smoothing ----------

const SMOOTH_ALPHA = 0.4;     // weight of the newest observation
const TRACK_TTL_MS = 600;     // drop boxes not re-detected within this window
const MATCH_DIST_FRAC = 0.15; // max match distance as a fraction of frame width

function centroid(pts) {
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

function lerpPts(oldPts, newPts, a) {
  return newPts.map((p, i) => ({
    x: oldPts[i].x * (1 - a) + p.x * a,
    y: oldPts[i].y * (1 - a) + p.y * a,
  }));
}

const tracker = {
  marker: null,       // {id, corners}
  markerSeen: 0,
  tracks: [],         // {cornersImg, widthMM, heightMM, lastSeen}

  update(msg, now) {
    if (msg.marker) {
      this.marker = this.marker
        ? { id: msg.marker.id, corners: lerpPts(this.marker.corners, msg.marker.corners, SMOOTH_ALPHA) }
        : msg.marker;
      this.markerSeen = now;
    } else if (now - this.markerSeen > TRACK_TTL_MS) {
      this.marker = null;
    }

    const maxDist = canvas.width * MATCH_DIST_FRAC;
    const unmatched = new Set(this.tracks);
    for (const obj of msg.objects) {
      const c = centroid(obj.cornersImg);
      let best = null, bestD = maxDist;
      for (const t of unmatched) {
        const tc = centroid(t.cornersImg);
        const d = Math.hypot(c.x - tc.x, c.y - tc.y);
        if (d < bestD) { best = t; bestD = d; }
      }
      if (best) {
        unmatched.delete(best);
        best.cornersImg = lerpPts(best.cornersImg, obj.cornersImg, SMOOTH_ALPHA);
        best.widthMM = best.widthMM * (1 - SMOOTH_ALPHA) + obj.widthMM * SMOOTH_ALPHA;
        best.heightMM = best.heightMM * (1 - SMOOTH_ALPHA) + obj.heightMM * SMOOTH_ALPHA;
        best.lastSeen = now;
      } else {
        this.tracks.push({ ...obj, lastSeen: now });
      }
    }
    this.tracks = this.tracks.filter(t => now - t.lastSeen < TRACK_TTL_MS);
  },

  reset() {
    this.marker = null;
    this.tracks = [];
  },
};

// ---------- camera mode: loops ----------

let cameraRafId = null;
let frozen = false;
let fpsEMA = 0;
let lastResultAt = 0;
let lastProcessingMs = 0;
let lastTableAt = 0;

function updateChip() {
  if (frozen) {
    chip.textContent = '❄ frozen';
    chip.className = 'chip frozen';
    return;
  }
  if (tracker.marker) {
    chip.textContent = `● marker · ${fpsEMA.toFixed(1)} fps · ${lastProcessingMs} ms`;
    chip.className = 'chip ok';
  } else {
    chip.textContent = `○ no marker · ${fpsEMA.toFixed(1)} fps`;
    chip.className = 'chip warn';
  }
}

function onCameraResult(msg) {
  if (!isCameraRunning() || frozen) return;
  const now = performance.now();
  if (lastResultAt) {
    const inst = 1000 / (now - lastResultAt);
    fpsEMA = fpsEMA ? fpsEMA * 0.8 + inst * 0.2 : inst;
  }
  lastResultAt = now;
  lastProcessingMs = msg.processingMs;
  tracker.update(msg, now);
  updateChip();
  if (now - lastTableAt > 500) {
    lastTableAt = now;
    renderTable(tracker.marker, tracker.tracks, settings());
  }
}

function cameraLoop() {
  cameraRafId = requestAnimationFrame(cameraLoop);
  if (video.videoWidth === 0) return;
  if (!frozen) {
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    drawOverlay(tracker.marker, tracker.tracks, settings());
    if (!workerBusy) sendFrame('camera', video, video.videoWidth, video.videoHeight);
  }
}

function setFrozen(state) {
  frozen = state;
  $('camera-freeze').textContent = frozen ? '▶ Resume' : '❄ Freeze';
  updateChip();
  if (frozen) renderTable(tracker.marker, tracker.tracks, settings());
}

async function onCameraStart() {
  try {
    await startCamera(video);
    $('camera-start').hidden = true;
    $('camera-stop').hidden = false;
    $('camera-freeze').hidden = false;
    canvas.hidden = false;
    chip.hidden = false;
    tracker.reset();
    fpsEMA = 0; lastResultAt = 0;
    setFrozen(false);
    setStatus('Camera running — point at objects next to the marker.', 'ok');
    cameraRafId = requestAnimationFrame(cameraLoop);
  } catch (err) {
    setStatus(`Camera unavailable: ${err.message}. Note: camera requires HTTPS (or localhost).`, 'error');
  }
}

function onCameraStop() {
  if (cameraRafId) cancelAnimationFrame(cameraRafId);
  cameraRafId = null;
  stopCamera(video);
  frozen = false;
  $('camera-start').hidden = false;
  $('camera-stop').hidden = true;
  $('camera-freeze').hidden = true;
  chip.hidden = true;
  setStatus('Camera stopped.', 'ok');
}

// ---------- UI wiring ----------

function switchTab(name) {
  $('tab-upload').classList.toggle('active', name === 'upload');
  $('tab-camera').classList.toggle('active', name === 'camera');
  $('upload-pane').hidden = name !== 'upload';
  $('camera-pane').hidden = name !== 'camera';
  if (name === 'upload' && isCameraRunning()) onCameraStop();
}

function reprocess() {
  if (!isCameraRunning()) submitUpload();
}

function wireUI() {
  $('tab-upload').addEventListener('click', () => switchTab('upload'));
  $('tab-camera').addEventListener('click', () => switchTab('camera'));

  $('file-input').addEventListener('change', e => {
    if (e.target.files[0]) processImageFile(e.target.files[0]);
  });
  const zone = $('drop-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) processImageFile(e.dataTransfer.files[0]);
  });

  $('camera-start').addEventListener('click', onCameraStart);
  $('camera-stop').addEventListener('click', onCameraStop);
  $('camera-freeze').addEventListener('click', () => setFrozen(!frozen));
  canvas.addEventListener('click', () => {
    if (isCameraRunning()) setFrozen(!frozen);
  });

  $('marker-size').addEventListener('change', reprocess);
  $('units').addEventListener('change', reprocess);

  document.querySelector('nav.tabs').hidden = false;
  document.querySelector('section.settings').hidden = false;
  document.querySelector('main').hidden = false;
}

// ---------- boot ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
setStatus('Loading OpenCV.js…', 'loading');
