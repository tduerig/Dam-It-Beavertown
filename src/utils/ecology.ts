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
      // Aquatic vegetation spawning rules
      if (depth > 0.05 && Math.random() < 0.15) {
          // Standing Deep Water -> Water Lilies
          const id = `lily_${Date.now()}_${i}`;
          _treeCache[key].push({
              id,
              position: [rx, height + depth, rz] as [number, number, number],
              type: 'lily'
          });
          triggered = true;
      } else if (height > -1 && height < 12 && depth <= 0.05 && Math.random() < 0.08) {
          // Shallow edge / wet mud -> Cattails
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
              type: 'sapling'
          });
          triggered = true;
      }
  }
  
  // Growth stage transitions
  Object.values(_treeCache).forEach(chunk => {
      chunk.forEach(tree => {
          if (tree.type === 'sapling' && Math.random() < 0.6) {
              tree.type = 'small';
              triggered = true;
          } else if (tree.type === 'small' && Math.random() < 0.05) {
              tree.type = 'big';
              triggered = true;
          }
      });
  });
  
  if (triggered) {
      useGameStore.setState(s => ({
          terrainOffsets: { ...s.terrainOffsets, 'update_flag': Date.now() }
      }));
  }
}
