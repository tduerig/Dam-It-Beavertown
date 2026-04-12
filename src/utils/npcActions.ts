import { useGameStore, BlockType } from '../store';
import { woodEngine } from './woodEngine';
import { getTerrainHeight, getBaseTerrainHeight } from './terrain';
import { gatherMud } from './mudEngine';
import * as THREE from 'three';
import { soundEngine } from './SoundEngine';

export const npcActions = {
  chopTree(entityPos: THREE.Vector3, tree: { id: string, type: 'big' | 'small' | 'sapling', position: number[] }, chunkKey: string) {
    const state = useGameStore.getState();
    const isBig = tree.type === 'big';
    const sticks = woodEngine.getSticks(tree.id, isBig);
    if (sticks > 0) {
      state.chopTree(tree.id, isBig, chunkKey);
      state.addInventory('stick', 1);
      state.spawnParticles([tree.position[0], tree.position[1] + 0.5, tree.position[2]], '#D2B48C');
      soundEngine.playChop();
      
      let newLogId: string | null = null;
      if (isBig && sticks === 1) {
        const dx = tree.position[0] - entityPos.x;
        const dz = tree.position[2] - entityPos.z;
        const fallYaw = Math.atan2(dx, dz);
        state.addDraggableLog([tree.position[0], tree.position[1] + 9.1, tree.position[2]], [0.01, fallYaw, 0]);
        soundEngine.playFall();
        
        // Grab the newly created log ID by referencing the updated state
        const updatedLogs = useGameStore.getState().draggableLogs;
        newLogId = updatedLogs[updatedLogs.length - 1].id;
      }
      return { felled: sticks === 1, newLogId };
    }
    return { felled: false, newLogId: null };
  },

  eatSnack(snack: { id: string, type: 'lily' | 'cattail' | 'sapling', position: number[] }, chunkKey: string) {
    const state = useGameStore.getState();
    state.eatSnack(snack.id, chunkKey);
    state.spawnParticles([snack.position[0], snack.position[1] + 0.5, snack.position[2]], snack.type === 'sapling' ? '#8b4513' : '#2ecc71');
    soundEngine.playSplash();
  },

  digMud(targetCoords: { x: number, z: number }) {
    const state = useGameStore.getState();
    state.modifyTerrain(targetCoords.x, targetCoords.z, -0.5, 3.0);
    gatherMud(targetCoords.x, targetCoords.z);
    state.addInventory('mud', 1);
    soundEngine.playSplash();
  },

  placeMud(targetCoords: { x: number, z: number }) {
    const state = useGameStore.getState();
    // For NPC simulation to flow smoothly, we bypass strict player inventory constraints 
    // occasionally if they got out of sync, but we try to respect it.
    if (state.inventory.mud >= 1) {
        state.removeInventory('mud', 1);
    }
    
    state.modifyTerrain(targetCoords.x, targetCoords.z, 0.8, 2.5);
    soundEngine.playSplash();
    
    // Cement nearby logs
    state.draggableLogs.forEach(log => {
      const dx = log.position[0] - targetCoords.x;
      const dz = log.position[2] - targetCoords.z;
      if (dx * dx + dz * dz < 15) {
        state.setLogMudded(log.id, true);
        soundEngine.playSplash();
      }
    });
    return true;
  },

  placeStick(entityRot: number, targetCoords: { x: number, z: number }) {
    const state = useGameStore.getState();
    // Ensure they have sticks to place
    if (state.inventory.sticks >= 1) {
      state.removeInventory('stick', 1);
    }

    const snapX = Math.round(targetCoords.x * 2) / 2;
    const snapZ = Math.round(targetCoords.z * 2) / 2;
    const stickLength = 4.0;
    const halfLen = stickLength / 2;
    const dirX = Math.sin(entityRot + Math.PI);
    const dirZ = Math.cos(entityRot + Math.PI);
    
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
    const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), entityRot + Math.PI);
    qYaw.multiply(qPitch);
    
    const finalEuler = new THREE.Euler().setFromQuaternion(qYaw, 'XYZ');
    const placeRot: [number, number, number] = [finalEuler.x, finalEuler.y, finalEuler.z];

    state.placeBlock(placePos, placeRot, 'stick');
    soundEngine.playChop();
    return true;
  },

  pickupLog(logId: string) {
    const state = useGameStore.getState();
    const log = state.draggableLogs.find(l => l.id === logId);
    if (!log || log.isDragged || log.isMudded) return false;
    
    state.toggleDragLog(logId, true);
    soundEngine.playChop();
    return true;
  },

  dropLog(logId: string) {
    const state = useGameStore.getState();
    const log = state.draggableLogs.find(l => l.id === logId);
    if (!log || !log.isDragged) return false;

    state.toggleDragLog(logId, false);
    soundEngine.playFall();
    
    // Instantly check if dropped on heavily modified terrain (mudded)
    // Note: The physical log position might take a frame to settle, so we check origin broadly
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
        state.setLogMudded(logId, true);
    }
    return true;
  }
};
