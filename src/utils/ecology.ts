import { useGameStore } from '../store';
import { getTerrainHeight, _treeCache } from './terrain';
import { waterEngine } from './WaterEngine';

export function propagateForest() {
  const state = useGameStore.getState();
  const [px, py, pz] = state.playerPosition;
  
  let triggered = false;
  
  for(let i=0; i<30; i++) {
      const rx = px + (Math.random() * 80 - 40);
      const rz = pz + (Math.random() * 80 - 40);
      
      const height = getTerrainHeight(rx, rz);
      const depth = waterEngine.getWaterDepth(rx, rz);
      
      const hNx = getTerrainHeight(rx + 1, rz);
      const isLevel = Math.abs(hNx - height) < 0.5;
              
      const cx = Math.floor(rx / 20);
      const cz = Math.floor(rz / 20);
      const key = `${cx},${cz}`;
      
      if (!_treeCache[key]) continue;
      
      // Aquatic vegetation spawning rules (Rare milestones)
      if (depth > 0.5 && Math.random() < 0.08) {
          // Standing Deep Water -> Water Lilies
          const id = `lily_${Date.now()}_${i}`;
          _treeCache[key].push({
              id,
              position: [rx, height + depth, rz] as [number, number, number],
              type: 'lily'
          });
          triggered = true;
      } else if (depth > 0.05 && depth <= 0.5 && Math.random() < 0.05) {
          // Shallow Standing Water -> Cattails
          const id = `cattail_${Date.now()}_${i}`;
          _treeCache[key].push({
              id,
              position: [rx, height, rz] as [number, number, number],
              type: 'cattail'
          });
          triggered = true;
      } else if (height > -1 && height < 12 && isLevel && depth <= 0.05) {
          // Basic Dry Land Tree Saplings
          const id = `sapling_${Date.now()}_${i}`;
          _treeCache[key].push({
              id,
              position: [rx, height, rz] as [number, number, number],
              type: 'small'
          });
          triggered = true;
      }
  }
  
  if (triggered) {
      useGameStore.setState(s => ({
          terrainOffsets: { ...s.terrainOffsets, 'update_flag': Date.now() }
      }));
  }
}
