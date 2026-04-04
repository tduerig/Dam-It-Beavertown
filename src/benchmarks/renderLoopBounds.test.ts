jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

import { waterEngine } from '../utils/WaterEngine';
import { getTerrainHeight } from '../utils/terrain';
import * as THREE from 'three';

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
        console.log(`[TERRAIN HASH]: ${ITERATIONS} cycles consumed ${cost.toFixed(2)}ms. Average cost per 1k logs: ${(cost / (ITERATIONS / 1000)).toFixed(3)}ms.`);
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
        console.log(`[MATRIX DOT]: ${ITERATIONS} matrix hierarchy comps consumed ${cost.toFixed(2)}ms. Average cost per 1k logs: ${(cost / (ITERATIONS / 1000)).toFixed(3)}ms.`);
    });
    
    it('Bounds: WaterEngine 25-step Physics Sub-Tick', () => {
        const start = performance.now();
        const dt = 1/60;
        
        // Push heavy operations onto the fluid dynamics table
        waterEngine.W[5000] = 5.0; // Flood
        waterEngine.T[4000] = 2.0; // Dam
        
        for (let i = 0; i < 25; i++) {
            waterEngine.update(dt);
        }
        
        const end = performance.now();
        const cost = end - start;
        console.log(`[WATER PHYSICS]: 25 sub-steps evaluated ${160 * 160 * 25} grid vertices. Consumed ${cost.toFixed(2)}ms. Average cost per step: ${(cost / 25).toFixed(3)}ms.`);
    });
});
