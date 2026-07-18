# 📐 Object Dimensions

An installable **PWA** that measures the real-world dimensions of objects from a photo or a
live camera feed — powered by **OpenCV 5** (OpenCV.js / WebAssembly) running entirely in the
browser. No backend, no uploads: all processing happens on your device, and the app works
offline once loaded.

## How it works

1. **Print an ArUco marker** (`marker/marker.html`) at a known physical size (default 50 mm)
   and place it flat on the same surface as the objects you want to measure.
2. The app detects the marker with OpenCV's ArUco detector (`objdetect` module) and computes a
   **homography** from image pixels to metric coordinates on the marker's plane — this both
   sets the scale and corrects for perspective.
3. Object outlines are found with Canny edge detection + contour analysis; each contour is
   transformed into metric space and its minimum-area rectangle gives the object's
   **width × height in mm/cm/inches**, drawn on the image and listed in a table.

## Hosted version

The app deploys automatically to **GitHub Pages** on every push to `main`:
<https://mateuszpuchalski.github.io/wzomiez/> — open it on your phone and use
“Add to Home Screen” to install it as an app (HTTPS is provided, so the camera works).

## Running it locally

Any static file server works. Camera access requires **HTTPS or localhost**.

```sh
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>. On a phone, serve over HTTPS (or use a tunnel) and use
“Add to Home Screen” to install it as an app.

## Usage tips

- Print the marker at **100% scale** and verify its size with a ruler; enter the same size in
  the app's *Marker size* field.
- The marker and the objects must lie on the **same flat surface** — the homography only
  corrects perspective on that plane.
- Use a plain, contrasting background; objects touching the image edges or each other may be
  merged or missed.
- Measurements are of each object's footprint (minimum-area bounding rectangle).

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | App shell and UI |
| `js/app.js` | UI wiring, rendering, camera loop |
| `js/measure.js` | Measurement pipeline (homography + contours) |
| `js/aruco.js` | ArUco marker detection |
| `js/camera.js` | `getUserMedia` helpers |
| `vendor/opencv.js` | OpenCV.js **5.0** build (from `@techstark/opencv-js@5.0.0-release.1`) |
| `marker/marker.html` | Printable ArUco markers (DICT_4X4_50, ids 0–3, exact mm sizing) |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA offline support and installability |
