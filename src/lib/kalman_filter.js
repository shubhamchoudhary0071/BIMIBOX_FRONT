class KalmanFilter3D {
  constructor(pn = 1e-3, mn = 1e-2) {
    this.processNoise = pn; this.measurementNoise = mn;
    this.x = { x: 0, y: 0, z: 0 }; this.p = { x: 1, y: 1, z: 1 }; this.initd = false;
  }
  init(m) { this.x = { ...m }; this.p = { x: 1, y: 1, z: 1 }; this.initd = true; }
  update(m) {
    if (!this.initd) this.init(m);
    this.p.x += this.processNoise; this.p.y += this.processNoise; this.p.z += this.processNoise;
    const kx = this.p.x / (this.p.x + this.measurementNoise);
    const ky = this.p.y / (this.p.y + this.measurementNoise);
    const kz = this.p.z / (this.p.z + this.measurementNoise);
    this.x.x += kx * (m.x - this.x.x);
    this.x.y += ky * (m.y - this.x.y);
    this.x.z += kz * (m.z - this.x.z);
    this.p.x = (1 - kx) * this.p.x; this.p.y = (1 - ky) * this.p.y; this.p.z = (1 - kz) * this.p.z;
    return { ...this.x };
  }
}

export default KalmanFilter3D