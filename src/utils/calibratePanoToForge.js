import numeric from 'numeric';
import { Matrix, SVD } from 'ml-matrix';

// Model boundary in meters
const Boundary = [
  [24, 38],
  [19, 38],
  [13, 33],
  [12, 12],
  [24, 12]
];

// ✅ 2D Point-in-polygon helper (ray casting)
function isPointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ✅ FIXED: Calculate calibration with corrected rotation extraction
export function calculateCalibration(panoRefs, revitRefs) {
  const n = panoRefs.length;

  console.log('[CALIB] =====================================');
  console.log('[CALIB] Input pano refs:', panoRefs);
  console.log('[CALIB] Input revit refs:', revitRefs);

  // ✅ Flip X-axis for pano points
  const panoRefsFlipped = panoRefs.map(p => [-p[0], p[1], p[2]]);
  console.log('[CALIB] Flipped pano refs:', panoRefsFlipped);

  // Calculate centroids
  const panoCentroid = panoRefsFlipped.reduce(
    (acc, p) => acc.map((v, i) => v + p[i]),
    [0, 0, 0]
  ).map(v => v / n);
  
  const revitCentroid = revitRefs.reduce(
    (acc, p) => acc.map((v, i) => v + p[i]),
    [0, 0, 0]
  ).map(v => v / n);

  console.log('[CALIB] Pano centroid:', panoCentroid);
  console.log('[CALIB] Revit centroid:', revitCentroid);

  // Center points around centroids
  const panoCentered = panoRefsFlipped.map(p => p.map((v, i) => v - panoCentroid[i]));
  const revitCentered = revitRefs.map(p => p.map((v, i) => v - revitCentroid[i]));

  // ✅ RMS-based scale calculation (most accurate)
  const panoRMS = Math.sqrt(
    panoCentered.reduce((sum, p) => sum + p[0]*p[0] + p[1]*p[1] + p[2]*p[2], 0) / n
  );
  const revitRMS = Math.sqrt(
    revitCentered.reduce((sum, p) => sum + p[0]*p[0] + p[1]*p[1] + p[2]*p[2], 0) / n
  );
  const scale = revitRMS / panoRMS;

  console.log('[CALIB] Pano RMS:', panoRMS.toFixed(4));
  console.log('[CALIB] Revit RMS:', revitRMS.toFixed(4));
  console.log('[CALIB] Scale factor:', scale.toFixed(8));

  // Calculate covariance matrix H
  const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        H[row][col] += panoCentered[i][col] * revitCentered[i][row];
      }
    }
  }

  console.log('[CALIB] Covariance matrix H:');
  H.forEach(row => console.log('  ', row.map(v => v.toFixed(6))));

  // SVD
  const hMatrix = new Matrix(H);
const svd = new SVD(hMatrix);
const U = svd.leftSingularVectors;
const V = svd.rightSingularVectors;

let rotationMatrix = V.mmul(U.transpose());

// ✅ FIX: Transpose the matrix when extracting
let rotation = rotationMatrix.transpose().to2DArray();

// Ensure proper rotation (determinant=1)
const det = numeric.det(rotation);
console.log('[CALIB] Rotation determinant:', det.toFixed(6));

if (det < 0) {
  console.log('[CALIB] Correcting rotation (det < 0)');
  V.setColumn(2, V.getColumn(2).map(x => -x));
  rotationMatrix = V.mmul(U.transpose());
  rotation = rotationMatrix.transpose().to2DArray();  // ✅ Also transpose here
}

  console.log('[CALIB] Rotation matrix:');
  rotation.forEach(row => console.log('  ', row.map(v => v.toFixed(8))));

  // Calculate translation
  const translation = [
    revitCentroid[0] - scale * (rotation[0][0]*panoCentroid[0] + rotation[0][1]*panoCentroid[1] + rotation[0][2]*panoCentroid[2]),
    revitCentroid[1] - scale * (rotation[1][0]*panoCentroid[0] + rotation[1][1]*panoCentroid[1] + rotation[1][2]*panoCentroid[2]),
    revitCentroid[2] - scale * (rotation[2][0]*panoCentroid[0] + rotation[2][1]*panoCentroid[1] + rotation[2][2]*panoCentroid[2])
  ];

  console.log('[CALIB] Translation:', translation.map(t => t.toFixed(6)));

  // Calculate errors
  const errors = [];
  console.log('[CALIB] Point-by-point verification:');
  
  for (let i = 0; i < n; i++) {
    const transformed = [
      scale * (rotation[0][0]*panoRefsFlipped[i][0] + rotation[0][1]*panoRefsFlipped[i][1] + rotation[0][2]*panoRefsFlipped[i][2]) + translation[0],
      scale * (rotation[1][0]*panoRefsFlipped[i][0] + rotation[1][1]*panoRefsFlipped[i][1] + rotation[1][2]*panoRefsFlipped[i][2]) + translation[1],
      scale * (rotation[2][0]*panoRefsFlipped[i][0] + rotation[2][1]*panoRefsFlipped[i][1] + rotation[2][2]*panoRefsFlipped[i][2]) + translation[2]
    ];
    
    const error = Math.sqrt(
      (revitRefs[i][0] - transformed[0])**2 +
      (revitRefs[i][1] - transformed[1])**2 +
      (revitRefs[i][2] - transformed[2])**2
    );
    
    console.log(`[CALIB] Point ${i}:`);
    console.log(`  Pano (original): [${panoRefs[i].map(v => v.toFixed(4)).join(', ')}]`);
    console.log(`  Revit (expected): [${revitRefs[i].join(', ')}]`);
    console.log(`  Transformed: [${transformed.map(v => v.toFixed(4)).join(', ')}]`);
    console.log(`  Error: ${error.toFixed(4)}m`);
    
    errors.push(error);
  }

  const maxError = Math.max(...errors);
  const meanError = errors.reduce((a, b) => a + b, 0) / n;

  console.log('[CALIB] =====================================');
  console.log('[CALIB] Max error:', maxError.toFixed(4), 'm');
  console.log('[CALIB] Mean error:', meanError.toFixed(4), 'm');
  console.log('[CALIB] =====================================\n');

  return {
    scale,
    rotation,
    rotationMatrix,
    translation,
    maxError,
    meanError
  };
}

// ✅ Convert panorama point to forge with X-flip
export function panoToForge(panoPoint, calibration) {
  const { scale, rotation, translation } = calibration;
  
  // Flip X-axis
  const flippedPoint = [-panoPoint[0], panoPoint[1], panoPoint[2]];
  
  const rotated = numeric.dot(rotation, flippedPoint);
  const scaled = numeric.mul(scale, rotated);
  return numeric.add(scaled, translation);
}

// ✅ Convert forge point to panorama with X-flip
export function forgeToPano(forgePoint, calibration) {
  const { scale, rotationMatrix, translation } = calibration;
  
  const forgeVec = Matrix.columnVector(forgePoint)
    .sub(Matrix.columnVector(translation));
  
  const panoVec = rotationMatrix.transpose()
    .mmul(forgeVec)
    .mul(1 / scale);
  
  const panoArr = panoVec.to1DArray();
  
  // Flip X-axis back
  panoArr[0] = -panoArr[0];
  
  return panoArr;
}

// ✅ Main calibration and transformation workflow
export function calibrateDataset({
  panoRefs,
  revitRefs,
  modelBoundary = Boundary,
  datasetPoints
}) {
  const calibration = calculateCalibration(panoRefs, revitRefs);
  
  const forgePoints = datasetPoints.map(panoPt => {
    const forgePt = panoToForge(panoPt, calibration);
    
    // Optional: check point inside boundary polygon (2D xy)
    const insideBoundary = isPointInPolygon([forgePt[0], forgePt[1]], modelBoundary);
    if (!insideBoundary) {
      console.warn(`⚠️  Point [${forgePt[0].toFixed(2)}, ${forgePt[1].toFixed(2)}, ${forgePt[2].toFixed(2)}] outside model boundary`);
    }
    
    return forgePt;
  });
  
  return { calibration, forgePoints };
}

export { Boundary };

// Test with your data
// const result = calibrateDataset({
//   panoRefs: [
//     [0, 0, 0],
//     [12.820252418518066, 0.0701887458562851, 5.364327907562256],
//     [17.165802001953125, -0.03108804300427437, -0.13814112544059753]
//   ],
//   revitRefs: [
//     [19, 35, 0],      // ✅ Correct reference points
//     [21, 17, 0],
//     [13, 13, 0]
//   ],
//   datasetPoints: [
//     [0, 0, 0],
//     [12.820252418518066, 0.0701887458562851, 5.364327907562256],
//     [17.165802001953125, -0.03108804300427437, -0.13814112544059753]
//   ]
// });

// console.log('Calibration:', result.calibration);
// console.log('Forge points:', result.forgePoints);
// // ```

// // ---

// // ## ✅ **EXPECTED OUTPUT:**

// // ```
// // [CALIB] =====================================
// // [CALIB] Scale factor: 1.31458456
// // [CALIB] Rotation matrix:
// //    [ 0.26019882, 0.01692848, 0.96540665 ]
// //    [ 0.96555361, -0.00282915, -0.26018882 ]
// //    [ -0.00167332, 0.99985270, -0.01708149 ]
// // [CALIB] Translation: [18.874454, 34.949689, 0.000000]
// // [CALIB] Point 0:
// //   Pano: [0.0000, 0.0000, 0.0000]
// //   Revit: [19, 35, 0]
// //   Transformed: [18.8745, 34.9497, 0.0000]
// //   Error: 0.1353m
// // [CALIB] Point 1:
// //   Pano: [12.8203, 0.0702, 5.3643]
// //   Revit: [21, 17, 0]
// //   Transformed: [21.2987, 16.8418, 0.0000]
// //   Error: 0.3380m
// // [CALIB] Point 2:
// //   Pano: [17.1658, -0.0311, -0.1381]
// //   Revit: [13, 13, 0]
// //   Transformed: [12.8268, 13.2085, 0.0000]
// //   Error: 0.2710m
// // [CALIB] =====================================
// // [CALIB] Max error: 0.3380m
// // [CALIB] Mean error: 0.2481m
// // [CALIB] =====================================
// // ```