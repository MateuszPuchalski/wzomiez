# 📐 Object Dimensions

An installable **PWA** that measures the real-world dimensions of objects from a photo —
powered by **OpenCV 5** (OpenCV.js / WebAssembly) and an optional **AI segmentation model**
(ISNet), all running entirely in the browser. No backend, no uploads: processing happens on
your device, and the app works offline once loaded.

## Hosted version

The app deploys automatically to **GitHub Pages** on every push to `main`:
<https://mateuszpuchalski.github.io/wzomiez/> — open it on your phone and use
“Add to Home Screen” to install it as an app (HTTPS is provided, so camera photos work).

## How it works

1. **Print an ArUco marker** (`marker/marker.html`) at a known physical size (default 50 mm)
   and place it flat on the same surface as the objects you want to measure.
2. The app detects the marker with OpenCV's ArUco detector (`objdetect` module) and computes a
   **homography** from image pixels to metric coordinates on the marker's plane — this both
   sets the scale and corrects for perspective.
3. Object outlines come from **AI segmentation** (ISNet foreground mask, robust to textured
   backgrounds like wood floors) or, with AI off, from Canny edge detection. Each outline is
   transformed into metric space and its minimum-area rectangle gives the object's
   **width × height in mm/cm/inches**, drawn on the image and listed in a table.
4. **Save** measurements with a part name and export them as **CSV/JSON** for looking up
   replacement parts.

The AI model (~55 MB, vendored from `@imgly/background-removal`) downloads on first AI
measurement and is then cached for offline use. Untick *AI segmentation* for instant
edge-based measurement.

## Running it locally

Any static file server works:

```sh
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

## Usage tips

- Print the marker at **100% scale** and verify its size with a ruler; enter the same size in
  the app's *Marker size* field.
- The marker and the objects must lie on the **same flat surface**, photographed as top-down
  as possible — the homography only corrects perspective on that plane.
- Objects must be **fully inside the frame**; anything touching the image border is treated
  as background. Cutting the marker out of its A4 sheet (leave ~1 cm of white around it)
  helps keep the sheet out of the results.
- Measurements are of each object's footprint (minimum-area bounding rectangle).

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | App shell and UI |
| `js/app.js` | UI wiring, rendering, save/export |
| `js/worker.js` | Web Worker hosting OpenCV + the AI model |
| `js/measure.js` | Measurement pipeline (homography + contours/mask) |
| `js/aruco.js` | ArUco marker detection |
| `vendor/opencv.js` | OpenCV.js **5.0** build (from `@techstark/opencv-js@5.0.0-release.1`) |
| `vendor/imgly/` | ISNet segmentation model + ONNX wasm runtimes (from `@imgly/background-removal`) |
| `marker/marker.html` | Printable ArUco markers (DICT_4X4_50, ids 0–3, exact mm sizing) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA offline support and installability |
| `.github/workflows/pages.yml` | Auto-deploy to GitHub Pages |
