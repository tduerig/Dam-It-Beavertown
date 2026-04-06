import { View, Text, StyleSheet, Image, Platform, Animated, Pressable } from 'react-native';
import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '../store';
import { CHUNK_SIZE, generateTreesForChunk } from '../utils/terrain';
import { waterEngine } from '../utils/WaterEngine';
import { woodEngine } from '../utils/woodEngine';
import { Sun, Moon } from 'lucide-react-native';
import { getRenderConfig } from '../utils/qualityTier';

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
  const rowSize = width * 3; 
  const padding = (4 - (rowSize % 4)) % 4;
  const rowStride = rowSize + padding;
  const fileSize = 54 + height * rowStride;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  
  view.setUint8(0, 0x42); // 'B'
  view.setUint8(1, 0x4D); // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true); 
  
  view.setUint32(14, 40, true); 
  view.setUint32(18, width, true);
  view.setInt32(22, height, true); // Strictly positive height for better cross-platform decoder compat
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  
  const bytes = new Uint8Array(buffer);
  let offset = 54;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = getPixel(x, y);
      bytes[offset++] = p.b;
      bytes[offset++] = p.g;
      bytes[offset++] = p.r;
    }
    offset += padding;
  }
  
  return 'data:image/bmp;base64,' + encodeB64(bytes);
}

export function MinimapLegend() {
  return (
    <View style={styles.legendContainer}>
      <Text style={styles.legendTitle}>MAP LEGEND</Text>
      <View style={styles.legendRow}><View style={[styles.colorBox, {backgroundColor: '#1ca3ec'}]} /><Text style={styles.legendText}>Water</Text></View>
      <View style={styles.legendRow}><View style={[styles.colorBox, {backgroundColor: '#228b22'}]} /><Text style={styles.legendText}>Small Tree</Text></View>
      <View style={styles.legendRow}><View style={[styles.colorBox, {backgroundColor: '#0a640a'}]} /><Text style={styles.legendText}>Massive Oak</Text></View>
      <View style={styles.legendRow}><View style={[styles.colorBox, {backgroundColor: '#3d2817'}]} /><Text style={styles.legendText}>Mud</Text></View>
      <View style={styles.legendRow}><View style={[styles.colorBox, {backgroundColor: '#8b4513'}]} /><Text style={styles.legendText}>Wood / Logs</Text></View>
      <View style={styles.legendRow}><View style={[styles.colorBox, {backgroundColor: '#ff0000'}]} /><Text style={styles.legendText}>Beaver</Text></View>
    </View>
  );
}

export function Minimap() {
  const [mapSource, setMapSource] = useState<string>('');
  const [coverage, setCoverage] = useState<{current: number, max: number}>({current: 0, max: 0});
  const [maxRecord, setMaxRecord] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState(0);

  useEffect(() => {
    const unsub = useGameStore.subscribe((state) => {
        setTimeOfDay(state.timeOfDay);
    });
    return unsub;
  }, []);

  const pulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const renderCfg = getRenderConfig();
    const size = renderCfg.minimapResolution;
    const halfSize = Math.floor(size / 2);
    
    const interval = setInterval(() => {
      const state = useGameStore.getState();
      const [px, py, pz] = state.playerPosition;
      const placedBlocks = state.placedBlocks;
      const draggableLogs = state.draggableLogs;
      
      // Calculate local features map
      const chunkMap = new Map<string, {r:number, g:number, b:number}>();
      
      // Plot Trees
      const chunkX = Math.floor((px + CHUNK_SIZE / 2) / CHUNK_SIZE);
      const chunkZ = Math.floor((pz + CHUNK_SIZE / 2) / CHUNK_SIZE);
      for (let cx = chunkX - 2; cx <= chunkX + 2; cx++) {
        for (let cz = chunkZ - 2; cz <= chunkZ + 2; cz++) {
          const trees = generateTreesForChunk(cx, cz);
          for (const tree of trees) {
            const isBig = tree.type === 'big';
            const sticks = woodEngine.getSticks(tree.id, isBig);
            if (sticks > 0) {
              const mx = Math.floor(tree.position[0] - px + halfSize);
              const mz = Math.floor(pz - tree.position[2] + halfSize); // Flip Z: upstream=top
              
              if (mx >= 1 && mx < size-1 && mz >= 1 && mz < size-1) {
                  const treeColor = tree.type === 'big' ? {r: 10, g: 100, b: 10} : {r: 34, g: 139, b: 34};
                  for(let i=-1; i<=1; i++) {
                     for(let j=-1; j<=1; j++) {
                         chunkMap.set(`${mx+i},${mz+j}`, treeColor); 
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
        const mz = Math.floor(pz - block.position[2] + halfSize); // Flip Z: upstream=top
        if (mx >= 1 && mx < size-1 && mz >= 1 && mz < size-1) {
           const color = block.type === 'stick' ? {r: 139, g: 69, b: 19} : {r: 61, g: 40, b: 23};
           for(let i=-1; i<=1; i++) {
               for(let j=-1; j<=1; j++) {
                   chunkMap.set(`${mx+i},${mz+j}`, color); 
               }
           }
        }
      }

      // Plot DraggableLogs
      for (const log of draggableLogs) {
        const mx = Math.floor(log.position[0] - px + halfSize);
        const mz = Math.floor(pz - log.position[2] + halfSize); // Flip Z: upstream=top
        if (mx >= 1 && mx < size-1 && mz >= 1 && mz < size-1) {
           const logColor = log.isMudded ? {r: 61, g: 40, b: 23} : {r: 139, g: 69, b: 19};
           for(let i=-1; i<=1; i++) {
               for(let j=-1; j<=1; j++) {
                   chunkMap.set(`${mx+i},${mz+j}`, logColor); 
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
      
      setMaxRecord(prev => {
        const newPeak = Math.max(prev, activeTiles);
        if (newPeak > prev && prev > 0) {
           // Pulse animation!
           Animated.sequence([
              Animated.timing(pulseScale, { toValue: 1.5, duration: 150, useNativeDriver: true }),
              Animated.timing(pulseScale, { toValue: 1, duration: 300, useNativeDriver: true })
           ]).start();
        }
        return newPeak;
      });
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
        const worldZ = pz - (y - halfSize); // Flip Z: upstream (negative Z) = top of map
        const waterHeight = waterEngine.getSurfaceHeight(worldX, worldZ);
        
        // Deep blue for flooded, vibrant grass-green for land 
        if (waterHeight > -50) {
          return {r: 28, g: 163, b: 236}; // River blue
        } else {
          return {r: 85, g: 195, b: 85}; // Vibrant grass green
        }
      });

      setMapSource(bmpData);
    }, renderCfg.minimapUpdateMs);
    
    return () => clearInterval(interval);
  }, []);

  const currentPct = coverage.max > 0 ? Math.round((coverage.current / coverage.max) * 100) : 0;
  const peakPct = coverage.max > 0 ? Math.round((maxRecord / coverage.max) * 100) : 0;

  return (
    <View style={styles.nativeWrapper} pointerEvents="box-none">
      
      {/* Dynamic Hover Legend */}
      {isHovered && Platform.OS === 'web' && (
        <View style={styles.hoverLegendPos}>
           <MinimapLegend />
        </View>
      )}

      <Pressable 
         onHoverIn={() => setIsHovered(true)} 
         onHoverOut={() => setIsHovered(false)}
         style={styles.container}
      >

        
        <View style={[styles.statsPanel, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.statsValue}>💧 {currentPct}%</Text>
            <Animated.Text style={[styles.statsHigh, { transform: [{ scale: pulseScale }] }]}>
               (Peak: {peakPct}%)
            </Animated.Text>
          </View>
          <View style={{ paddingRight: 4 }}>
            {timeOfDay >= 0.75 && timeOfDay < 0.95 ? (
               <Moon size={14} color="#94a3b8" fill="#e2e8f0" strokeWidth={2.5} />
            ) : (
               <Sun size={14} color="#fbbf24" fill="#fbbf24" strokeWidth={2.5} />
            )}
          </View>
        </View>

        <View style={styles.canvasWrapper}>
          {mapSource ? (
            <Image 
              source={{ uri: mapSource }} 
              style={{ width: 160, height: 160, resizeMode: 'stretch' }} 
              {...Platform.select({ web: { style: { width: 160, height: 160, imageRendering: 'pixelated' } } })}
            />
          ) : (
            <View style={styles.placeholder}>
               <Text style={styles.placeholderText}>Mapping...</Text>
            </View>
          )}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  nativeWrapper: {
    position: 'absolute',
    top: 100,
    left: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    pointerEvents: 'box-none',
    zIndex: 50,
  },
  container: {
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
  hoverLegendPos: {
    marginRight: 12,
  },
  statsPanel: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderBottomWidth: 2,
    borderBottomColor: '#78350f',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  statsValue: {
    color: '#fef3c7',
    fontSize: 13,
    fontWeight: 'bold',
  },
  statsHigh: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '900',
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
    backgroundColor: '#55c355', 
  },
  
  // Legend Styles
  legendContainer: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    borderWidth: 2,
    borderColor: '#78350f',
    borderRadius: 8,
    padding: 12,
    width: 140,
  },
  legendTitle: {
    color: '#fef3c7',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 1,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  colorBox: {
    width: 12,
    height: 12,
    marginRight: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  legendText: {
    color: '#d1d5db',
    fontSize: 11,
    fontWeight: '600',
  }
});
