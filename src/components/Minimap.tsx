import { View, Text, StyleSheet, Image, Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { useGameStore } from '../store';
import { CHUNK_SIZE, generateTreesForChunk } from '../utils/terrain';
import { waterEngine } from '../utils/WaterEngine';

const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encodeB64(bytes: Uint8Array) {
  let result = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    const c = i + 2 < len ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    result += chars[n >> 18] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
  }
  const padding = len % 3;
  if (padding === 1) return result.slice(0, -2) + '==';
  if (padding === 2) return result.slice(0, -1) + '=';
  return result;
}

function generateBMPb64(width: number, height: number, getPixel: (x: number, y: number) => {r:number, g:number, b:number}) {
  const rowSize = width * 4; 
  const fileSize = 54 + height * rowSize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  
  view.setUint16(0, 0x4D42, false);
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true); 
  
  view.setUint32(14, 40, true); 
  view.setUint32(18, width, true);
  view.setInt32(22, height, true); // Strictly positive height for better cross-platform decoder compat
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  
  const bytes = new Uint8Array(buffer);
  let offset = 54;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = getPixel(x, y);
      bytes[offset++] = p.b;
      bytes[offset++] = p.g;
      bytes[offset++] = p.r;
      bytes[offset++] = 255;
    }
  }
  
  return 'data:image/bmp;base64,' + encodeB64(bytes);
}

export function Minimap() {
  const [mapSource, setMapSource] = useState<string>('');
  const [coverage, setCoverage] = useState<{current: number, max: number}>({current: 0, max: 0});
  const [maxRecord, setMaxRecord] = useState(0);

  useEffect(() => {
    const size = 100;
    const halfSize = size / 2;
    
    const interval = setInterval(() => {
      const state = useGameStore.getState();
      const [px, py, pz] = state.playerPosition;
      const placedBlocks = state.placedBlocks;
      const treeSticks = state.treeSticks;
      
      // Calculate local features map
      const chunkMap = new Map<string, {r:number, g:number, b:number}>();
      
      // Plot Trees
      const chunkX = Math.floor(px / CHUNK_SIZE);
      const chunkZ = Math.floor(pz / CHUNK_SIZE);
      for (let cx = chunkX - 2; cx <= chunkX + 2; cx++) {
        for (let cz = chunkZ - 2; cz <= chunkZ + 2; cz++) {
          const trees = generateTreesForChunk(cx, cz);
          for (const tree of trees) {
            const sticks = treeSticks[tree.id] ?? 3;
            if (sticks > 0) {
              const mx = Math.floor(tree.position[0] - px + halfSize);
              const mz = Math.floor(tree.position[2] - pz + halfSize);
              
              // Draw 3x3 tree node
              if (mx >= 1 && mx < size-1 && mz >= 1 && mz < size-1) {
                  for(let i=-1; i<=1; i++) {
                     for(let j=-1; j<=1; j++) {
                         chunkMap.set(`${mx+i},${mz+j}`, {r: 34, g: 139, b: 34}); 
                     }
                  }
              }
            }
          }
        }
      }

      // Plot placed blocks (Dams)
      for (const block of placedBlocks) {
        const mx = Math.floor(block.position[0] - px + halfSize);
        const mz = Math.floor(block.position[2] - pz + halfSize);
        if (mx >= 1 && mx < size-1 && mz >= 1 && mz < size-1) {
           const color = block.type === 'stick' ? {r: 139, g: 69, b: 19} : {r: 61, g: 40, b: 23};
           for(let i=-1; i<=1; i++) {
               for(let j=-1; j<=1; j++) {
                   chunkMap.set(`${mx+i},${mz+j}`, color); 
               }
           }
        }
      }

      // Calculate global water coverage metrics mapping native physics array tracking!
      let activeTiles = 0;
      const totalTiles = waterEngine.size * waterEngine.size;
      for (let i = 0; i < totalTiles; i++) {
        if (waterEngine.W[i] > 0.1) activeTiles++;
      }
      
      setMaxRecord(prev => Math.max(prev, activeTiles));
      setCoverage({ current: activeTiles, max: totalTiles });

      // Generate Native Pixel Layer
      const bmpData = generateBMPb64(size, size, (x, y) => {
        // Player cursor
        if (Math.abs(x - halfSize) <= 2 && Math.abs(y - halfSize) <= 2) {
          return {r: 255, g: 0, b: 0}; 
        }
        
        const overlay = chunkMap.get(`${x},${y}`);
        if (overlay) return overlay;

        const worldX = px + (x - halfSize);
        const worldZ = pz + (y - halfSize);
        const waterHeight = waterEngine.getSurfaceHeight(worldX, worldZ);
        
        // Deep blue for flooded, vibrant grass-green for land 
        if (waterHeight > -50) {
          return {r: 28, g: 163, b: 236}; // River blue
        } else {
          return {r: 85, g: 195, b: 85}; // Vibrant grass green
        }
      });

      setMapSource(bmpData);
    }, 250); // Fluid 4FPS mapping prevents CPU overload fully mapped natively
    
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.nativeContainer} pointerEvents="none">
      <View style={styles.header}>
        <Text style={styles.headerText}>MINIMAP</Text>
      </View>
      
      <View style={styles.statsPanel}>
        <Text style={styles.statsLabel}>WATER COVERAGE</Text>
        <Text style={styles.statsValue}>C: {coverage.current} / {coverage.max}</Text>
        <Text style={styles.statsHigh}>PEAK: {maxRecord}</Text>
      </View>

      <View style={styles.canvasWrapper}>
        {mapSource ? (
          <Image 
            source={{ uri: mapSource }} 
            style={{ width: 160, height: 160, resizeMode: 'stretch' }} 
            // `imageRendering: pixelated` is web-only, but CSS injected via style array will pass through mapped Web fallback
            {...Platform.select({ web: { style: { width: 160, height: 160, imageRendering: 'pixelated' } } })}
          />
        ) : (
          <View style={styles.placeholder}>
             <Text style={styles.placeholderText}>Mapping...</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nativeContainer: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    borderWidth: 4,
    borderColor: '#78350f',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(254, 243, 199, 0.9)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  header: {
    backgroundColor: '#78350f',
    paddingVertical: 4,
    alignItems: 'center',
    zIndex: 10,
  },
  headerText: {
    color: '#fef3c7',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  statsPanel: {
    padding: 6,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderBottomWidth: 2,
    borderBottomColor: '#78350f',
    alignItems: 'center',
  },
  statsLabel: {
    color: '#38bdf8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  statsValue: {
    color: '#fef3c7',
    fontSize: 12,
    fontWeight: 'bold',
  },
  statsHigh: {
    color: '#fbbf24',
    fontSize: 9,
    fontWeight: 'bold',
  },
  placeholder: {
    width: 160,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  placeholderText: {
    color: '#333',
    fontSize: 10,
    textAlign: 'center',
  },
  canvasWrapper: {
    width: 160,
    height: 160,
    backgroundColor: '#55c355', // Vibrant green fallback instead of olive
  }
});
