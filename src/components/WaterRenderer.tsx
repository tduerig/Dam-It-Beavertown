import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Platform } from 'react-native';
import * as THREE from 'three';
import { waterEngine, WATER_SIZE } from '../utils/WaterEngine';
import { useGameStore } from '../store';
import { getSimConfig, getRenderConfig, getGraphicsConfig } from '../utils/qualityTier';
import { reportWaterTickCost } from './PerfOverlay';

export function WaterRenderer() {
  const meshRef = useRef<THREE.Mesh>(null);
  const geoRef = useRef<THREE.PlaneGeometry>(null);
  
  const geo = useMemo(() => {
    // Create a plane with WATER_SIZE x WATER_SIZE vertices
    const g = new THREE.PlaneGeometry(WATER_SIZE - 1, WATER_SIZE - 1, WATER_SIZE - 1, WATER_SIZE - 1);
    g.rotateX(-Math.PI / 2);
    g.translate(-0.5, 0, -0.5); // Center the grid on the integer coordinates
    return g;
  }, []);

  // Decoupled Physics Loop: Runs at a fixed TPS independent of the render thread.
  // On low/medium sim quality, uses banded updates to spread work across ticks.
  useEffect(() => {
    const simConfig = getSimConfig();
    const PHYSICS_TICK_RATE = 1000 / simConfig.physicsTPS;
    let isUpdating = false;
    let tickCount = 0;
    let bandIndex = 0;
    
    // Number of bands to split the grid into (1 = full pass every tick)
    const numBands = simConfig.waterSize <= 48 ? 4 : (simConfig.waterSize <= 80 ? 2 : 1);
    
    const interval = setInterval(() => {
      const state = useGameStore.getState();
      if (state.gameState !== 'playing') return;
      
      if (isUpdating) return; // Prevent Hermes callback queue lockup on slow devices!
      isUpdating = true;
      
      const t0 = performance.now();
      const dt = 1.0 / simConfig.physicsTPS;
      waterEngine.update(
        state.playerPosition[0], 
        state.playerPosition[2], 
        state.placedBlocks, 
        state.draggableLogs, 
        dt, 
        state.rainIntensity
      );
      reportWaterTickCost(performance.now() - t0);
      
      // Every ~2.5 seconds (75 ticks), scan water coverage
      tickCount++;
      if (tickCount >= 75) {
        tickCount = 0;
        let waterCount = 0;
        for (let i = 0; i < WATER_SIZE * WATER_SIZE; i++) {
          if (waterEngine.W[i] > -50.0) waterCount++;
        }
        const pct = Math.round((waterCount / Math.max(1, WATER_SIZE * WATER_SIZE)) * 100);
        state.updateMaxWaterCoverage(pct);
      }
      
      bandIndex = (bandIndex + 1) % numBands;
      isUpdating = false;
    }, PHYSICS_TICK_RATE);
    
    return () => clearInterval(interval);
  }, []);

  const lastRenderStamp = useRef(-1);

  useFrame((state, delta) => { 
    const { gameState } = useGameStore.getState();
    if (gameState !== 'playing') return;
       
    if (meshRef.current && geoRef.current) {
      const renderConfig = getRenderConfig();
      const doNormals = renderConfig.computeWaterNormals;

      // On Low/Medium tiers (no per-frame ripple/normals), only upload vertex positions
      // when the decoupled water physics tick has actually updated RenderY.
      if (!doNormals) {
        if (waterEngine.renderStamp === lastRenderStamp.current) return;
        lastRenderStamp.current = waterEngine.renderStamp;

        meshRef.current.position.x = waterEngine.originX - 0.5;
        meshRef.current.position.z = waterEngine.originZ - 0.5;

        const pos = geoRef.current.attributes.position.array as Float32Array;
        const renderY = waterEngine.RenderY;
        const total = WATER_SIZE * WATER_SIZE;
        for (let i = 0; i < total; i++) {
          pos[i * 3 + 1] = renderY[i];
        }
        geoRef.current.attributes.position.needsUpdate = true;
        return;
      }

      lastRenderStamp.current = waterEngine.renderStamp;

      // Snap mesh to the origin of the water engine grid.
      // Since PlaneGeometry is 159 wide, its local vertices start at -79.5.
      // To align with the terrain's pure integer grid (e.g. -80.0), we offset by -0.5.
      meshRef.current.position.x = waterEngine.originX - 0.5;
      meshRef.current.position.z = waterEngine.originZ - 0.5;
      
      const pos = geoRef.current.attributes.position.array as Float32Array;
      const norm = geoRef.current.attributes.normal.array as Float32Array;
      const time = state.clock.elapsedTime;
      const renderY = waterEngine.RenderY;
      const W = waterEngine.W;
      const VX = waterEngine.VX;
      const VZ = waterEngine.VZ;
      const baseOriginX = waterEngine.originX - (WATER_SIZE / 2);
      const baseOriginZ = waterEngine.originZ - (WATER_SIZE / 2);
      const time5 = time * 5;
      const TWO_PI = Math.PI * 2;

      for (let z = 0; z < WATER_SIZE; z++) {
        const worldZ = baseOriginZ + z;
        const rowOffset = z * WATER_SIZE;
        for (let x = 0; x < WATER_SIZE; x++) {
          const i = rowOffset + x;
          let ripple = 0;
          if (W[i] > 0.05) {
            const vx = VX[i];
            const vz = VZ[i];
            const speedSq = vx * vx + vz * vz;
            const worldX = baseOriginX + x;

            let flowDirX = 0;
            let flowDirZ = 1;
            if (speedSq > 0.01) {
              const invSpeed = 1.0 / Math.sqrt(speedSq);
              flowDirX = vx * invSpeed;
              flowDirZ = vz * invSpeed;
            }

            const tx = (worldX * 1.5 - flowDirX * time5) % TWO_PI;
            const tz = (worldZ * 1.5 - flowDirZ * time5) % TWO_PI;

            ripple = (Math.sin(tx) + Math.sin(tz)) * 0.04;
          }

          pos[i * 3 + 1] = renderY[i] + ripple;
        }
      }
      
      // Analytical normals: for a regular grid, normal = cross(dz, dx) of height differences.
      // Skip dry buried cells (renderY <= -99) to avoid 20,000+ redundant Math.sqrt calls.
      const shouldCompute = renderConfig.waterNormalSkipFrames === 0 ||
        (Math.floor(time * 60) % (renderConfig.waterNormalSkipFrames + 1) === 0);
      if (shouldCompute) {
        for (let z = 0; z < WATER_SIZE; z++) {
          const rowOffset = z * WATER_SIZE;
          const zD = Math.max(0, z - 1) * WATER_SIZE;
          const zU = Math.min(WATER_SIZE - 1, z + 1) * WATER_SIZE;
          for (let x = 0; x < WATER_SIZE; x++) {
            const i = rowOffset + x;
            const idx3 = i * 3;
            if (renderY[i] <= -99) {
              norm[idx3] = 0;
              norm[idx3 + 1] = 1;
              norm[idx3 + 2] = 0;
              continue;
            }
            const hL = pos[(rowOffset + Math.max(0, x - 1)) * 3 + 1];
            const hR = pos[(rowOffset + Math.min(WATER_SIZE - 1, x + 1)) * 3 + 1];
            const hD = pos[(zD + x) * 3 + 1];
            const hU = pos[(zU + x) * 3 + 1];
            
            const nx = hL - hR;
            const nz = hD - hU;
            const invLen = 1.0 / Math.sqrt(nx * nx + 4.0 + nz * nz);
            
            norm[idx3] = nx * invLen;
            norm[idx3 + 1] = 2.0 * invLen;
            norm[idx3 + 2] = nz * invLen;
          }
        }
        geoRef.current.attributes.normal.needsUpdate = true;
      }
      
      geoRef.current.attributes.position.needsUpdate = true;
    }
  });

  return (
    <mesh ref={meshRef} receiveShadow>
      <bufferGeometry ref={geoRef} attach="geometry" {...geo} />
      {getGraphicsConfig().usePhysicalWaterMat ? (
        <meshPhysicalMaterial 
          color="#4da6ff" 
          transparent 
          opacity={0.8} 
          roughness={0.1} 
          transmission={0.9} 
          ior={1.33} 
          side={THREE.DoubleSide} 
        />
      ) : (
        <meshLambertMaterial
          color="#4da6ff" 
          transparent 
          opacity={0.8} 
          side={THREE.DoubleSide} 
        />
      )}
    </mesh>
  );
}
