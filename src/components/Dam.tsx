import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../store';
import { getTerrainHeight } from '../utils/terrain';
import { waterEngine } from '../utils/WaterEngine';
import * as THREE from 'three';
import { createMaterial } from '../utils/qualityTier';

const dummy = new THREE.Object3D();

const MAX_DAM_BLOCKS = 1000;

export function Dam() {
  const lastTick = useRef(0);

  const { stickGeometry, mudGeometry, stickMaterial, mudMaterial } = useMemo(() => {
    const sGeo = new THREE.CylinderGeometry(0.5, 0.5, 4, 8);
    const mGeo = new THREE.DodecahedronGeometry(0.6, 1);
    return {
      stickGeometry: sGeo,
      mudGeometry: mGeo,
      stickMaterial: createMaterial({ color: '#8B4513' }),
      mudMaterial: createMaterial({ color: '#5C4033', roughness: 1 } as any),
    };
  }, []);

  const stickMeshRef = useRef<THREE.InstancedMesh>(null);
  const mudMeshRef = useRef<THREE.InstancedMesh>(null);
  const lastPlacedBlocksRef = useRef<any[] | null>(null);

  useFrame((state) => {
    const now = state.clock.getElapsedTime();
    const placedBlocks = useGameStore.getState().placedBlocks;
    
    // Update instanced mesh matrices ONLY when placedBlocks reference changes
    if (stickMeshRef.current && mudMeshRef.current && lastPlacedBlocksRef.current !== placedBlocks) {
      lastPlacedBlocksRef.current = placedBlocks;
      let stickIdx = 0;
      let mudIdx = 0;
      for (let i = 0; i < placedBlocks.length; i++) {
        const block = placedBlocks[i];
        if (block.type === 'stick') {
          if (stickIdx < MAX_DAM_BLOCKS) {
            dummy.position.set(...block.position);
            dummy.rotation.set(...block.rotation);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            stickMeshRef.current.setMatrixAt(stickIdx, dummy.matrix);
            stickIdx++;
          }
        } else {
          if (mudIdx < MAX_DAM_BLOCKS) {
            const health = block.health ?? 3;
            const scale = (health / 3) * 0.8 + 0.2;
            dummy.position.set(...block.position);
            dummy.rotation.set(...block.rotation);
            dummy.scale.set(scale, scale, scale);
            dummy.updateMatrix();
            mudMeshRef.current.setMatrixAt(mudIdx, dummy.matrix);
            mudIdx++;
          }
        }
      }
      stickMeshRef.current.count = stickIdx;
      mudMeshRef.current.count = mudIdx;
      stickMeshRef.current.instanceMatrix.needsUpdate = true;
      mudMeshRef.current.instanceMatrix.needsUpdate = true;
    }
    
    // 1Hz tick for physics (support, erosion)
    if (now - lastTick.current > 1.0) {
      lastTick.current = now;
      
      let changed = false;
      const currentBlocks = useGameStore.getState().placedBlocks;
      const newBlocks = currentBlocks.map(block => {
        if (block.type !== 'mud') return block;
        
        let newY = block.position[1];
        let newHealth = block.health ?? 3;
        
        // Check support
        const snapX = Math.round(block.position[0]);
        const snapZ = Math.round(block.position[2]);
        
        // Calculate ground height below this block
        let groundY = getTerrainHeight(snapX, snapZ);
        
        for (const other of currentBlocks) {
          if (other.id === block.id) continue;
          
          if (other.type === 'stick') {
            const dx = block.position[0] - other.position[0];
            const dz = block.position[2] - other.position[2];
            const angle = other.rotation[1];
            const localX = dx * Math.cos(-angle) - dz * Math.sin(-angle);
            const localZ = dx * Math.sin(-angle) + dz * Math.cos(-angle);
            
            if (Math.abs(localX) < 1.0 && Math.abs(localZ) < 2.5) {
              const stickTop = other.position[1] + 0.5;
              if (stickTop <= block.position[1] && stickTop > groundY) {
                groundY = stickTop;
              }
            }
          } else if (other.type === 'mud') {
            if (Math.abs(snapX - Math.round(other.position[0])) < 0.5 && 
                Math.abs(snapZ - Math.round(other.position[2])) < 0.5) {
              const mudTop = other.position[1] + 1.0;
              if (mudTop <= block.position[1] && mudTop > groundY) {
                groundY = mudTop;
              }
            }
          }
        }
        
        // Fall if unsupported
        if (newY > groundY + 0.5) {
          newY = Math.max(groundY + 0.5, newY - 1.0);
          changed = true;
        }
        
        // Check if near wood for washing away
        let nearWood = false;
        for (const other of currentBlocks) {
          if (other.type === 'stick') {
            const dx = block.position[0] - other.position[0];
            const dy = block.position[1] - other.position[1];
            const dz = block.position[2] - other.position[2];
            const distSq = dx*dx + dy*dy + dz*dz;
            if (distSq < 16) {
              nearWood = true;
              break;
            }
          }
        }

        // Wash away if submerged and not near wood
        const waterLevel = waterEngine.getSurfaceHeight(block.position[0], block.position[2]);
        if (newY < waterLevel && !nearWood) {
          newHealth -= 1;
          changed = true;
        }
        
        if (newY !== block.position[1] || newHealth !== (block.health ?? 3)) {
          return { ...block, position: [block.position[0], newY, block.position[2]] as [number, number, number], health: newHealth };
        }
        return block;
      });
      
      if (changed) {
        useGameStore.setState({ placedBlocks: newBlocks.filter(b => b.type !== 'mud' || (b.health ?? 3) > 0) });
      }
    }
  });

  return (
    <group>
      <instancedMesh ref={stickMeshRef} args={[stickGeometry, stickMaterial, MAX_DAM_BLOCKS]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={mudMeshRef} args={[mudGeometry, mudMaterial, MAX_DAM_BLOCKS]} castShadow receiveShadow frustumCulled={false} />
    </group>
  );
}
