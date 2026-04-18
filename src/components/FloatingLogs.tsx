import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store';
import { waterEngine } from '../utils/WaterEngine';
import { getTerrainHeight } from '../utils/terrain';
import { createMaterial } from '../utils/qualityTier';

const dummy = new THREE.Object3D();
const _playerPosScratch = new THREE.Vector3();

export function FloatingLogs() {
  const removeBlock = useGameStore(state => state.removeBlock);
  
  // Keep track of logs that have become unanchored
  const floatingLogsRef = useRef<{ id: string, position: THREE.Vector3, rotation: THREE.Euler, velocity: THREE.Vector3, isResting: boolean }[]>([]);
  
  const { geo, mat } = useMemo(() => ({
    geo: new THREE.CylinderGeometry(0.5, 0.5, 4, 8),
    mat: createMaterial({ color: '#8B4513' })
  }), []);

  const meshRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const checkInterval = setInterval(() => {
      const placedBlocks = useGameStore.getState().placedBlocks;
      const removeBlock = useGameStore.getState().removeBlock;
      
      const newFloating = [];
      for (const block of placedBlocks) {
        if (block.type === 'stick') {
          const [bx, by, bz] = block.position;
          const terrainH = getTerrainHeight(bx, bz);
          const waterH = waterEngine.getSurfaceHeight(bx, bz);
          
          if (waterH > by - 0.2) {
            if (by > terrainH + 0.1) {
              newFloating.push(block);
            }
          }
        }
      }
      
      if (newFloating.length > 0) {
        newFloating.forEach(block => {
          removeBlock(block.id);
          floatingLogsRef.current.push({
            id: block.id,
            position: new THREE.Vector3(...block.position),
            rotation: new THREE.Euler(...block.rotation),
            velocity: new THREE.Vector3(0, 0, 0),
            isResting: false,
          });
        });
      }
    }, 500);
    return () => clearInterval(checkInterval);
  }, []);

  useFrame((state, delta) => {
    // 2. Update floating logs physics
    const logs = floatingLogsRef.current;
    if (logs.length > 0 && meshRef.current) {
      let activeCount = 0;
      
      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        if (!log) continue;
        
        // Despawn if too far from player or deep in the sea
        const playerPos = useGameStore.getState().playerPosition;
        const distToPlayer = log.position.distanceTo(_playerPosScratch.set(playerPos[0], playerPos[1], playerPos[2]));
        if (distToPlayer > 150 || log.position.z > 250) {
          logs.splice(i, 1);
          i--;
          continue;
        }

        const terrainH = getTerrainHeight(log.position.x, log.position.z);
        const waterH = waterEngine.getSurfaceHeight(log.position.x, log.position.z);
        
        // If Resting, wake up ONLY if the water height overtakes the terrain significantly
        if (log.isResting) {
            if (waterH > terrainH + 0.1) {
                log.isResting = false; // Wake up!
            }
        }
        
        if (!log.isResting) {
            // Get water velocity
            const vel = waterEngine.getVelocity(log.position.x, log.position.z);
            
            // Apply velocity (with some drag)
            log.velocity.x += (vel.x - log.velocity.x) * delta * 2;
            log.velocity.z += (vel.z - log.velocity.z) * delta * 2;
            
            log.position.x += log.velocity.x * delta;
            log.position.z += log.velocity.z * delta;
            
            // Float on water or rest on terrain
            if (waterH > terrainH) {
              // Bobbing effect
              const bob = Math.sin(state.clock.elapsedTime * 2 + i) * 0.05;
              log.position.y += (waterH + bob - log.position.y) * delta * 5;
              
              // Slowly rotate to align with flow if moving
              const speed = Math.sqrt(log.velocity.x**2 + log.velocity.z**2);
              if (speed > 0.1) {
                const targetAngle = Math.atan2(log.velocity.x, log.velocity.z);
                // Lerp rotation Z (which is the yaw for a cylinder rotated by X=PI/2)
                log.rotation.z += (targetAngle - log.rotation.z) * delta;
              }
            } else {
              // Rest on terrain
              log.position.y += (terrainH + 0.4 - log.position.y) * delta * 5;
              log.velocity.set(0, 0, 0);
              // Put log to sleep locally to save math iterations
              if (Math.abs(terrainH + 0.4 - log.position.y) < 0.05) {
                log.isResting = true;
              }
            }
        }

        dummy.position.copy(log.position);
        dummy.rotation.copy(log.rotation);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(activeCount, dummy.matrix);
        activeCount++;
      }
      meshRef.current.count = activeCount;
      meshRef.current.instanceMatrix.needsUpdate = true;
    } else if (meshRef.current) {
      meshRef.current.count = 0;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[geo, mat, 1000]} castShadow receiveShadow />
  );
}
