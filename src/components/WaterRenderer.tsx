import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Platform } from 'react-native';
import * as THREE from 'three';
import { waterEngine, WATER_SIZE } from '../utils/WaterEngine';
import { useGameStore } from '../store';

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

  // Decoupled Physics Loop: Runs at a fixed 30 TPS independent of the render thread.
  // This satisfies the architectural mandate to prevent dropping frames.
  useEffect(() => {
    const PHYSICS_TICK_RATE = 1000 / 30; // 30 ticks per second
    let isUpdating = false;
    let tickCount = 0;
    const interval = setInterval(() => {
      const state = useGameStore.getState();
      if (state.gameState !== 'playing') return;
      
      if (isUpdating) return; // Prevent Hermes callback queue lockup on slow devices!
      isUpdating = true;
      
      const dt = 1.0 / 30.0;
      waterEngine.update(
        state.playerPosition[0], 
        state.playerPosition[2], 
        state.placedBlocks, 
        state.draggableLogs, 
        dt, 
        state.rainIntensity
      );
      
      // Every ~2.5 seconds (75 ticks), scan 10,000 blocks for absolute max layout water coverage natively without locking the matrix
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
      
      const pos = geoRef.current.attributes.position.array;
      const time = state.clock.elapsedTime;
      
      for (let i = 0; i < WATER_SIZE * WATER_SIZE; i++) {
        const w = waterEngine.W[i];
          // Flowing ripples based on velocity
          const vx = waterEngine.VX[i];
          const vz = waterEngine.VZ[i];
          const speed = Math.sqrt(vx*vx + vz*vz);
          
          // Only show water if it's deep enough, to prevent "frosting" on slopes
          if (w > 0.15) {
            const x = i % WATER_SIZE;
            const z = Math.floor(i / WATER_SIZE);
            const worldX = waterEngine.originX - (WATER_SIZE / 2) + x;
            const worldZ = waterEngine.originZ - (WATER_SIZE / 2) + z;
            
            // Directional ripples based on flow
            const flowDirX = speed > 0.1 ? vx / speed : 0;
            const flowDirZ = speed > 0.1 ? vz / speed : 1; // Default flow south
            
            const ripple = Math.sin(worldX * 1.5 - flowDirX * time * 5) * 0.04 + 
                           Math.sin(worldZ * 1.5 - flowDirZ * time * 5) * 0.04;
            
            pos[i * 3 + 1] = waterEngine.T[i] + w + ripple;
          } else {
            pos[i * 3 + 1] = waterEngine.T[i] - 10.0; // Hide deep below terrain
          }
      }
      geoRef.current.attributes.position.needsUpdate = true;
      if (Platform.OS === 'web') {
        geoRef.current.computeVertexNormals();
      }
    }
  });

  return (
    <mesh ref={meshRef} receiveShadow>
      <bufferGeometry ref={geoRef} attach="geometry" {...geo} />
      {Platform.OS === 'web' ? (
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
