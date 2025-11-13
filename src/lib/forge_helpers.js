/*  src/lib/forge_helpers.js  –  COMPLETE UMEYAMA CALIBRATION  */
import * as THREE from "three";

export function computeTransform(revitPoints, panoPoints) {
  console.log("\n=== computeTransform START ===");
  console.log("revitPoints:", revitPoints);
  console.log("panoPoints:", panoPoints);

  // --------------------------------------------------------------
  // 0. Validation
  // --------------------------------------------------------------
  if (revitPoints.length !== panoPoints.length || revitPoints.length < 3) {
    throw new Error("Need at least 3 matching points");
  }
  if (typeof window.numeric === "undefined") {
    throw new Error("numeric.js not loaded");
  }

  const n = revitPoints.length;

  // --------------------------------------------------------------
  // 1. Centroids  (A = Revit, B = Pano)
  // --------------------------------------------------------------
  const centroidA = new THREE.Vector3();
  const centroidB = new THREE.Vector3();

  revitPoints.forEach(p => centroidA.add(new THREE.Vector3(p.x, p.y, p.z)));
  panoPoints.forEach(p => centroidB.add(new THREE.Vector3(p.x, p.y, p.z)));

  centroidA.divideScalar(n);
  centroidB.divideScalar(n);

  console.log("[1] Centroid Revit (A):", centroidA.toArray().map(v => v.toFixed(4)));
  console.log("[1] Centroid Pano  (B):", centroidB.toArray().map(v => v.toFixed(4)));

  // --------------------------------------------------------------
  // 2. Covariance matrix H = Σ (a_i * b_iᵀ)
  // --------------------------------------------------------------
  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];

  for (let i = 0; i < n; i++) {
    const a = new THREE.Vector3(revitPoints[i].x, revitPoints[i].y, revitPoints[i].z).sub(centroidA);
    const b = new THREE.Vector3(panoPoints[i].x, panoPoints[i].y, panoPoints[i].z).sub(centroidB);

    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        H[r][c] += a.getComponent(r) * b.getComponent(c);
      }
    }
  }

  console.log("[2] Covariance matrix H:");
  H.forEach(row => console.log(row.map(v => v.toFixed(6)).join("\t")));

  // --------------------------------------------------------------
  // 3. SVD  →  H = U Σ Vᵀ
  // --------------------------------------------------------------
  const svd = window.numeric.svd(H);
  console.log("[3] SVD singular values (Σ):", svd.S.map(v => v.toFixed(6)));

  const U = new THREE.Matrix3().fromArray([
    svd.U[0][0], svd.U[1][0], svd.U[2][0],
    svd.U[0][1], svd.U[1][1], svd.U[2][1],
    svd.U[0][2], svd.U[1][2], svd.U[2][2]
  ]);
  const V = new THREE.Matrix3().fromArray([
    svd.V[0][0], svd.V[1][0], svd.V[2][0],
    svd.V[0][1], svd.V[1][1], svd.V[2][1],
    svd.V[0][2], svd.V[1][2], svd.V[2][2]
  ]);

  console.log("[3] U matrix:");
  console.log(U.elements.map((v, i) => (i % 3 === 0 ? "\n" : "") + v.toFixed(6)).join("\t"));
  console.log("[3] V matrix:");
  console.log(V.elements.map((v, i) => (i % 3 === 0 ? "\n" : "") + v.toFixed(6)).join("\t"));

  // --------------------------------------------------------------
  // 4. Reflection correction  (det(R) must be +1)
  // --------------------------------------------------------------
  const detProd = U.determinant() * V.determinant();
  console.log("[4] det(U)*det(V) =", detProd.toFixed(6));

  const S = new THREE.Matrix3().identity();          // diag(1,1,1)
  if (detProd < 0) {
    console.log("[4] *** REFLECTION DETECTED – flip smallest singular value ***");
    S.set(1, 0, 0, 0, 1, 0, 0, 0, -1);
  }

  // --------------------------------------------------------------
  // 5. Rotation R = U * S * Vᵀ
  // --------------------------------------------------------------
  const R = new THREE.Matrix3()
    .multiplyMatrices(U, S)
    .multiply(V.transpose());

  console.log("[5] Rotation matrix R (det ≈ 1):");
  console.log(R.elements.map((v, i) => (i % 3 === 0 ? "\n" : "") + v.toFixed(6)).join("\t"));
  console.log("det(R) =", R.determinant().toFixed(6));

  // --------------------------------------------------------------
  // 6. Optimal uniform scale s = trace(Σ) / Σ||b_i||²
  // --------------------------------------------------------------
  const traceSigma = svd.S.reduce((a, b) => a + b, 0);
  let sumSqB = 0;
  for (let i = 0; i < n; i++) {
    const b = new THREE.Vector3(panoPoints[i].x, panoPoints[i].y, panoPoints[i].z).sub(centroidB);
    sumSqB += b.lengthSq();
  }
  const scale = traceSigma / (sumSqB + 1e-12);
  console.log("[6] Optimal uniform scale s =", scale.toFixed(6));

  // --------------------------------------------------------------
  // 7. Translation t = centroidA - s * R * centroidB
  // --------------------------------------------------------------
  const t = centroidA.clone().sub(
    centroidB.clone().multiplyScalar(scale).applyMatrix3(R)
  );
  console.log("[7] Translation t:", t.toArray().map(v => v.toFixed(4)));

  // --------------------------------------------------------------
  // 8. 4×4 similarity matrix M = [ sR  t ]
  //                               [  0  1 ]
  // --------------------------------------------------------------
  const M = new THREE.Matrix4();
  M.set(
    scale * R.elements[0], scale * R.elements[3], scale * R.elements[6], t.x,
    scale * R.elements[1], scale * R.elements[4], scale * R.elements[7], t.y,
    scale * R.elements[2], scale * R.elements[5], scale * R.elements[8], t.z,
    0,                     0,                     0,                     1
  );

  // --------------------------------------------------------------
  // 9. Verify a few points (Pano → Revit)
  // --------------------------------------------------------------
  console.log("[9] Verification (first 3 points):");
  for (let i = 0; i < Math.min(3, n); i++) {
    const pB = new THREE.Vector3(panoPoints[i].x, panoPoints[i].y, panoPoints[i].z);
    const pA = new THREE.Vector3(revitPoints[i].x, revitPoints[i].y, revitPoints[i].z);
    const transformed = pB.clone().multiplyScalar(scale).applyMatrix3(R).add(t);

    console.log(
      `  #${i}  Pano(${pB.toArray().map(v=>v.toFixed(1)).join()}) → Revit(${transformed.toArray().map(v=>v.toFixed(3)).join()}) ` +
      `(orig ${pA.toArray().map(v=>v.toFixed(3)).join()})`
    );
  }

  console.log("=== computeTransform END ===\n");

  // --------------------------------------------------------------
  // 10. Return everything
  // --------------------------------------------------------------
  return {
    R: R.toArray(),               // 3×3 rotation (row-major)
    scale,                     // uniform scale
    t: t.toArray(),               // translation
    M: M.toArray(),               // 4×4 similarity matrix (column-major)
    centroidA: centroidA.toArray(),
    centroidB: centroidB.toArray()
  };
}