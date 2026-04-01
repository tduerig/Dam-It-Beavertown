import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../store';
import { getTerrainHeight } from '../utils/terrain';
import { waterEngine } from '../utils/WaterEngine';
import * as THREE from 'three';

export function Dam() {
  const placedBlocks = useGameStore((state) => state.placedBlocks);
  const lastTick = useRef(0);

  useFrame((state) => {
    const now = state.clock.getElapsedTime();
    if (now - lastTick.current > 1.0) { // 1 second tick
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
            // Stick is a cylinder length 4
            const dx = block.position[0] - other.position[0];
            const dz = block.position[2] - other.position[2];
            const angle = other.rotation[1];
            // Rotate dx, dz back to stick local space
            const localX = dx * Math.cos(-angle) - dz * Math.sin(-angle);
            const localZ = dx * Math.sin(-angle) + dz * Math.cos(-angle);
            
            // Stick radius is 0.5, length is 4 (so localZ is within -2 to 2)
            if (Math.abs(localX) < 1.0 && Math.abs(localZ) < 2.5) {
              const stickTop = other.position[1] + 0.5;
              if (stickTop <= block.position[1] && stickTop > groundY) {
                groundY = stickTop;
              }
            }
          } else if (other.type === 'mud') {
            if (Math.abs(snapX - Math.round(other.position[0])) < 0.5 && 
                Math.abs(snapZ - Math.round(other.position[2])) < 0.5) {
              const mudTop = other.position[1] + 1.0; // mud height is 1
              if (mudTop <= block.position[1] && mudTop > groundY) {
                groundY = mudTop;
              }
            }
          }
        }
        
        // Fall if unsupported
        if (newY > groundY + 0.5) {
          newY = Math.max(groundY + 0.5, newY - 1.0); // Fall 1 unit per tick
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
            if (distSq < 16) { // within 4 units
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

  const { stickGeometry, mudGeometry, stickMaterial, mudMaterial } = useMemo(() => {
    return {
      stickGeometry: new THREE.CylinderGeometry(0.5, 0.5, 4, 8),
      mudGeometry: new THREE.DodecahedronGeometry(0.6, 1),
      stickMaterial: new THREE.MeshStandardMaterial({ color: '#8B4513' }),
      mudMaterial: new THREE.MeshStandardMaterial({ color: '#5C4033', roughness: 1 }),
    };
  }, []);

  return (
    <group>
      {placedBlocks.map((block) => {
        const isMud = block.type === 'mud';
        const health = block.health ?? 3;
        const scale = isMud ? (health / 3) * 0.8 + 0.2 : 1;
        
        return (
          <mesh
            key={block.id}
            position={block.position}
            geometry={isMud ? mudGeometry : stickGeometry}
            material={isMud ? mudMaterial : stickMaterial}
            rotation={block.rotation}
            scale={[scale, scale, scale]}
            castShadow
            receiveShadow
          />
        );
      })}
    </group>
  );
}
