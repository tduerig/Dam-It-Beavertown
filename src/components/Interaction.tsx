import { useEffect, useRef, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { Platform } from 'react-native';
import { useGameStore, BlockType } from '../store';
import { getTerrainHeight, getBaseTerrainHeight, getRiverCenter, RIVER_WIDTH, CHUNK_SIZE, generateTreesForChunk } from '../utils/terrain';
import * as THREE from 'three';
import { soundEngine } from '../utils/SoundEngine';

const INTERACTION_DISTANCE = 3;

export function Interaction() {
  const virtualButtons = useGameStore((state) => state.virtualButtons);
  const prevButtons = useRef(virtualButtons);

  const handleAction = useCallback((code: string) => {
    soundEngine.init();
    const state = useGameStore.getState();
    const playerVec = new THREE.Vector3(...state.playerPosition);

    if (code === 'KeyE') {
      let collected = false;
      const chunkX = Math.floor(playerVec.x / CHUNK_SIZE);
      const chunkZ = Math.floor(playerVec.z / CHUNK_SIZE);
      
      for (const log of state.draggableLogs) {
        if (log.isMudded && !log.isDragged) continue; 
        if (log.rotation[0] < Math.PI / 2 - 0.1) continue; // Cannot pick up logs that are still falling
        
        const logVec = new THREE.Vector3(...log.position);
        if (playerVec.distanceTo(logVec) < INTERACTION_DISTANCE + 6) {
          const isCurrentlyDragged = log.isDragged;
          if (!isCurrentlyDragged) {
            const draggingAnother = state.draggableLogs.some(l => l.isDragged);
            if (!draggingAnother) {
              state.toggleDragLog(log.id, true);
              soundEngine.playChop();
              collected = true;
              break;
            }
          } else {
            state.toggleDragLog(log.id, false);
            soundEngine.playFall();
            
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
        for (let cx = chunkX - 1; cx <= chunkX + 1; cx++) {
          for (let cz = chunkZ - 1; cz <= chunkZ + 1; cz++) {
            const trees = generateTreesForChunk(cx, cz);
            for (const tree of trees) {
              const treeVec = new THREE.Vector3(...tree.position);
              const isBig = tree.type === 'big';
              const interactionDist = isBig ? INTERACTION_DISTANCE + 1 : INTERACTION_DISTANCE;
              
              if (playerVec.distanceTo(treeVec) < interactionDist) {
                if (tree.type === 'lily' || tree.type === 'cattail') {
                  state.eatSnack(tree.id, `${cx},${cz}`);
                  state.spawnParticles([tree.position[0], tree.position[1] + 0.5, tree.position[2]], '#2ecc71');
                  soundEngine.playSplash();
                  collected = true;
                  break;
                } else {
                  const maxSticks = isBig ? 12 : 3;
                  const sticks = state.treeSticks[tree.id] ?? maxSticks;
                  if (sticks > 0) {
                    state.chopTree(tree.id, isBig);
                    state.addInventory('stick', 1);
                    state.triggerAction('gather', 'stick');
                    state.spawnParticles([tree.position[0], tree.position[1] + 0.5, tree.position[2]], '#D2B48C');
                    soundEngine.playChop();
                    
                    if (isBig && sticks === 1) {
                      const dx = tree.position[0] - playerVec.x;
                      const dz = tree.position[2] - playerVec.z;
                      const fallYaw = Math.atan2(dx, dz);
                      state.addDraggableLog([tree.position[0], tree.position[1] + 9.1, tree.position[2]], [0.01, fallYaw, 0]);
                      soundEngine.playFall();
                    }
                    
                    collected = true;
                    break;
                  }
                }
              }
            }
            if (collected) break;
          }
          if (collected) break;
        }
      }

      const riverX = getRiverCenter(playerVec.z);
      if (!collected && Math.abs(playerVec.x - riverX) < RIVER_WIDTH + 2) {
        const distance = 2;
        const dx = Math.sin(state.playerRotation + Math.PI) * distance;
        const dz = Math.cos(state.playerRotation + Math.PI) * distance;
        const digX = playerVec.x + dx;
        const digZ = playerVec.z + dz;

        state.modifyTerrain(digX, digZ, -0.5, 3.0);
        state.addInventory('mud', 1);
        state.triggerAction('gather', 'mud');
        soundEngine.playSplash();
      }
    } else if (code === 'KeyF' || code === 'KeyG') {
      const type: BlockType = code === 'KeyF' ? 'stick' : 'mud';
      
      if (state.removeInventory(type, 1)) {
        const distance = 2;
        const dx = Math.sin(state.playerRotation + Math.PI) * distance;
        const dz = Math.cos(state.playerRotation + Math.PI) * distance;
        
        const placeX = playerVec.x + dx;
        const placeZ = playerVec.z + dz;
        
        if (type === 'mud') {
          state.modifyTerrain(placeX, placeZ, 0.8, 2.5);
          state.triggerAction('place', 'mud');
          soundEngine.playSplash();
          
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
              if (dx * dx + dz * dz < 9) {
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
          const snapX = Math.round(placeX * 2) / 2;
          const snapZ = Math.round(placeZ * 2) / 2;
          const stickLength = 4.0;
          const halfLen = stickLength / 2;
          const dirX = Math.sin(state.playerRotation + Math.PI);
          const dirZ = Math.cos(state.playerRotation + Math.PI);
          
          const p1x = snapX + dirX * halfLen;
          const p1z = snapZ + dirZ * halfLen;
          const p2x = snapX - dirX * halfLen;
          const p2z = snapZ - dirZ * halfLen;

          const h1 = getTerrainHeight(p1x, p1z);
          const h2 = getTerrainHeight(p2x, p2z);
          
          const dh = h1 - h2;
          const pitch = Math.atan2(dh, stickLength);
          let placeY = (h1 + h2) / 2 + 0.2;

          for (const block of state.placedBlocks) {
            if (block.type === 'stick' && Math.abs(snapX - block.position[0]) < 1.0 && Math.abs(snapZ - block.position[2]) < 1.0) {
              const blockTopY = block.position[1] + 0.4;
              placeY = Math.max(placeY, blockTopY + 0.4);
            }
          }
          
          const placePos: [number, number, number] = [snapX, placeY, snapZ];
          const qPitch = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + pitch, 0, 0, 'XYZ'));
          const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), state.playerRotation + Math.PI);
          qYaw.multiply(qPitch);
          
          const finalEuler = new THREE.Euler().setFromQuaternion(qYaw, 'XYZ');
          const placeRot: [number, number, number] = [finalEuler.x, finalEuler.y, finalEuler.z];

          state.placeBlock(placePos, placeRot, type);
          state.triggerAction('place', 'stick');
          soundEngine.playChop();
        }
      }
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      handleAction(e.code);
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleAction]);

  const lastActionTime = useRef(0);

  useEffect(() => {
    if (virtualButtons.action1 && !prevButtons.current.action1) {
      handleAction('KeyE');
      lastActionTime.current = performance.now() + 150; // Small delay before auto-repeat kicks in
    }
    if (virtualButtons.action2 && !prevButtons.current.action2) {
      handleAction('KeyF');
      lastActionTime.current = performance.now() + 150;
    }
    if (virtualButtons.action3 && !prevButtons.current.action3) {
      handleAction('KeyG');
      lastActionTime.current = performance.now() + 150;
    }
    prevButtons.current = virtualButtons;
  }, [virtualButtons, handleAction]);

  useFrame(() => {
    const now = performance.now();
    if (now - lastActionTime.current > 80) {
      const state = useGameStore.getState().virtualButtons;
      if (state.action1) {
        handleAction('KeyE');
        lastActionTime.current = now;
      } else if (state.action2) {
        handleAction('KeyF');
        lastActionTime.current = now;
      } else if (state.action3) {
        handleAction('KeyG');
        lastActionTime.current = now;
      }
    }
  });

  return null;
}
