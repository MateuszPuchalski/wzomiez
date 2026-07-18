// Core measurement pipeline:
//   1. Detect the ArUco marker and build a homography from image pixels to
//      metric (mm) coordinates on the marker's plane.
//   2. Find object contours (Canny edges + morphology).
//   3. Transform each contour into mm space and take its min-area rectangle —
//      the rectangle's size IS the real-world dimension, perspective-corrected.
import { detectMarker } from './aruco.js';

const MIN_CONTOUR_AREA_PX = 200;
const MIN_OBJECT_MM = 4;     // ignore specks smaller than 4 mm on a side
const MAX_OBJECT_MM = 3000;  // ignore nonsense larger than 3 m

function rotatedRectPoints(rect) {
  const a = (rect.angle * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const w = rect.size.width / 2, h = rect.size.height / 2;
  return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([dx, dy]) => ({
    x: rect.center.x + dx * cos - dy * sin,
    y: rect.center.y + dx * sin + dy * cos,
  }));
}

function pointsToMat(cv, pts) {
  const m = new cv.Mat(pts.length, 1, cv.CV_32FC2);
  pts.forEach((p, i) => {
    m.data32F[i * 2] = p.x;
    m.data32F[i * 2 + 1] = p.y;
  });
  return m;
}

function matToPoints(m) {
  const pts = [];
  for (let i = 0; i < m.data32F.length; i += 2) {
    pts.push({ x: m.data32F[i], y: m.data32F[i + 1] });
  }
  return pts;
}

// Inflate a quad about its centroid so contours touching the marker's edge
// (paper border, shadows) are excluded too.
function inflateQuad(pts, factor) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return pts.map(p => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
}

// Measures objects in an RGBA image Mat.
// Returns { marker: {id, corners}|null, objects: [{cornersImg, widthMM, heightMM, areaMM2}] }
export function measureImage(cv, rgba, { markerSizeMM }) {
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);

  const marker = detectMarker(cv, gray);
  if (!marker) {
    gray.delete();
    return { marker: null, objects: [] };
  }

  const s = markerSizeMM;
  const srcPts = pointsToMat(cv, marker.corners);
  const dstPts = pointsToMat(cv, [
    { x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s },
  ]);
  const H = cv.getPerspectiveTransform(srcPts, dstPts);
  const Hinv = cv.getPerspectiveTransform(dstPts, srcPts);
  srcPts.delete(); dstPts.delete();

  // Edge map -> closed blobs
  const blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
  const edges = new cv.Mat();
  cv.Canny(blur, edges, 50, 100);
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2);
  cv.erode(edges, edges, kernel, new cv.Point(-1, -1), 2);
  kernel.delete(); blur.delete();

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  edges.delete(); hierarchy.delete();

  const markerZone = pointsToMat(cv, inflateQuad(marker.corners, 1.35));
  const markerZoneInt = new cv.Mat();
  markerZone.convertTo(markerZoneInt, cv.CV_32SC2);

  const objects = [];
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    try {
      if (cv.contourArea(cnt) < MIN_CONTOUR_AREA_PX) continue;

      const mnt = cv.moments(cnt);
      if (mnt.m00 === 0) continue;
      const centroid = { x: mnt.m10 / mnt.m00, y: mnt.m01 / mnt.m00 };
      if (cv.pointPolygonTest(markerZoneInt, centroid, false) >= 0) continue;

      // Contour -> mm plane
      const cntF = new cv.Mat();
      cnt.convertTo(cntF, cv.CV_32FC2);
      const cntMM = new cv.Mat();
      cv.perspectiveTransform(cntF, cntMM, H);
      const rect = cv.minAreaRect(cntMM);
      cntF.delete();

      const wMM = Math.max(rect.size.width, rect.size.height);
      const hMM = Math.min(rect.size.width, rect.size.height);
      cntMM.delete();
      if (hMM < MIN_OBJECT_MM || wMM > MAX_OBJECT_MM) continue;

      // Box corners back to image pixels for drawing
      const boxMM = pointsToMat(cv, rotatedRectPoints(rect));
      const boxImg = new cv.Mat();
      cv.perspectiveTransform(boxMM, boxImg, Hinv);
      const cornersImg = matToPoints(boxImg);
      boxMM.delete(); boxImg.delete();

      objects.push({
        cornersImg,
        widthMM: rect.size.width,
        heightMM: rect.size.height,
        areaMM2: rect.size.width * rect.size.height,
      });
    } finally {
      cnt.delete();
    }
  }

  markerZone.delete(); markerZoneInt.delete();
  contours.delete(); H.delete(); Hinv.delete(); gray.delete();

  objects.sort((a, b) => b.areaMM2 - a.areaMM2);
  return { marker, objects };
}
