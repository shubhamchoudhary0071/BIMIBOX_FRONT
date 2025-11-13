const QUAT_TRANSFORM = [0.66681372, -0.09451034, -0.00199205, 0.73920450];

const qMul = ([x1,y1,z1,w1], [x2,y2,z2,w2]) => ([
  w1*x2 + x1*w2 + y1*z2 - z1*y2,
  w1*y2 - x1*z2 + y1*w2 + z1*x2,
  w1*z2 + x1*y2 - y1*x2 + z1*w2,
  w1*w2 - x1*x2 - y1*y2 - z1*z2
]);

const qNormalize = ([x,y,z,w]) => {
  const m = Math.hypot(x,y,z,w);
  return [x/m, y/m, z/m, w/m];
};

const qInverse = ([x,y,z,w]) => {
  const len2 = x*x + y*y + z*z + w*w;
  return [-x/len2, -y/len2, -z/len2,  w/len2];
};

// ─────────────────────────────────────────────
// Normal transform (your existing one)
export function transformQuaternion(x, y, z, w) {
  return qNormalize(qMul(QUAT_TRANSFORM, [x, y, z, w]));
}

const Q_PITCH_DOWN_90 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // ≈ [0.707, 0, 0, 0.707]
// or use exact: [Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)]
// Add this constant to your utilities
const Q_180_Z = [0, 0, 1, 0]; // 180° rotation around Z-axis

// ─────────────────────────────────────────────
// New mirrored transform: left↔right flip (same POV)
export function transformQuaternionMirrored(x, y, z, w) {
  // Step 1: Apply the normal, stable transform
  const normalResult = transformQuaternion(x, y, z, w); 
  
  // Step 2: Apply 180° rotation around Z-axis (horizontal flip) to the result.
  // This is algebraically more stable than trying to mirror the input quaternion 
  // since the QUAT_TRANSFORM is non-trivial.
  const finalResult = qNormalize(qMul(Q_180_Z, normalResult));

  return finalResult;
}


// --- the reverse transform ---
export function reverseTransform(x, y, z, w) {
  const QT_INV = qInverse(QUAT_TRANSFORM);  // ← CORRECT
  return qNormalize(qMul(QT_INV, [x, y, z, w]));
}


/** +90° pitch-down (the same you add when going Pano to Forge) */

/** Full reverse pipeline (Forge to Pano) */
/** Full reverse pipeline (Forge → Pano) */
export const forgeToPanoQuaternion = (qx, qy, qz, qw) => {
  // 1. Undo the normal calibration quaternion
  const QT_INV = qInverse(QUAT_TRANSFORM);
  const step1 = qNormalize(qMul(QT_INV, [qx, qy, qz, qw]));

  // 2. Undo the +90° pitch-down
  const invPitch = qInverse(Q_PITCH_DOWN_90);
  const step2 = qNormalize(qMul(invPitch, step1));

  // 3. UNDO the 180° Z-flip (from mirrored transform)
  const Q_180_Z_INV = qInverse(Q_180_Z); // = Q_180_Z (since it's 180°)
  const final = qNormalize(qMul(Q_180_Z_INV, step2));

  return final; // [x, y, z, w] → ready for Pano
};
// ============================================================================
// BOUNDARY CONSTRAINT UTILITIES
// ============================================================================

const BOUNDARY_POINTS = [
  {x: 79.7, y: 39.5},
  {x: 39.8, y: 39.8},
  {x: 41.7, y: 106.7},
  {x: 63.2, y: 107.2},
  {x: 63.2, y: 125.3},
  {x: 79.7, y: 127.3}
];

const CORRECTION_COEFFS = {
  x: { pano_x: 5.4, pano_y: -2.6, pano_z: 1.2 },
  y: { pano_x: -0.9, pano_y: 14.4, pano_z: 1.8 }
};

const BOUNDARY_MARGIN = 0.5; // Safety margin in units

/**
 * Ray casting algorithm: Check if point is inside polygon
 * Time complexity: O(n) where n = number of boundary points
 */
function isPointInsideBoundary(x, y) {
  let isInside = false;
  const points = BOUNDARY_POINTS;
  
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    
    const intersect = (yi > y) !== (yj > y) &&
                      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) isInside = !isInside;
  }
  
  return isInside;
}

/**
 * Find nearest point on polygon boundary
 * Used to project out-of-bounds points back inside
 * Time complexity: O(n * 1) simplified to O(n)
 */
function findNearestBoundaryPoint(x, y) {
  const points = BOUNDARY_POINTS;
  let minDistance = Infinity;
  let nearestX = x, nearestY = y;
  
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    
    // Vector from p1 to p2
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len2 = dx * dx + dy * dy;
    
    if (len2 === 0) continue;
    
    // Parameter t: how far along edge from p1 toward p2
    let t = ((x - p1.x) * dx + (y - p1.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    
    // Closest point on this edge segment
    const closestX = p1.x + t * dx;
    const closestY = p1.y + t * dy;
    
    const dist = Math.hypot(x - closestX, y - closestY);
    
    if (dist < minDistance) {
      minDistance = dist;
      nearestX = closestX;
      nearestY = closestY;
    }
  }
  
  return { x: nearestX, y: nearestY, distance: minDistance };
}

/**
 * Calculate centroid (average of all boundary points)
 * Safe point guaranteed to be inside polygon
 */
function getPolygonCentroid() {
  let cx = 0, cy = 0;
  const points = BOUNDARY_POINTS;
  
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  
  return { x: cx / points.length, y: cy / points.length };
}

/**
 * Clamp point to polygon boundary
 * If inside: returns unchanged
 * If outside: projects to edge then moves inward with margin
 */
function clampToBoundary(x, y) {
  if (isPointInsideBoundary(x, y)) {
    return { x, y, wasClamped: false };
  }
  
  // Point is outside - find edge, project inward
  const nearest = findNearestBoundaryPoint(x, y);
  const centroid = getPolygonCentroid();
  
  // Direction vector from edge toward center
  let dirX = centroid.x - nearest.x;
  let dirY = centroid.y - nearest.y;
  
  // Normalize direction
  const dirLen = Math.hypot(dirX, dirY);
  if (dirLen > 0) {
    dirX /= dirLen;
    dirY /= dirLen;
  }
  
  // Move inward from edge by safety margin
  const clampedX = nearest.x + dirX * BOUNDARY_MARGIN;
  const clampedY = nearest.y + dirY * BOUNDARY_MARGIN;
  
  return {
    x: clampedX,
    y: clampedY,
    wasClamped: true,
    originalDistance: nearest.distance
  };
}

/**
 * Main transformation: Pano → Forge with boundary constraint
 * @param {number} pano_x - Camera pan offset
 * @param {number} pano_y - Camera tilt offset  
 * @param {number} pano_z - Camera distance/zoom
 * @param {object} realWorldPos - Anchor-adjusted position {x, y, z}
 */
function transformPanoToForgeWithBoundary(pano_x, pano_y, pano_z, realWorldPos) {
  // Step 1: Apply learned correction coefficients
  const correction_x = 
    pano_x * CORRECTION_COEFFS.x.pano_x +
    pano_y * CORRECTION_COEFFS.x.pano_y +
    pano_z * CORRECTION_COEFFS.x.pano_z;
  
  const correction_y =
    pano_x * CORRECTION_COEFFS.y.pano_x +
    pano_y * CORRECTION_COEFFS.y.pano_y +
    pano_z * CORRECTION_COEFFS.y.pano_z;
  
  // Step 2: Apply correction to anchor position
  let result_x = realWorldPos.x + correction_x;
  let result_y = realWorldPos.y + correction_y;
  
  // Step 3: Enforce boundary constraint
  const clamped = clampToBoundary(result_x, result_y);
  
  return {
    x: clamped.x,
    y: clamped.y,
    z: 5,
    wasClamped: clamped.wasClamped,
    appliedCorrection: { x: correction_x, y: correction_y }
  };
}

// ============================================================================
// REACT COMPONENT INTEGRATION
// ============================================================================

export const transformPanoToForge = (panoX, panoY, panoZ, forgeAnchorX, forgeAnchorY) => {
  // Polynomial (degree 2) calibrated coefficients
  // Based on non-linear regression of panorama viewing angles
  
  // Offset X calculation with quadratic terms
  const offsetX = 
    7.4506 * panoX 
    - 20.2788 * panoY 
    + 2.0486 * panoZ 
    + 0.0342 * panoX * panoY 
    + 0.0935 * panoY * panoY 
    + 0.0213 * panoY * panoZ 
    + 0.2149;  // intercept

  // Offset Y calculation with quadratic terms
  const offsetY = 
    0.9336 * panoX 
    - 16.9745 * panoY 
    + 3.4552 * panoZ 
    + 0.0756 * panoX * panoY 
    + 0.3271 * panoY * panoY 
    + 0.0387 * panoY * panoZ 
    - 0.8702;  // intercept

  // Result = anchor + offset
  const resultX = forgeAnchorX + offsetX;
  const resultY = forgeAnchorY + offsetY;
  const resultZ = 5;

  return [resultX, resultY, resultZ];
};



export function flipHorizontalDirection(quat) {
  const q = new THREE.Quaternion(...quat);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const up      = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

  // Flip X → left becomes right
  forward.x = -forward.x;

  // Build a new quaternion that looks at the flipped forward while keeping the same up
  const matrix = new THREE.Matrix4().lookAt(
    new THREE.Vector3(0, 0, 0),   // eye (origin)
    forward,                     // target
    up                           // up
  );
  const newQ = new THREE.Quaternion().setFromRotationMatrix(matrix);
  return [newQ.x, newQ.y, newQ.z, newQ.w];
}



export function syncPanoPathPointToForge(anchorPosition, localPanoPoint, viewerRef) {
    const viewer = viewerRef.current;
    const nav = viewer.navigation;
    if (!viewer) {
        console.error("Forge Viewer instance is not available.");
        return null;
    }
    const model = viewer.model; 
    if (!model) {
        console.error("Forge Viewer model is not loaded. Cannot synchronize camera.");
        return null;
    }

    // --- 1. Calculate Combined Horizontal Coordinates ---
    // X and Y are assumed to be horizontal axes in the Pano data.
    const combinedX = anchorPosition.x + localPanoPoint.x;
    const combinedY = anchorPosition.y + localPanoPoint.z; 

    // --- 2. ENFORCE CONSTANT HEIGHT ---
    // The Z-value of the anchor (5.0) is the desired constant height.
    // We IGNORE the localPanoPoint.y value (the Pano's height changes).
    const constantHeightZ = anchorPosition.z; 

    // --- 3. Apply Y-Up to Z-Up Axis Swap (X, Z, Y convention) ---
    // This resolves the 'moves to empty space' issue by correcting axis orientation.
    // We construct the vector as (X_horiz1, Z_height, Y_horiz2)
    const panoModelPoint = new THREE.Vector3(
        combinedX,           // X (Horizontal 1) -> remains X
        constantHeightZ,     // Anchor Z (Height) -> becomes Y (Axis Swap + Forge World Height)
        combinedY            // Combined Y (Horizontal 2) -> becomes Z (Axis Swap)
    );

    // 4. Apply the model's transformation to get the Forge World Position
    const modelTransform = model.getModelToViewerTransform();
    const forgeCameraPosition = panoModelPoint.clone().applyMatrix4(modelTransform);
    console.log("forge",forgeCameraPosition)
    // 5. Determine the new camera Target (Look-At Point)
    // We reuse the current view direction vector for smooth transition.
    const forgeNav = viewer.navigation;
    const oldPosition = forgeNav.getPosition();
    const currentTarget = forgeNav.getTarget();
    
    const viewDirection = new THREE.Vector3().subVectors(currentTarget, oldPosition);
    const forgeCameraTarget = new THREE.Vector3().copy(forgeCameraPosition).add(viewDirection);

    nav.setPosition(forgeCameraPosition);
    // 6. Apply the new view state to the Forge Viewer
    // forgeNav.setView(forgeCameraPosition, forgeCameraTarget, true);
    
    // // Explicitly set the Camera Up Vector to ensure correct Z-up orientation
    // forgeNav.setCameraUpVector(new THREE.Vector3(0, 0, 1));
    // forgeNav.setPivotPoint(forgeCameraPosition);

    return {
        forgePosition: { x: forgeCameraPosition.x, y: forgeCameraPosition.y, z: forgeCameraPosition.z },
        forgeTarget: { x: forgeCameraTarget.x, y: forgeCameraTarget.y, z: forgeCameraTarget.z }
    };
}