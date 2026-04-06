"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var simplex_noise_1 = require("simplex-noise");
var store_1 = require("../store");
var noise2D = (0, simplex_noise_1.createNoise2D)();
var CHUNK_SIZE = 40;
var RIVER_WIDTH = 8;
var RIVER_DEPTH = 3;
var SLOPE = 0.1; // Downhill towards +Z
function getRiverCenter(z) {
    return noise2D(z * 0.01, 0) * 15; // Meandering river
}
function getBaseTerrainHeight(x, z) {
    var height = noise2D(x * 0.05, z * 0.05) * 5;
    height += noise2D(x * 0.1, z * 0.1) * 2;
    var riverX = getRiverCenter(z);
    var distFromRiver = Math.abs(x - riverX);
    if (distFromRiver < RIVER_WIDTH) {
        var t = distFromRiver / RIVER_WIDTH;
        var riverBedHeight = -RIVER_DEPTH + noise2D(x * 0.2, z * 0.2);
        height = riverBedHeight * (1 - t) + height * t;
    }
    else {
        height += Math.max(0, 5 - (distFromRiver - RIVER_WIDTH) * 0.5);
    }
    // Apply global slope
    height -= z * SLOPE;
    // Add mountains on the sides (Humboldt style)
    if (x > 60) {
        height += (x - 60) * 0.4;
    }
    else if (x < -60) {
        height += (-60 - x) * 0.4;
    }
    return height;
}
function getTerrainHeight(x, z) {
    var base = getBaseTerrainHeight(x, z);
    var offsets = store_1.useGameStore.getState().terrainOffsets;
    // Bilinear interpolation of integer grid offsets
    var x0 = Math.floor(x);
    var x1 = x0 + 1;
    var z0 = Math.floor(z);
    var z1 = z0 + 1;
    var tx = x - x0;
    var tz = z - z0;
    var v00 = offsets["".concat(x0, ",").concat(z0)] || 0;
    var v10 = offsets["".concat(x1, ",").concat(z0)] || 0;
    var v01 = offsets["".concat(x0, ",").concat(z1)] || 0;
    var v11 = offsets["".concat(x1, ",").concat(z1)] || 0;
    var nx0 = v00 * (1 - tx) + v10 * tx;
    var nx1 = v01 * (1 - tx) + v11 * tx;
    var offset = nx0 * (1 - tz) + nx1 * tz;
    return base + offset;
}
var _treeCache = {};
function generateTreesForChunk(chunkX, chunkZ) {
    var cacheKey = "".concat(chunkX, ",").concat(chunkZ);
    if (_treeCache[cacheKey])
        return _treeCache[cacheKey];
    var trees = [];
    var offsetX = chunkX * CHUNK_SIZE;
    var offsetZ = chunkZ * CHUNK_SIZE;
    // Decreased density by 60% (from 80 to 32)
    for (var i = 0; i < 32; i++) {
        // Use noise to get deterministic random-like values between 0 and 1
        var rx = (noise2D(chunkX + i * 0.1, chunkZ) + 1) / 2;
        var rz = (noise2D(chunkX, chunkZ + i * 0.1) + 1) / 2;
        var x = offsetX + (rx - 0.5) * CHUNK_SIZE;
        var z = offsetZ + (rz - 0.5) * CHUNK_SIZE;
        var riverX = getRiverCenter(z);
        if (Math.abs(x - riverX) > RIVER_WIDTH + 2) {
            var y = getTerrainHeight(x, z);
            // Sweet spot for trees: not too high (snowy), not too low (sandy beach)
            if (y > -2 && y < 12) {
                var isBig = noise2D(chunkX + i * 0.2, chunkZ + i * 0.2) > 0.6;
                trees.push({
                    id: "tree_".concat(chunkX, "_").concat(chunkZ, "_").concat(i),
                    position: [x, y, z],
                    type: isBig ? 'big' : 'small'
                });
            }
        }
    }
    _treeCache[cacheKey] = trees;
    return trees;
}
var WATER_SIZE = Platform.OS === 'web' ? 160 : 80;
var WATER_HALF = WATER_SIZE / 2;
var WaterEngine = /** @class */ (function () {
    function WaterEngine() {
        this.size = WATER_SIZE;
        this.W = new Float32Array(this.size * this.size);
        this.T = new Float32Array(this.size * this.size);
        this.T_base = new Float32Array(this.size * this.size);
        this.VX = new Float32Array(this.size * this.size);
        this.VZ = new Float32Array(this.size * this.size);
        // Pre-allocated arrays for the simulation loop to prevent GC OOM crashes natively
        this.outFlow = new Float32Array(this.size * this.size * 4);
        this.newT = new Float32Array(this.size * this.size);
        this.originX = 0;
        this.originZ = 0;
        this.initialized = false;
        this.lastOffsetsStamp = 0;
        this.lastBlocksCount = 0;
        this.lastLogsCount = 0;
        this.lastOriginX = null;
        this.lastOriginZ = null;
    }
    WaterEngine.prototype.update = function (px, pz, blocks, draggableLogs, dt, rainIntensity) {
        if (rainIntensity === void 0) { rainIntensity = 0; }
        var newOx = Math.floor(px);
        var newOz = Math.floor(pz);
        if (!this.initialized) {
            this.originX = newOx;
            this.originZ = newOz;
            this.initBase();
            this.initialized = true;
        }
        else if (newOx !== this.originX || newOz !== this.originZ) {
            this.shift(newOx, newOz);
        }
        this.updateTerrain(blocks, draggableLogs);
        // Apply rain
        if (rainIntensity > 0) {
            var rainAmount = rainIntensity * dt * 0.5; // Adjust rain volume here
            for (var i = 0; i < this.size * this.size; i++) {
                this.W[i] += rainAmount;
            }
        }
        // Run simulation steps (fixed time step for stability)
        var fixedDt = 1.0 / 60.0;
        // Cap substeps aggressively at 2 to prevent CPU death-spiral on slow VMs
        var steps = Math.min(Math.max(1, Math.ceil(dt / fixedDt)), 2);
        for (var i = 0; i < steps; i++) {
            this.simulate();
        }
    };
    WaterEngine.prototype.initBase = function () {
        for (var x = 0; x < this.size; x++) {
            for (var z = 0; z < this.size; z++) {
                var wx = this.originX - WATER_HALF + x;
                var wz = this.originZ - WATER_HALF + z;
                var hBase = getBaseTerrainHeight(wx, wz);
                var hFull = getTerrainHeight(wx, wz); // Keep getTerrainHeight for W/T initially
                this.T_base[x + z * this.size] = hBase;
                this.T[x + z * this.size] = hFull;
                this.VX[x + z * this.size] = 0;
                this.VZ[x + z * this.size] = 0;
                var riverX = getRiverCenter(wz);
                if (Math.abs(wx - riverX) < RIVER_WIDTH) {
                    // Calculate bank height to fill river up to the banks
                    var bankHeight = getTerrainHeight(riverX + RIVER_WIDTH, wz);
                    this.W[x + z * this.size] = Math.max(0, bankHeight - 0.5 - hFull);
                }
                else {
                    this.W[x + z * this.size] = 0;
                }
            }
        }
    };
    WaterEngine.prototype.shift = function (newOx, newOz) {
        var dx = newOx - this.originX;
        var dz = newOz - this.originZ;
        var newW = new Float32Array(this.size * this.size);
        var newT_base = new Float32Array(this.size * this.size);
        var newT = new Float32Array(this.size * this.size);
        var newVX = new Float32Array(this.size * this.size);
        var newVZ = new Float32Array(this.size * this.size);
        for (var x = 0; x < this.size; x++) {
            for (var z = 0; z < this.size; z++) {
                var oldX = x + dx;
                var oldZ = z + dz;
                var idx = x + z * this.size;
                if (oldX >= 0 && oldX < this.size && oldZ >= 0 && oldZ < this.size) {
                    var oldIdx = oldX + oldZ * this.size;
                    newW[idx] = this.W[oldIdx];
                    newT_base[idx] = this.T_base[oldIdx];
                    newT[idx] = this.T[oldIdx];
                    newVX[idx] = this.VX[oldIdx];
                    newVZ[idx] = this.VZ[oldIdx];
                }
                else {
                    var wx = newOx - WATER_HALF + x;
                    var wz = newOz - WATER_HALF + z;
                    var hBase = getBaseTerrainHeight(wx, wz);
                    var hFull = getTerrainHeight(wx, wz);
                    newT_base[idx] = hBase;
                    newT[idx] = hFull;
                    newVX[idx] = 0;
                    newVZ[idx] = 0;
                    var riverX = getRiverCenter(wz);
                    if (Math.abs(wx - riverX) < RIVER_WIDTH) {
                        var bankHeight = getTerrainHeight(riverX + RIVER_WIDTH, wz);
                        newW[idx] = Math.max(0, bankHeight - 0.5 - hFull);
                    }
                    else {
                        newW[idx] = 0;
                    }
                }
            }
        }
        this.W = newW;
        this.T_base = newT_base;
        this.T = newT;
        this.VX = newVX;
        this.VZ = newVZ;
        this.originX = newOx;
        this.originZ = newOz;
    };
    WaterEngine.prototype.updateTerrain = function (blocks, draggableLogs, customOffsets) {
        if (draggableLogs === void 0) { draggableLogs = []; }
        if (customOffsets === void 0) { customOffsets = null; }
        // Retrieve the offsets from the state once per tick
        var offsets = customOffsets || store_1.useGameStore.getState().terrainOffsets;
        // Performance Optimization: Skip 25k loop overhead if nothing practically changed
        var stamp = offsets['update_flag'] || 0;
        if (this.lastOffsetsStamp === stamp &&
            this.lastBlocksCount === blocks.length &&
            this.lastLogsCount === draggableLogs.length &&
            this.lastOriginX === this.originX &&
            this.lastOriginZ === this.originZ) {
            return;
        }
        this.lastOffsetsStamp = stamp;
        this.lastBlocksCount = blocks.length;
        this.lastLogsCount = draggableLogs.length;
        this.lastOriginX = this.originX;
        this.lastOriginZ = this.originZ;
        var hasOffsets = Object.keys(offsets).length > 1; // accounting for 'update_flag'
        // Fast-path reconstruction from BaseTerrain Cache
        for (var i = 0; i < this.size * this.size; i++) {
            var x = i % this.size;
            var z = Math.floor(i / this.size);
            var wx = this.originX - WATER_HALF + x;
            var wz = this.originZ - WATER_HALF + z;
            var h = this.T_base[i];
            if (hasOffsets) {
                var x0 = Math.floor(wx);
                var x1 = x0 + 1;
                var z0 = Math.floor(wz);
                var z1 = z0 + 1;
                var tx = wx - x0;
                var tz = wz - z0;
                var v00 = offsets["".concat(x0, ",").concat(z0)] || 0;
                var v10 = offsets["".concat(x1, ",").concat(z0)] || 0;
                var v01 = offsets["".concat(x0, ",").concat(z1)] || 0;
                var v11 = offsets["".concat(x1, ",").concat(z1)] || 0;
                var nx0 = v00 * (1 - tx) + v10 * tx;
                var nx1 = v01 * (1 - tx) + v11 * tx;
                h += nx0 * (1 - tz) + nx1 * tz;
            }
            this.newT[i] = h;
        }
        for (var _i = 0, blocks_1 = blocks; _i < blocks_1.length; _i++) {
            var block = blocks_1[_i];
            var bx = block.position[0];
            var by = block.position[1];
            var bz = block.position[2];
            if (block.type === 'mud') {
                var cx = Math.floor(bx) - this.originX + WATER_HALF;
                var cz = Math.floor(bz) - this.originZ + WATER_HALF;
                if (cx >= 0 && cx < this.size && cz >= 0 && cz < this.size) {
                    this.newT[cx + cz * this.size] = Math.max(this.newT[cx + cz * this.size], by + 0.25);
                }
            }
            else if (block.type === 'stick') {
                var rot = block.rotation[2];
                var dx = Math.sin(rot) * 2;
                var dz = Math.cos(rot) * 2;
                var p1x = bx - dx, p1z = bz - dz;
                var p2x = bx + dx, p2z = bz + dz;
                var minX = Math.max(0, Math.floor(Math.min(p1x, p2x) - 1) - this.originX + WATER_HALF);
                var maxX = Math.min(this.size - 1, Math.ceil(Math.max(p1x, p2x) + 1) - this.originX + WATER_HALF);
                var minZ = Math.max(0, Math.floor(Math.min(p1z, p2z) - 1) - this.originZ + WATER_HALF);
                var maxZ = Math.min(this.size - 1, Math.ceil(Math.max(p1z, p2z) + 1) - this.originZ + WATER_HALF);
                for (var x = minX; x <= maxX; x++) {
                    for (var z = minZ; z <= maxZ; z++) {
                        var wx = this.originX - WATER_HALF + x;
                        var wz = this.originZ - WATER_HALF + z;
                        var l2 = 16;
                        var t = ((wx - p1x) * (p2x - p1x) + (wz - p1z) * (p2z - p1z)) / l2;
                        t = Math.max(0, Math.min(1, t));
                        var projX = p1x + t * (p2x - p1x);
                        var projZ = p1z + t * (p2z - p1z);
                        var dist = Math.sqrt(Math.pow((wx - projX), 2) + Math.pow((wz - projZ), 2));
                        if (dist < 0.8) { // Stick radius is 0.4, use 0.8 to ensure solid wall
                            this.newT[x + z * this.size] = Math.max(this.newT[x + z * this.size], by + 0.4);
                        }
                    }
                }
            }
        }
        // Add draggable logs as obstacles
        for (var _a = 0, draggableLogs_1 = draggableLogs; _a < draggableLogs_1.length; _a++) {
            var log = draggableLogs_1[_a];
            if (log.isDragged)
                continue; // Don't block water while being dragged
            if (log.rotation[0] < 1.0)
                continue; // Any rotation over 1.0 radian (e.g. resting on slope) counts as fallen
            var bx = log.position[0];
            var by = log.position[1];
            var bz = log.position[2];
            var rot = log.rotation[1]; // Y rotation
            var dx = Math.sin(rot) * 5.6; // Log is 11.2 units long
            var dz = Math.cos(rot) * 5.6;
            var p1x = bx - dx, p1z = bz - dz;
            var p2x = bx + dx, p2z = bz + dz;
            var minX = Math.max(0, Math.floor(Math.min(p1x, p2x) - 2) - this.originX + WATER_HALF);
            var maxX = Math.min(this.size - 1, Math.ceil(Math.max(p1x, p2x) + 2) - this.originX + WATER_HALF);
            var minZ = Math.max(0, Math.floor(Math.min(p1z, p2z) - 2) - this.originZ + WATER_HALF);
            var maxZ = Math.min(this.size - 1, Math.ceil(Math.max(p1z, p2z) + 2) - this.originZ + WATER_HALF);
            for (var x = minX; x <= maxX; x++) {
                for (var z = minZ; z <= maxZ; z++) {
                    var wx = this.originX - WATER_HALF + x;
                    var wz = this.originZ - WATER_HALF + z;
                    var l2 = 125.44; // 11.2^2
                    var t = ((wx - p1x) * (p2x - p1x) + (wz - p1z) * (p2z - p1z)) / l2;
                    t = Math.max(0, Math.min(1, t));
                    var projX = p1x + t * (p2x - p1x);
                    var projZ = p1z + t * (p2z - p1z);
                    var dist = Math.sqrt(Math.pow((wx - projX), 2) + Math.pow((wz - projZ), 2));
                    if (dist < 2.0) { // Log radius is ~1.12, use 2.0 for solid barrier overlapping grid diagonals
                        this.newT[x + z * this.size] = Math.max(this.newT[x + z * this.size], by + 2.0); // Allow moderate overtopping unless mudded
                    }
                }
            }
        }
        // Apply new terrain and displace water (prevents "slime" effect)
        for (var i = 0; i < this.size * this.size; i++) {
            var diff = this.newT[i] - this.T[i];
            if (diff > 0) {
                this.W[i] = Math.max(0, this.W[i] - diff);
            }
            this.T[i] = this.newT[i];
        }
    };
    WaterEngine.prototype.simulate = function () {
        var K = 0.25; // Stable flow rate (max 0.25 for 2D grid to prevent oscillation)
        // Clear outFlow buffer to prevent carrying over previous simulation tick data
        this.outFlow.fill(0);
        for (var x = 1; x < this.size - 1; x++) {
            for (var z = 1; z < this.size - 1; z++) {
                var idx = x + z * this.size;
                if (this.W[idx] <= 0.001)
                    continue;
                var h = this.T[idx] + this.W[idx];
                var idxT = x + (z - 1) * this.size;
                var idxR = (x + 1) + z * this.size;
                var idxB = x + (z + 1) * this.size;
                var idxL = (x - 1) + z * this.size;
                var dhT = Math.max(0, h - (this.T[idxT] + this.W[idxT]));
                var dhR = Math.max(0, h - (this.T[idxR] + this.W[idxR]));
                var dhB = Math.max(0, h - (this.T[idxB] + this.W[idxB]));
                var dhL = Math.max(0, h - (this.T[idxL] + this.W[idxL]));
                var sum = dhT + dhR + dhB + dhL;
                if (sum > 0) {
                    var scale = K;
                    if (sum * K > this.W[idx]) {
                        scale = this.W[idx] / sum;
                    }
                    var outIdx = idx * 4;
                    this.outFlow[outIdx] = dhT * scale;
                    this.outFlow[outIdx + 1] = dhR * scale;
                    this.outFlow[outIdx + 2] = dhB * scale;
                    this.outFlow[outIdx + 3] = dhL * scale;
                }
            }
        }
        this.VX.fill(0);
        this.VZ.fill(0);
        for (var x = 1; x < this.size - 1; x++) {
            for (var z = 1; z < this.size - 1; z++) {
                var idx = x + z * this.size;
                var outIdx = idx * 4;
                var outT = this.outFlow[outIdx];
                var outR = this.outFlow[outIdx + 1];
                var outB = this.outFlow[outIdx + 2];
                var outL = this.outFlow[outIdx + 3];
                var inT = this.outFlow[(x + (z - 1) * this.size) * 4 + 2];
                var inR = this.outFlow[((x + 1) + z * this.size) * 4 + 3];
                var inB = this.outFlow[(x + (z + 1) * this.size) * 4 + 0];
                var inL = this.outFlow[((x - 1) + z * this.size) * 4 + 1];
                // Deep Occupancy Culling: Skip math completely for permanently dry cells
                if (this.W[idx] <= 0.001 && inT === 0 && inR === 0 && inB === 0 && inL === 0)
                    continue;
                this.W[idx] += (inT + inR + inB + inL) - (outT + outR + outB + outL);
                if (this.W[idx] < 0)
                    this.W[idx] = 0;
                if (this.W[idx] > 0.01) {
                    this.VX[idx] = (inL + outR - outL - inR) * 10;
                    this.VZ[idx] = (inT + outB - outT - inB) * 10;
                }
            }
        }
        // Source and Sink
        for (var x = 0; x < this.size; x++) {
            var wx = this.originX - WATER_HALF + x;
            // Upstream Source
            var sourceZ = 1;
            var globalSourceZ = this.originZ - WATER_HALF + sourceZ;
            var riverX = getRiverCenter(globalSourceZ);
            // Only inject water if we are below the snowline (Z > -140)
            if (globalSourceZ > -140 && Math.abs(wx - riverX) < RIVER_WIDTH) {
                var idx = x + sourceZ * this.size;
                this.W[idx] += 0.12; // Inject water (decreased by 20% from 0.15)
                if (this.W[idx] > 10.0)
                    this.W[idx] = 10.0;
            }
            // Downstream Sink
            var sinkZ1 = this.size - 2;
            var sinkZ2 = this.size - 1;
            this.W[x + sinkZ1 * this.size] *= 0.8;
            this.W[x + sinkZ2 * this.size] = 0;
        }
        // East/West Sinks (to drain rain water that flows off the sides)
        for (var z = 0; z < this.size; z++) {
            this.W[0 + z * this.size] = 0;
            this.W[this.size - 1 + z * this.size] = 0;
        }
        // Ground absorption & Ocean fill
        var SEA_LEVEL = -15;
        for (var i = 0; i < this.size * this.size; i++) {
            var terrainH = this.T[i];
            // Ocean fill
            if (terrainH < SEA_LEVEL) {
                var targetW = SEA_LEVEL - terrainH;
                if (this.W[i] < targetW) {
                    this.W[i] += (targetW - this.W[i]) * 0.05; // Fill up to sea level
                }
            }
            else if (this.W[i] > 0) {
                // Ground absorption (slowly drains rain pools)
                this.W[i] = Math.max(0, this.W[i] - 0.0001);
            }
        }
    };
    WaterEngine.prototype.getSurfaceHeight = function (wx, wz) {
        var x = Math.floor(wx) - this.originX + WATER_HALF;
        var z = Math.floor(wz) - this.originZ + WATER_HALF;
        if (x >= 0 && x < this.size && z >= 0 && z < this.size) {
            var idx = x + z * this.size;
            if (this.W[idx] > 0.15) {
                return this.T[idx] + this.W[idx];
            }
        }
        return -100;
    };
    WaterEngine.prototype.getWaterDepth = function (wx, wz) {
        var x = Math.floor(wx) - this.originX + WATER_HALF;
        var z = Math.floor(wz) - this.originZ + WATER_HALF;
        if (x >= 0 && x < this.size && z >= 0 && z < this.size) {
            var idx = x + z * this.size;
            return this.W[idx];
        }
        return 0;
    };
    WaterEngine.prototype.getVelocity = function (wx, wz) {
        var x = Math.floor(wx) - this.originX + WATER_HALF;
        var z = Math.floor(wz) - this.originZ + WATER_HALF;
        if (x >= 0 && x < this.size && z >= 0 && z < this.size) {
            var idx = x + z * this.size;
            return { x: this.VX[idx], z: this.VZ[idx] };
        }
        return { x: 0, z: 0 };
    };
    return WaterEngine;
}());
var waterEngine = new WaterEngine();
var TEST_WORLD_Z = -100;
var WATER_SIZE = 160;
var size = 160;
var half = 80;
function initRealTerrain(engine) {
    for (var i = 0; i < size * size; i++) {
        var x = i % size;
        var z = Math.floor(i / size);
        var wx = engine.originX - half + x;
        var wz = engine.originZ - half + z;
        engine.T_base[i] = getBaseTerrainHeight(wx, wz);
    }
}
var engineA = new WaterEngine();
engineA.size = size;
engineA.originX = 0;
engineA.originZ = TEST_WORLD_Z;
engineA.W = new Float32Array(size * size);
engineA.T = new Float32Array(size * size);
engineA.T_base = new Float32Array(size * size);
initRealTerrain(engineA);
var offsetsA = {};
for (var x = -20; x <= 20; x++) {
    offsetsA["".concat(x, ",").concat(TEST_WORLD_Z)] = 6;
    offsetsA["".concat(x, ",").concat(TEST_WORLD_Z + 1)] = 6;
}
engineA.updateTerrain([], [], offsetsA);
var coloredPixels = 0;
for (var i = 0; i < size * size; i++) {
    var h = engineA.T[i];
    var hBase = engineA.T_base[i];
    var diff = h - hBase;
    if (diff > 0.5)
        coloredPixels++;
}
console.log("Colored pixels in Dam A:", coloredPixels);
