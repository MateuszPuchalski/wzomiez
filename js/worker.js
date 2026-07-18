// Measurement worker: hosts the single OpenCV.js (WASM) instance plus the
// optional AI segmentation model (ISNet via @imgly/background-removal,
// vendored under ../vendor/imgly/), so the UI thread never blocks.
importScripts('../vendor/opencv.js');

let cv = null;
let measureImage = null;
let removeBackground = null;

async function boot() {
  cv = await Promise.resolve(self.cv);
  await new Promise(resolve => {
    const check = () =>
      typeof cv.getPredefinedDictionary === 'function' ? resolve() : setTimeout(check, 50);
    check();
  });
  const [measure, aruco] = await Promise.all([import('./measure.js'), import('./aruco.js')]);
  measureImage = measure.measureImage;
  aruco.initDetector(cv);
  postMessage({ type: 'ready' });
}
const booted = boot();

const IMGLY_CONFIG = {
  publicPath: new URL('../vendor/imgly/', self.location).href,
  model: 'small',
  device: 'cpu',
  output: { format: 'image/png', quality: 1 },
  progress: (key, current, total) => {
    // Only surface model/wasm downloads (they're tens of MB on first use)
    if (total > 1_000_000) postMessage({ type: 'progress', key, current, total });
  },
};

async function ensureAI() {
  if (!removeBackground) {
    const mod = await import('../vendor/imgly/index.mjs');
    removeBackground = mod.removeBackground;
  }
}

// Runs AI segmentation on the frame; returns a CV_8UC1 foreground mask Mat.
async function segmentMask(imageData) {
  await ensureAI();
  const src = new OffscreenCanvas(imageData.width, imageData.height);
  src.getContext('2d').putImageData(imageData, 0, 0);
  const blob = await src.convertToBlob({ type: 'image/png' });
  const cutout = await removeBackground(blob, IMGLY_CONFIG);
  const bmp = await createImageBitmap(cutout);
  const out = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, imageData.width, imageData.height);
  const cut = ctx.getImageData(0, 0, imageData.width, imageData.height);
  const mask = new cv.Mat(imageData.height, imageData.width, cv.CV_8UC1);
  for (let i = 0; i < mask.data.length; i++) {
    mask.data[i] = cut.data[i * 4 + 3]; // alpha channel = foreground confidence
  }
  return mask;
}

self.onmessage = async e => {
  const { type, imageData, markerSizeMM, useAI, seq } = e.data;
  if (type !== 'frame') return;
  await booted;
  const t0 = performance.now();
  const rgba = cv.matFromImageData(imageData);
  let mask = null;
  let aiFailed = false;
  try {
    if (useAI) {
      try {
        mask = await segmentMask(imageData);
      } catch (err) {
        aiFailed = true; // fall back to the classical edge pipeline
        console.error('AI segmentation failed:', err);
      }
    }
    const result = measureImage(cv, rgba, { markerSizeMM, mask });
    postMessage({
      type: 'result',
      seq,
      marker: result.marker,
      objects: result.objects,
      usedAI: !!mask,
      aiFailed,
      processingMs: Math.round(performance.now() - t0),
    });
  } catch (err) {
    postMessage({ type: 'error', seq, message: err.message || String(err) });
  } finally {
    rgba.delete();
    if (mask) mask.delete();
  }
};
