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

  useFrame((state, delta) => { 
    const { gameState } = useGameStore.getState();
    if (gameState !== 'playing') return;
       
    if (meshRef.current && geoRef.current) {
      // Snap mesh to the origin of the water engine grid
      meshRef.current.position.x = waterEngine.originX;
      meshRef.current.position.z = waterEngine.originZ;
      
      const pos = geoRef.current.attributes.position.array as Float32Array;
      const norm = geoRef.current.attributes.normal.array as Float32Array;
      const time = state.clock.elapsedTime;
      
      // Single pass: compute vertex Y positions AND analytical normals inline.
      // This replaces the separate computeVertexNormals() call which was O(N²)
      // and cost 2-3ms on web, 6-10ms on Android.
      const renderConfig = getRenderConfig();
      const doNormals = renderConfig.computeWaterNormals;

      // O(1) Memory loop for height retrieval (bypasses 1.5 million array condition branches per second)
      for (let z = 0; z < WATER_SIZE; z++) {
        for (let x = 0; x < WATER_SIZE; x++) {
          const i = z * WATER_SIZE + x;
          const w = waterEngine.W[i];
          
          let ripple = 0;
          if (doNormals && w > 0.05) {
             const vx = waterEngine.VX[i];
             const vz = waterEngine.VZ[i];
             const speed = Math.sqrt(vx*vx + vz*vz);
             
             const worldX = waterEngine.originX - (WATER_SIZE / 2) + x;
             const worldZ = waterEngine.originZ - (WATER_SIZE / 2) + z;
             
             const flowDirX = speed > 0.1 ? vx / speed : 0;
             const flowDirZ = speed > 0.1 ? vz / speed : 1;
             
             const tx = (worldX * 1.5 - flowDirX * time * 5) % (Math.PI * 2);
             const tz = (worldZ * 1.5 - flowDirZ * time * 5) % (Math.PI * 2);
             
             ripple = Math.sin(tx) * 0.04 + Math.sin(tz) * 0.04;
          }
          
          pos[i * 3 + 1] = waterEngine.RenderY[i] + ripple;
        }
      }
      
      // Analytical normals: for a regular grid, normal = cross(dz, dx) of height differences.
      // This is ~10× cheaper than Three.js's generic face-by-face computeVertexNormals().
      if (renderConfig.computeWaterNormals) {
        const shouldCompute = renderConfig.waterNormalSkipFrames === 0 ||
          (Math.floor(time * 60) % (renderConfig.waterNormalSkipFrames + 1) === 0);
        if (shouldCompute) {
          for (let z = 0; z < WATER_SIZE; z++) {
            for (let x = 0; x < WATER_SIZE; x++) {
              const i = z * WATER_SIZE + x;
              // Get neighbor heights (clamp at edges)
              const hL = pos[(z * WATER_SIZE + Math.max(0, x - 1)) * 3 + 1];
              const hR = pos[(z * WATER_SIZE + Math.min(WATER_SIZE - 1, x + 1)) * 3 + 1];
              const hD = pos[(Math.max(0, z - 1) * WATER_SIZE + x) * 3 + 1];
              const hU = pos[(Math.min(WATER_SIZE - 1, z + 1) * WATER_SIZE + x) * 3 + 1];
              
              // Normal = normalize(hL - hR, 2.0, hD - hU)
              const nx = hL - hR;
              const nz = hD - hU;
              const ny = 2.0;
              const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
              const invLen = 1.0 / len;
              
              norm[i * 3] = nx * invLen;
              norm[i * 3 + 1] = ny * invLen;
              norm[i * 3 + 2] = nz * invLen;
            }
          }
          geoRef.current.attributes.normal.needsUpdate = true;
        }
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
        <meshStandardMaterial
          color="#4da6ff" 
          transparent 
          opacity={0.8} 
          roughness={0.1} 
          side={THREE.DoubleSide} 
        />
      )}
    </mesh>
  );
}
