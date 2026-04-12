import { useGameStore } from '../store';
import { getTerrainHeight, CHUNK_SIZE, worldToChunkKey } from './terrain';
import { floraCache, FloraItem } from './floraCache';
import { waterEngine } from './WaterEngine';
import { getGlobalStamp } from './terrainOffsets';

export function propagateForest(customEng?: any, customPos?: [number, number, number]) {
  const state = useGameStore.getState();
  const [px, py, pz] = customPos || state.playerPosition;
  const eng = customEng || waterEngine;
  
  let triggered = false;
  
  // Cast 800 rays per day to simulate a full night of biology spreading
  for(let i=0; i<800; i++) {
      const rx = px + (Math.random() * 80 - 40);
      const rz = pz + (Math.random() * 80 - 40);
      
      const height = getTerrainHeight(rx, rz);
      const depth = eng.getWaterDepth(rx, rz);
      
      // Flow velocity check — lilies and cattails need relatively calm water
      const vel = eng.getVelocity(rx, rz);
      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
      const isCalmWater = speed < 1.5;
              
      // Use shared chunk key calculator
      const key = worldToChunkKey(rx, rz);
      
      const items = floraCache.get(key);
      
      // Count existing aquatic flora in this chunk to cap density
      const lilyCount = items.filter(f => f.type === 'lily').length;
      const cattailCount = items.filter(f => f.type === 'cattail').length;
      
      // Minimum distance check helper — prevents spawning on top of existing flora
      const tooCloseToExisting = (pos: [number, number, number], minDist: number) =>
        items.some(f => 
          (f.type === 'lily' || f.type === 'cattail') &&
          Math.sqrt((f.position[0] - pos[0]) ** 2 + (f.position[2] - pos[2]) ** 2) < minDist
        );
      
      // Altitude-based growth multiplier for aquatic flora.
      // The "green-zone" is centered around altitude 5, fading to 0 at -2 and 12 (range of 7)
      const surfaceAlt = height + depth;
      const greenZoneFalloff = Math.max(0, 1 - Math.abs(surfaceAlt - 5) / 7);

      // Deep calm water -> Water Lilies (capped at 8 per chunk)
      // Lilies THRIVE in deep, still water — exactly what beaver ponds create
      const depthBonus = Math.min(1.5, depth / 2.0); // Deeper water = more lilies
      if (isCalmWater && depth >= 0.5 && lilyCount < 8 && Math.random() < 0.10 * greenZoneFalloff * depthBonus) {
          const pos: [number, number, number] = [rx, height + depth, rz];
          if (!tooCloseToExisting(pos, 3)) {
              const id = `lily_${Date.now()}_${i}`;
              floraCache.add(key, { id, position: pos, type: 'lily' });
              triggered = true;
          }
      }
      // Shallow calm water -> Cattails (capped at 10 per chunk)
      // Cattails love the marshy edges — shallow flooded banks from beaver channels
      // shallowBonus peaks at very shallow depth, fading toward 0.6
      else if (isCalmWater && depth > 0.02 && depth < 0.6 && cattailCount < 10 && Math.random() < 0.18 * greenZoneFalloff * (0.5 + Math.max(0, 1 - depth / 0.6))) {
          const pos: [number, number, number] = [rx, height + depth, rz];
          if (!tooCloseToExisting(pos, 3)) {
              const id = `cattail_${Date.now()}_${i}`;
              floraCache.add(key, { id, position: pos, type: 'cattail' });
              triggered = true;
          }
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
