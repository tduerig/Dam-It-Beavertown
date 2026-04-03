import { useEffect, useRef } from 'react';
import { useGameStore, BlockType } from '../store';
import { getTerrainHeight, getBaseTerrainHeight, getRiverCenter, RIVER_WIDTH, CHUNK_SIZE, generateTreesForChunk } from '../utils/terrain';
import * as THREE from 'three';
import { soundEngine } from '../utils/SoundEngine';

const INTERACTION_DISTANCE = 3;

export function Interaction() {
  const virtualButtons = useGameStore((state) => state.virtualButtons);
  const prevButtons = useRef(virtualButtons);

  useEffect(() => {
    const handleAction = (code: string) => {
      soundEngine.init();
      const state = useGameStore.getState();
      const playerVec = new THREE.Vector3(...state.playerPosition);

      if (code === 'KeyE') {
        // Collect
        let collected = false;

        const chunkX = Math.floor(playerVec.x / CHUNK_SIZE);
        const chunkZ = Math.floor(playerVec.z / CHUNK_SIZE);
        
        // Check draggable logs first
        for (const log of state.draggableLogs) {
          if (log.isMudded && !log.isDragged) continue; // Cannot pick up mudded logs, but can drop them if somehow dragged
          if (log.rotation[0] < Math.PI / 2 - 0.1) continue; // Cannot pick up logs that are still falling
          
          const logVec = new THREE.Vector3(...log.position);
          if (playerVec.distanceTo(logVec) < INTERACTION_DISTANCE + 6) {
            // Toggle drag state
            const isCurrentlyDragged = log.isDragged;
            // If we are picking it up, ensure we aren't already dragging something
            if (!isCurrentlyDragged) {
              const draggingAnother = state.draggableLogs.some(l => l.isDragged);
              if (!draggingAnother) {
                state.toggleDragLog(log.id, true);
                soundEngine.playChop();
                collected = true;
                break;
              }
            } else {
              // Drop it
              state.toggleDragLog(log.id, false);
              soundEngine.playFall();
              
              // Check if dropped on mud
              const checkPoints = [
                [log.position[0], log.position[2]],
                [log.position[0] + Math.sin(log.rotation[1]) * 4, log.position[2] + Math.cos(log.rotation[1]) * 4],
                [log.position[0] - Math.sin(log.rotation[1]) * 4, log.position[2] - Math.cos(log.rotation[1]) * 4],
              ];
              let isMudded = false;
              for (const [x, z] of checkPoints) {
                const h = getTerrainHeight(x, z);
                const baseH = getBaseTerrainHeight(x, z);
                if (h - baseH > 0.1) {
                  isMudded = true;
                  break;
                }
              }
              if (isMudded) {
                 state.setLogMudded(log.id, true);
              }
              
              collected = true;
              break;
            }
          }
        }

        if (!collected) {
          // Check trees in current and adjacent chunks
          for (let cx = chunkX - 1; cx <= chunkX + 1; cx++) {
            for (let cz = chunkZ - 1; cz <= chunkZ + 1; cz++) {
              const trees = generateTreesForChunk(cx, cz);
              for (const tree of trees) {
                const treeVec = new THREE.Vector3(...tree.position);
                const isBig = tree.type === 'big';
                const interactionDist = isBig ? INTERACTION_DISTANCE + 1 : INTERACTION_DISTANCE;
                
                if (playerVec.distanceTo(treeVec) < interactionDist) {
                  const maxSticks = isBig ? 12 : 3;
                  const sticks = state.treeSticks[tree.id] ?? maxSticks;
                  if (sticks > 0) {
                    state.chopTree(tree.id, isBig);
                    state.addInventory('stick', 1);
                    state.triggerAction('gather', 'stick');
                    state.spawnParticles([tree.position[0], tree.position[1] + 0.5, tree.position[2]], '#D2B48C');
                    soundEngine.playChop();
                    
                    // If this was the last stick of a big tree, spawn a draggable log
                    if (isBig && sticks === 1) {
                      // Spawn log standing upright to teeter and fall
                      // Fall in the direction the player is facing (angle of attack)
                      const fallYaw = state.playerRotation + Math.PI;
                      state.addDraggableLog([tree.position[0], tree.position[1] + 9.1, tree.position[2]], [0.01, fallYaw, 0]);
                      soundEngine.playFall();
                    }
                    
                    collected = true;
                    break;
                  }
                }
              }
              if (collected) break;
            }
            if (collected) break;
          }
        }

        // Check water (mud collection)
        const riverX = getRiverCenter(playerVec.z);
        if (!collected && Math.abs(playerVec.x - riverX) < RIVER_WIDTH + 2) {
          // Calculate position in front of player to dig mud
          const distance = 2;
          const dx = Math.sin(state.playerRotation + Math.PI) * distance;
          const dz = Math.cos(state.playerRotation + Math.PI) * distance;
          const digX = playerVec.x + dx;
          const digZ = playerVec.z + dz;

          state.modifyTerrain(digX, digZ, -0.5, 3.0); // Dig a hole
          state.addInventory('mud', 1);
          state.triggerAction('gather', 'mud');
          soundEngine.playSplash();
        }
      } else if (code === 'KeyF' || code === 'KeyG') {
        // Place block
        const type: BlockType = code === 'KeyF' ? 'stick' : 'mud';
        
        if (state.removeInventory(type, 1)) {
          // Calculate position in front of player
          const distance = 2; // Place 2 units in front
          const dx = Math.sin(state.playerRotation + Math.PI) * distance;
          const dz = Math.cos(state.playerRotation + Math.PI) * distance;
          
          const placeX = playerVec.x + dx;
          const placeZ = playerVec.z + dz;
          
          if (type === 'mud') {
            // Mud blobs onto the terrain
            state.modifyTerrain(placeX, placeZ, 0.8, 2.5);
            state.triggerAction('place', 'mud');
            soundEngine.playSplash();
            
            // Cement any logs near the mud
            state.draggableLogs.forEach(log => {
              const checkPoints = [
                [log.position[0], log.position[2]],
                [log.position[0] + Math.sin(log.rotation[1]) * 4, log.position[2] + Math.cos(log.rotation[1]) * 4],
                [log.position[0] - Math.sin(log.rotation[1]) * 4, log.position[2] - Math.cos(log.rotation[1]) * 4],
              ];
              let isNearMud = false;
              for (const [x, z] of checkPoints) {
                const dx = x - placeX;
                const dz = z - placeZ;
                if (dx * dx + dz * dz < 9) { // radius 3 squared from any point
                  isNearMud = true;
                  break;
                }
              }
              if (isNearMud) {
                state.setLogMudded(log.id, true);
                soundEngine.playSplash();
              }
            });
          } else {
            // Stick placement
            const snapX = Math.round(placeX * 2) / 2;
            const snapZ = Math.round(placeZ * 2) / 2;

            // Calculate stick endpoints to align with terrain
            const stickLength = 4.0; // Stick length is 4
            const halfLen = stickLength / 2;
            const dirX = Math.sin(state.playerRotation + Math.PI);
            const dirZ = Math.cos(state.playerRotation + Math.PI);
            
            const p1x = snapX + dirX * halfLen;
            const p1z = snapZ + dirZ * halfLen;
            const p2x = snapX - dirX * halfLen;
            const p2z = snapZ - dirZ * halfLen;

            const h1 = getTerrainHeight(p1x, p1z);
            const h2 = getTerrainHeight(p2x, p2z);
            
            // Calculate pitch to align with terrain slope
            const dh = h1 - h2;
            const pitch = Math.atan2(dh, stickLength);

            let placeY = (h1 + h2) / 2 + 0.2; // Center height + offset

            // Check for existing blocks at this location to stack
            for (const block of state.placedBlocks) {
              if (block.type === 'stick' && Math.abs(snapX - block.position[0]) < 1.0 && Math.abs(snapZ - block.position[2]) < 1.0) {
                const blockTopY = block.position[1] + 0.4;
                placeY = Math.max(placeY, blockTopY + 0.4);
              }
            }
            
            const placePos: [number, number, number] = [snapX, placeY, snapZ];
            
            // Create a quaternion to handle the rotation correctly
            const qPitch = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + pitch, 0, 0, 'XYZ'));
            const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.playerRotation + Math.PI);
            qYaw.multiply(qPitch); // Apply pitch first, then yaw
            
            const finalEuler = new THREE.Euler().setFromQuaternion(qYaw, 'XYZ');
            
            const placeRot: [number, number, number] = [finalEuler.x, finalEuler.y, finalEuler.z];

            state.placeBlock(placePos, placeRot, type);
            state.triggerAction('place', 'stick');
            soundEngine.playChop();
          }
        }
      }
    };

    // Handle keyboard
    const handleKeyDown = (e: KeyboardEvent) => {
      handleAction(e.code);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    // Handle virtual buttons (rising edge)
    if (virtualButtons.action1 && !prevButtons.current.action1) {
      // Collect
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    }
    if (virtualButtons.action2 && !prevButtons.current.action2) {
      // Place Stick
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF' }));
    }
    if (virtualButtons.action3 && !prevButtons.current.action3) {
      // Place Mud
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
    }
    prevButtons.current = virtualButtons;
  }, [virtualButtons]);

  return null;
}
