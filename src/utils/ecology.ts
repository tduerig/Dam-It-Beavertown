import { useGameStore } from '../store';
import { getTerrainHeight, CHUNK_SIZE, worldToChunkKey } from './terrain';
import { floraCache, FloraItem } from './floraCache';
import { waterEngine } from './WaterEngine';
import { getGlobalStamp } from './terrainOffsets';

export function propagateForest() {
  const state = useGameStore.getState();
  const [px, py, pz] = state.playerPosition;
  
  let triggered = false;
  
  // Cast 800 rays per day to simulate a full night of biology spreading
  for(let i=0; i<800; i++) {
      const rx = px + (Math.random() * 80 - 40);
      const rz = pz + (Math.random() * 80 - 40);
      
      const height = getTerrainHeight(rx, rz);
      const depth = waterEngine.getWaterDepth(rx, rz);
      
      // Flow velocity check — lilies and cattails need relatively calm water
      const vel = waterEngine.getVelocity(rx, rz);
      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      const isCalmWater = speed < 1.5;
              
      // Use shared chunk key calculator
      const key = worldToChunkKey(rx, rz);
      
      const items = floraCache.get(key);
      if (items.length === 0) continue;
      
      // Deep calm water -> Water Lilies (high yield in dams)
      if (isCalmWater && depth >= 0.2 && Math.random() < 0.15) {
          const id = `lily_${Date.now()}_${i}`;
          floraCache.add(key, {
              id,
              position: [rx, height + depth, rz] as [number, number, number],
              type: 'lily'
          });
          triggered = true;
      }
      // Shallow calm water -> Cattails
      else if (isCalmWater && depth > 0.01 && depth < 0.2 && Math.random() < 0.45) {
          const id = `cattail_${Date.now()}_${i}`;
          floraCache.add(key, {
              id,
              position: [rx, height, rz] as [number, number, number],
              type: 'cattail'
          });
          triggered = true;
      }
      // Dry land saplings — light-proxy: no tree within 4 tiles
      else if (height > -1 && height < 12 && depth <= 0.01) {
          const hasLight = !items.some((t: FloraItem) =>
              ['sapling', 'small', 'big'].includes(t.type) &&
              Math.sqrt((t.position[0] - rx) ** 2 + (t.position[2] - rz) ** 2) < 4
          );
          if (hasLight && Math.random() < 0.10) {
              const id = `sapling_${Date.now()}_${i}`;
              floraCache.add(key, {
                  id,
                  position: [rx, height, rz] as [number, number, number],
                  type: 'sapling'
              });
              triggered = true;
          }
      }
  }
  
  // Growth stage transitions
  floraCache.getAllChunks().forEach(chunk => {
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
      // Signal that tree cache changed — use ecologyStamp to notify flora components
      useGameStore.setState(state => ({ ecologyStamp: state.ecologyStamp + 1 }));
  }
}
