// Measurement worker: hosts the single OpenCV.js (WASM) instance so the UI
// thread never blocks. Classic worker (importScripts for the UMD opencv.js)
// that pulls in the shared ESM pipeline via dynamic import().
importScripts('../vendor/opencv.js');

let cv = null;
let measureImage = null;

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

self.onmessage = async e => {
  const { type, imageData, markerSizeMM, seq } = e.data;
  if (type !== 'frame') return;
  await booted;
  const t0 = performance.now();
  const rgba = cv.matFromImageData(imageData);
  try {
    const result = measureImage(cv, rgba, { markerSizeMM });
    postMessage({
      type: 'result',
      seq,
      marker: result.marker,
      objects: result.objects,
      processingMs: Math.round(performance.now() - t0),
    });
  } catch (err) {
    postMessage({ type: 'error', seq, message: err.message || String(err) });
  } finally {
    rgba.delete();
  }
};
