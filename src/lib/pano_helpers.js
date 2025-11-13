import * as THREE from "three"
/* ────────────────────────────── Helpers ──────────────────────────────── */
export function norm360(deg) { return ((deg % 360) + 360) % 360; }

export function angleToAxis(deg) {
  const a = norm360(deg);
  const snapped = Math.round(a / 90) * 90 % 360;
  switch (snapped) {
    case 0:   return new THREE.Vector3(0, 0,  1);
    case 90:  return new THREE.Vector3(-1, 0, 0);
    case 180: return new THREE.Vector3(0, 0, -1);
    case 270: return new THREE.Vector3(1, 0,  0);
    default: {
      const rad = THREE.MathUtils.degToRad(a);
      return new THREE.Vector3(-Math.sin(rad), 0, Math.cos(rad)).normalize();
    }
  }
}

export function getFacingAnglesFromCamera(camera) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const g = fwd.clone(); g.y = 0;
  if (g.lengthSq() < 1e-10) return { wedgeAngle: 0, yawY: 0 };
  g.normalize();
  const wedgeAngle = Math.atan2(g.z, g.x);
  const yawY = Math.atan2(g.x, g.z);
  return { wedgeAngle, yawY };
}

export function createCompassCircleXZ(radius = 12, { ringColor = 0x9aa3af, fillColor = 0xe5e7eb, ringOpacity = 0.95, fillOpacity = 0.18, wedgeColor = 0xFF0000 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  const draw = (angleRad = 0, isBackward = false) => {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const r = canvas.width / 2 - 12;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = `#${fillColor.toString(16).padStart(6, '0')}`;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    ctx.globalAlpha = fillOpacity;
    ctx.fill();
    ctx.globalAlpha = 1;

    const halfSpan = Math.PI * 0.15;
    // Red for forward, yellow for backward
    ctx.fillStyle = isBackward ? '#FFFF00' : '#FF0000';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r * 0.9, angleRad - halfSpan, angleRad + halfSpan);
    ctx.lineTo(cx, cy);
    ctx.fill();
  };

  draw(0, false);
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 1, depthWrite: false });
  const circleGeom = new THREE.CircleGeometry(radius, 64);
  const circle = new THREE.Mesh(circleGeom, mat);
  circle.rotation.x = -Math.PI / 2;
  circle.renderOrder = 999;
  circle.userData = { isCompass: true, canvas, ctx, texture, draw, lastAngle: 0, isBackward: false };
  return circle;
}


export function buildWalkman(scale = 1) {
  const g = new THREE.Group();
  g.userData.isWalkman = true;

  const bodyH = 0.7 * scale;
  const bodyR = 0.18 * scale;
  const headR = 0.22 * scale;

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(bodyR * 0.9, bodyR, bodyH, 24),
    new THREE.MeshStandardMaterial({ color: 0x1e90ff, metalness: 0.1, roughness: 0.6 })
  );
  body.position.y = bodyH * 0.5;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headR, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xffe0b2, metalness: 0.05, roughness: 0.8 })
  );
  head.position.y = bodyH + headR * 1.05;
  g.add(head);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(bodyR * 0.75, bodyR * 0.75, 0.06 * scale, 24),
    new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.2, roughness: 0.7 })
  );
  base.position.y = 0.03 * scale;
  g.add(base);

  return g;
}

/* ────────────────────────────── Path Helpers ──────────────────────────────── */
export function transpose(M) { return M.length ? M[0].map((_, i) => M.map(r => r[i])) : []; }
export function multiply(A, B) {
  const res = Array(A.length).fill().map(() => Array(B[0].length).fill(0));
  for (let i = 0; i < A.length; i++)
    for (let j = 0; j < B[0].length; j++)
      for (let k = 0; k < B.length; k++)
        res[i][j] += A[i][k] * B[k][j];
  return res;
}
export  function invert(M) {
  const n = M.length;
  if (!n) return [];
  const I = M.map((r, i) => r.map((_, j) => i === j ? 1 : 0));
  const A = M.map(r => r.slice());
  for (let i = 0; i < n; i++) {
    let diag = A[i][i] || 1e-12;
    if (Math.abs(diag) < 1e-12) diag = 1e-12;
    for (let j = 0; j < n; j++) { A[i][j] /= diag; I[i][j] /= diag; }
    for (let k = 0; k < n; k++) if (k !== i) {
      const f = A[k][i];
      for (let j = 0; j < n; j++) { A[k][j] -= f * A[i][j]; I[k][j] -= f * I[i][j]; }
    }
  }
  return I;
}
export function fixOverlappingPoints(points, minDist = 0.05) {
  if (points.length < 2) return points;
  const fixed = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = fixed[fixed.length - 1];
    const curr = points[i];
    const d = Math.hypot(curr.x - prev.x, curr.y - prev.y, curr.z - prev.z);
    if (d < minDist) {
      const dir = d < 1e-6
        ? { x: Math.random() - .5, y: Math.random() - .5, z: Math.random() - .5 }
        : { x: (curr.x - prev.x) / d, y: (curr.y - prev.y) / d, z: (curr.z - prev.z) / d };
      const mid = { x: (prev.x + curr.x) / 2, y: (prev.y + curr.y) / 2, z: (prev.z + curr.z) / 2 };
      const h = minDist / 2;
      fixed[fixed.length - 1] = { x: mid.x - dir.x * h, y: mid.y - dir.y * h, z: mid.z - dir.z * h };
      fixed.push({ x: mid.x + dir.x * h, y: mid.y + dir.y * h, z: mid.z + dir.z * h });
    } else fixed.push(curr);
  }
  return fixed;
}
export function savitzkyGolay(points, windowSize = 11, polyOrder = 3) {
  if (!points?.length) return [];
  if (windowSize % 2 === 0) windowSize++;
  const half = Math.floor(windowSize / 2), n = points.length;
  const A = [];
  for (let i = -half; i <= half; i++) {
    const row = [];
    for (let j = 0; j <= polyOrder; j++) row.push(Math.pow(i, j));
    A.push(row);
  }
  try {
    const AT = transpose(A), ATA = multiply(AT, A), ATAinv = invert(ATA);
    const basis = multiply(multiply(A, ATAinv), AT);
    const coeffs = basis[half];
    const out = Array(n).fill().map(() => ({ x: 0, y: 0, z: 0 }));
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0, sz = 0;
      for (let k = -half; k <= half; k++) {
        const idx = Math.min(Math.max(i + k, 0), n - 1);
        const w = coeffs[k + half];
        sx += w * points[idx].x;
        sy += w * points[idx].y;
        sz += w * points[idx].z;
      }
      out[i] = { x: sx, y: sy, z: sz };
    }
    return out;
  } catch (e) { console.error("SG error:", e); return points; }
}


// Uses future samples to choose the snapped (0/90/180/270) heading.
export function buildManhattanPath(points, {
  lookahead = 5,     // how many future deltas to consider
  hysteresis = 2,    // how many consecutive frames a new heading must persist before switching
  clampY = 'mean',   // 'mean' or a fixed number
} = {}) {
  if (!Array.isArray(points) || points.length < 2) return points;

  const constantY = (typeof clampY === 'number')
    ? clampY
    : points.reduce((s, p) => s + p.y, 0) / points.length;

  const out = [];
  const rad = THREE.MathUtils.degToRad;
  const deg = THREE.MathUtils.radToDeg;

  const norm180 = (aDeg) => {
    let a = ((aDeg % 360) + 360) % 360;
    if (a > 180) a -= 360;
    return a;
  };

  // seed
  let prevOut = { ...points[0], y: constantY };
  let prevRaw = points[0];
  out.push(prevOut);

  let currentSnapDeg = null;
  let pendingSwitch = 0;

  // Sum future deltas to get a stable "trend" direction
  const futureTrend = (startIdx) => {
    let vx = 0, vz = 0;
    const end = Math.min(points.length - 1, startIdx + lookahead);
    for (let k = startIdx; k < end; k++) {
      vx += points[k + 1].x - points[k].x;
      vz += points[k + 1].z - points[k].z;
    }
    return { vx, vz };
  };

  for (let i = 1; i < points.length; i++) {
    const raw = points[i];
    const dx = raw.x - prevRaw.x;
    const dz = raw.z - prevRaw.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) { prevRaw = raw; continue; }

    // 1) Look ahead to compute heading using future trend (fallback to local delta)
    let { vx, vz } = futureTrend(i - 1);
    if (Math.hypot(vx, vz) < 1e-6) { vx = dx; vz = dz; }

    let trendDeg = deg(Math.atan2(vz, vx));
    let snappedDeg = norm180(Math.round(trendDeg / 90) * 90);

    // 2) Hysteresis to avoid chatter
    if (currentSnapDeg === null) currentSnapDeg = snappedDeg;
    if (snappedDeg !== currentSnapDeg) {
      pendingSwitch++;
      if (pendingSwitch >= hysteresis) {
        currentSnapDeg = snappedDeg;
        pendingSwitch = 0;
      } else {
        snappedDeg = currentSnapDeg; // ignore transient change
      }
    } else {
      pendingSwitch = 0;
    }

    // 3) Unit dir aligned with snapped heading; ensure it's "forward" vs local step
    let dirX = Math.cos(rad(currentSnapDeg));
    let dirZ = Math.sin(rad(currentSnapDeg));
    const dot = dx * dirX + dz * dirZ;
    if (dot < 0) { dirX = -dirX; dirZ = -dirZ; } // don't step backwards

    // 4) Advance by the local segment length along the chosen axis-aligned direction
    const newPoint = {
      x: prevOut.x + dirX * len,
      y: constantY,
      z: prevOut.z + dirZ * len,
      image_path: raw.image_path ?? null,
      yaw: 0,
      pitch: 0,
    };

    out.push(newPoint);
    prevOut = newPoint;
    prevRaw = raw;
  }

  return out;
}

