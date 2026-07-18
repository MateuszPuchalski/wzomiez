import { initDetector } from './aruco.js';
import { measureImage } from './measure.js';
import { startCamera, stopCamera, isCameraRunning } from './camera.js';

const $ = id => document.getElementById(id);
const statusEl = $('status');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const video = $('video');

const COLORS = ['#34d399', '#fbbf24', '#f87171', '#a78bfa', '#38bdf8', '#fb923c', '#e879f9'];
const UNITS = {
  mm: { factor: 1, digits: 0, label: 'mm' },
  cm: { factor: 0.1, digits: 2, label: 'cm' },
  in: { factor: 1 / 25.4, digits: 2, label: 'in' },
};

let cv = null;
let cameraLoopId = null;
const offscreen = document.createElement('canvas');

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

function renderResult(source, result, opts) {
  canvas.width = source.width;
  canvas.height = source.height;
  ctx.drawImage(source.el, 0, 0, canvas.width, canvas.height);
  canvas.hidden = false;

  const lineW = Math.max(2, canvas.width / 400);
  const fontPx = Math.max(13, Math.round(canvas.width / 45));

  if (result.marker) {
    drawQuad(result.marker.corners, '#3b82f6', lineW);
    const mc = result.marker.corners;
    drawLabel(`marker ${opts.markerSizeMM} mm`, (mc[0].x + mc[2].x) / 2, (mc[0].y + mc[2].y) / 2, '#93c5fd', fontPx * 0.85);
  }

  result.objects.forEach((obj, i) => {
    const color = COLORS[i % COLORS.length];
    drawQuad(obj.cornersImg, color, lineW);
    const cx = obj.cornersImg.reduce((s, p) => s + p.x, 0) / 4;
    const cy = obj.cornersImg.reduce((s, p) => s + p.y, 0) / 4;
    const text = `${fmt(obj.widthMM, opts.units)} × ${fmt(obj.heightMM, opts.units)} ${opts.units.label}`;
    drawLabel(text, cx, cy, color, fontPx);
  });
}

function renderTable(result, opts) {
  const el = $('results');
  el.hidden = false;
  if (!result.marker) {
    el.innerHTML = `<h2>No marker found</h2>
      <p class="hint">Place a printed ArUco marker (4×4 dictionary) flat in the frame, on the same
      surface as the objects. <a class="marker-link" href="marker/marker.html" target="_blank">Print one here</a>.</p>`;
    return;
  }
  if (result.objects.length === 0) {
    el.innerHTML = `<h2>Marker found (id ${result.marker.id}) — no objects detected</h2>
      <p class="hint">Use a contrasting background and make sure objects don't touch the image edges.</p>`;
    return;
  }
  const u = opts.units;
  const rows = result.objects.map((o, i) => `<tr>
      <td><span class="swatch" style="background:${COLORS[i % COLORS.length]}"></span>Object ${i + 1}</td>
      <td>${fmt(o.widthMM, u)} ${u.label}</td>
      <td>${fmt(o.heightMM, u)} ${u.label}</td>
    </tr>`).join('');
  el.innerHTML = `<h2>Measurements (marker id ${result.marker.id}, ${opts.markerSizeMM} mm)</h2>
    <table><tr><th></th><th>Width</th><th>Height</th></tr>${rows}</table>`;
}

// ---------- processing ----------

function processSource(el, width, height) {
  offscreen.width = width;
  offscreen.height = height;
  offscreen.getContext('2d', { willReadFrequently: true }).drawImage(el, 0, 0, width, height);
  const rgba = cv.imread(offscreen);
  const opts = settings();
  try {
    const result = measureImage(cv, rgba, opts);
    renderResult({ el, width, height }, result, opts);
    renderTable(result, opts);
  } finally {
    rgba.delete();
  }
}

let lastImage = null;

function processImageFile(file) {
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);
    // Downscale very large photos for speed; measurements are scale-invariant.
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    lastImage = img;
    processSource(img, Math.round(img.width * scale), Math.round(img.height * scale));
  };
  img.onerror = () => setStatus('Could not read that image file.', 'error');
  img.src = URL.createObjectURL(file);
}

function reprocess() {
  if (isCameraRunning()) return; // camera loop picks up new settings automatically
  if (lastImage) {
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(lastImage.width, lastImage.height));
    processSource(lastImage, Math.round(lastImage.width * scale), Math.round(lastImage.height * scale));
  }
}

// ---------- camera loop ----------

const CAMERA_INTERVAL_MS = 300;
let lastTick = 0;

function cameraLoop(ts) {
  cameraLoopId = requestAnimationFrame(cameraLoop);
  if (ts - lastTick < CAMERA_INTERVAL_MS) return;
  lastTick = ts;
  if (video.videoWidth === 0) return;
  processSource(video, video.videoWidth, video.videoHeight);
}

async function onCameraStart() {
  try {
    await startCamera(video);
    $('camera-start').hidden = true;
    $('camera-stop').hidden = false;
    setStatus('Camera running — point at objects next to the marker.', 'ok');
    cameraLoopId = requestAnimationFrame(cameraLoop);
  } catch (err) {
    setStatus(`Camera unavailable: ${err.message}. Note: camera requires HTTPS (or localhost).`, 'error');
  }
}

function onCameraStop() {
  if (cameraLoopId) cancelAnimationFrame(cameraLoopId);
  cameraLoopId = null;
  stopCamera(video);
  $('camera-start').hidden = false;
  $('camera-stop').hidden = true;
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

  $('marker-size').addEventListener('change', reprocess);
  $('units').addEventListener('change', reprocess);

  document.querySelector('nav.tabs').hidden = false;
  document.querySelector('section.settings').hidden = false;
  document.querySelector('main').hidden = false;
}

// ---------- boot ----------

async function waitForOpenCV() {
  const mod = await Promise.resolve(window.cv);
  return new Promise(resolve => {
    const check = () => {
      if (mod && typeof mod.getPredefinedDictionary === 'function') resolve(mod);
      else setTimeout(check, 100);
    };
    check();
  });
}

async function main() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  try {
    cv = await waitForOpenCV();
    initDetector(cv);
    setStatus('Ready. Print a marker, put it next to your objects, and take a picture.', 'ok');
    wireUI();
  } catch (err) {
    setStatus(`Failed to initialize OpenCV: ${err.message}`, 'error');
  }
}

main();
