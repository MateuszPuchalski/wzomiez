// ArUco marker detection (OpenCV 5 objdetect module).

let detector = null;

export function initDetector(cv) {
  const dict = cv.getPredefinedDictionary(cv.DICT_4X4_50);
  const params = new cv.aruco_DetectorParameters();
  const refine = new cv.aruco_RefineParameters(10, 3, true);
  detector = new cv.aruco_ArucoDetector(dict, params, refine);
}

// Returns { id, corners: [{x,y} x4] } for the first detected marker, or null.
// Corners are ordered clockwise starting top-left (OpenCV convention).
export function detectMarker(cv, grayMat) {
  const corners = new cv.MatVector();
  const ids = new cv.Mat();
  try {
    detector.detectMarkers(grayMat, corners, ids);
    if (ids.rows === 0) return null;
    const c = corners.get(0);
    const pts = [];
    for (let i = 0; i < 4; i++) {
      pts.push({ x: c.data32F[i * 2], y: c.data32F[i * 2 + 1] });
    }
    c.delete();
    return { id: ids.data32S[0], corners: pts };
  } finally {
    corners.delete();
    ids.delete();
  }
}
