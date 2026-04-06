const fs = require('fs');

class MockWaterEngine {
  constructor() {
    this.size = 80;
    this.T = new Float32Array(80 * 80);
    this.T_base = new Float32Array(80 * 80);
    this.newT = new Float32Array(80 * 80);
    this.originX = 0;
    this.originZ = -100;
  }
}
// wait, can I just run the actual WaterEngine directly in Node?
