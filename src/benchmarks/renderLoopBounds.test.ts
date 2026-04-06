jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

import { waterEngine } from '../utils/WaterEngine';
import { getTerrainHeight } from '../utils/terrain';
import * as THREE from 'three';
import { createBenchmarkResult } from './benchmarkReporter';

const ITERATIONS = 10000;

describe('Engine Performance Bounds (Hermetic Execution)', () => {
    it('Bounds: Terrain Matrix Math (10k calculations)', () => {
        const start = performance.now();
        const map = new Map<string, number>();
        map.set('0,0', 1.0);
        map.set('1,1', 2.0);
        
        let sum = 0;
        for (let i = 0; i < ITERATIONS; i++) {
            // Replicate the math done per-log per-frame
            const lx = i % 100;
            const lz = (i * 2) % 100;
            let h = getTerrainHeight(lx, lz);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const kX = Math.round(lx) + dx;
                    const kZ = Math.round(lz) + dz;
                    const k = `${kX},${kZ}`;
                    const blockY = map.get(k);
                    if (blockY !== undefined) {
                        const dist = Math.abs(lx - kX) + Math.abs(lz - kZ);
                        if (dist < 1.0) h = Math.max(h, blockY);
                    }
                }
            }
            sum += h;
        }
        
        const end = performance.now();
        const cost = end - start;
        const result = createBenchmarkResult('terrain_hash_10k', ITERATIONS, cost, 16.6 * 10);
        console.log(`[BENCHMARK] ${JSON.stringify(result)}`);
        expect(cost).toBeLessThan(16.6 * 10); // Sanity check
    });

    it('Bounds: ThreeJS Instanced Matrix Comp (10k instances)', () => {
        const start = performance.now();
        const dummyLog = new THREE.Object3D();
        const dummyLeaves = new THREE.Object3D();
        let matrixUpdates = 0;
        
        for (let i = 0; i < ITERATIONS; i++) {
            dummyLog.position.set(i % 10, i % 5, i % 20);
            dummyLog.rotation.set(0.1, 0.2, 0.3, 'YXZ');
            dummyLog.updateMatrixWorld(true);
            
            dummyLeaves.position.set(0, 4.9, 0); 
            dummyLeaves.scale.set(1, 1, 1);
            dummyLeaves.rotation.set(0, 0, 0);
            dummyLeaves.matrix.compose(dummyLeaves.position, dummyLeaves.quaternion, dummyLeaves.scale);
            dummyLeaves.matrixWorld.multiplyMatrices(dummyLog.matrixWorld, dummyLeaves.matrix);
            
            matrixUpdates++;
        }
        
        const end = performance.now();
        const cost = end - start;
        const result = createBenchmarkResult('matrix_comp_10k', ITERATIONS, cost, 16.6 * 10);
        console.log(`[BENCHMARK] ${JSON.stringify(result)}`);
    });
    
    it('Bounds: WaterEngine 25-step Physics Sub-Tick', () => {
        const start = performance.now();
        
        // Push heavy operations onto the fluid dynamics table
        waterEngine.W[5000] = 5.0; // Flood
        waterEngine.T[4000] = 2.0; // Dam
        
        for (let i = 0; i < 25; i++) {
            waterEngine.update(0, 0, [], [], 1/60, 0);
        }
        
        const end = performance.now();
        const cost = end - start;
        const result = createBenchmarkResult('water_physics_25step', 25, cost, 50);
        console.log(`[BENCHMARK] ${JSON.stringify(result)}`);
    });

    // ── New benchmark: Zustand Churn (AP-2 stress test) ──────────────
    it('Bounds: TerrainOffsets Engine applyTerrainMod cost (1000 cells)', () => {
        // Simulate the cost of modifying terrain with the new engine
        const { applyTerrainMod } = require('../utils/terrainOffsets');
        
        const start = performance.now();
        for (let i = 0; i < 100; i++) {
            const cx = Math.random() * 100 - 50;
            const cz = Math.random() * 100 - 50;
            applyTerrainMod(cx, cz, 0.1, 3);
        }
        const cost = performance.now() - start;
        
        const benchResult = createBenchmarkResult('engine_terrain_mod_100x', 100, cost, 16.6);
        console.log(`[BENCHMARK] ${JSON.stringify(benchResult)}`);
        // 100 deep updates should complete very fast
        expect(cost).toBeLessThan(16.6);
    });

    // ── New benchmark: Object3D Pool vs Allocation ──────────────────
    it('Bounds: Object3D allocation vs pool reuse (400 iterations)', () => {
        const POOL_ITERS = 400;
        
        // Test 1: Fresh allocation (the problem pattern)
        const startAlloc = performance.now();
        for (let i = 0; i < POOL_ITERS; i++) {
            const obj = new THREE.Object3D();
            const children: THREE.Object3D[] = [];
            for (let c = 0; c < 8; c++) {
                const child = new THREE.Object3D();
                child.position.set(c, c * 0.5, c * 0.2);
                child.quaternion.set(0.1, 0.2, 0.3, 0.9);
                child.scale.set(1, 1, 1);
                obj.add(child);
                children.push(child);
            }
            obj.updateMatrixWorld(true);
        }
        const allocCost = performance.now() - startAlloc;
        
        // Test 2: Pooled reuse (the fix pattern)
        const poolObj = new THREE.Object3D();
        const poolChildren: THREE.Object3D[] = [];
        for (let c = 0; c < 8; c++) poolChildren.push(new THREE.Object3D());
        
        const startPool = performance.now();
        for (let i = 0; i < POOL_ITERS; i++) {
            poolObj.position.set(i, i * 0.5, i * 0.2);
            poolObj.rotation.set(0, 0, 0);
            poolObj.updateMatrix();
            poolObj.updateMatrixWorld(true);
            
            for (let c = 0; c < 8; c++) {
                const child = poolChildren[c];
                child.position.set(c, c * 0.5, c * 0.2);
                child.quaternion.set(0.1, 0.2, 0.3, 0.9);
                child.scale.set(1, 1, 1);
                child.updateMatrix();
                child.matrixWorld.multiplyMatrices(poolObj.matrixWorld, child.matrix);
            }
        }
        const poolCost = performance.now() - startPool;
        
        const allocResult = createBenchmarkResult('obj3d_alloc_400', POOL_ITERS, allocCost, 16.6);
        const poolResult = createBenchmarkResult('obj3d_pool_400', POOL_ITERS, poolCost, 16.6);
        console.log(`[BENCHMARK] ${JSON.stringify(allocResult)}`);
        console.log(`[BENCHMARK] ${JSON.stringify(poolResult)}`);
        console.log(`[BENCHMARK_COMPARISON] Alloc: ${allocCost.toFixed(2)}ms vs Pool: ${poolCost.toFixed(2)}ms — Pool is ${(allocCost / poolCost).toFixed(1)}x faster`);
        
        // Pool should be meaningfully faster
        expect(poolCost).toBeLessThan(allocCost);
    });

    // ── New benchmark: getTerrainHeight with populated offsets ───────
    it('Bounds: getTerrainHeight with 500-key offsets map (10k lookups)', () => {
        // Populate the offsets engine 
        const { getTerrainHeight } = require('../utils/terrain');
        const { applyTerrainMod, serializeOffsets, deserializeOffsets } = require('../utils/terrainOffsets');
        
        // Setup initial offsets
        for (let i = 0; i < 50; i++) {
            applyTerrainMod(Math.random() * 50, Math.random() * 50, 0.1, 3);
        }
        
        const start = performance.now();
        let sum = 0;
        for (let i = 0; i < 10000; i++) {
            sum += getTerrainHeight(i % 50, Math.floor(i / 50) % 10);
        }
        const cost = performance.now() - start;
        
        const result = createBenchmarkResult('terrain_height_offsets_10k', 10000, cost, 16.6 * 5);
        console.log(`[BENCHMARK] ${JSON.stringify(result)}`);
        expect(cost).toBeLessThan(16.6 * 5);
        
        // Cleanup
        deserializeOffsets({});
    });
});
