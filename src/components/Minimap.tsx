import { View, Text, StyleSheet, Platform, Animated, Pressable } from 'react-native';
import { useEffect, useState, useRef } from 'react';
import { useGameStore } from '../store';
import { CHUNK_SIZE, generateTreesForChunk } from '../utils/terrain';
import { waterEngine } from '../utils/WaterEngine';
import { woodEngine } from '../utils/woodEngine';
import { Sun, Moon } from 'lucide-react-native';
import { generateBMPb64 } from '../utils/bmpRenderer';
import { currentWaterTiles } from './MinimapHUD';

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

/**
 * Capture a minimap thumbnail for save-slot previews.
 * Generates a 64x64 BMP data URI centered on the current player position.
 * Called on-demand at save time — not on a timer.
 */
export function captureMinimapThumbnail(): string {
  const size = 64;
  const halfSize = 32;
  const state = useGameStore.getState();
  const [px, _py, pz] = state.playerPosition;
  const placedBlocks = state.placedBlocks;
  const draggableLogs = state.draggableLogs;

  const chunkMap = new Map<number, {r:number, g:number, b:number}>();

  // Trees
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
          const mz = Math.floor(tree.position[2] - pz + halfSize);
          if (mx >= 1 && mx < size - 1 && mz >= 1 && mz < size - 1) {
            const treeColor = isBig ? {r: 10, g: 100, b: 10} : {r: 34, g: 139, b: 34};
            for (let i = -1; i <= 1; i++) {
              for (let j = -1; j <= 1; j++) {
                chunkMap.set((mz + j) * size + (mx + i), treeColor);
              }
            }
          }
        }
      }
    }
  }

  // Placed blocks
  for (const block of placedBlocks) {
    const mx = Math.floor(block.position[0] - px + halfSize);
    const mz = Math.floor(block.position[2] - pz + halfSize);
    if (mx >= 1 && mx < size - 1 && mz >= 1 && mz < size - 1) {
      const color = block.type === 'stick' ? {r: 139, g: 69, b: 19} : {r: 61, g: 40, b: 23};
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          chunkMap.set((mz + j) * size + (mx + i), color);
        }
      }
    }
  }

  // Draggable logs
  for (const log of draggableLogs) {
    const mx = Math.floor(log.position[0] - px + halfSize);
    const mz = Math.floor(log.position[2] - pz + halfSize);
    if (mx >= 1 && mx < size - 1 && mz >= 1 && mz < size - 1) {
      const logColor = log.isMudded ? {r: 61, g: 40, b: 23} : {r: 139, g: 69, b: 19};
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          chunkMap.set((mz + j) * size + (mx + i), logColor);
        }
      }
    }
  }

  return generateBMPb64(size, size, (x, y) => {
    if (x === halfSize && y === halfSize) return {r: 255, g: 0, b: 0};
    const overlay = chunkMap.get(y * size + x);
    if (overlay) return overlay;
    const worldX = px + (x - halfSize);
    const worldZ = pz + (y - halfSize);
    const waterHeight = waterEngine.getSurfaceHeight(worldX, worldZ);
    return waterHeight > -50 ? {r: 28, g: 163, b: 236} : {r: 85, g: 195, b: 85};
  });
}

export function Minimap() {
  const [coverage, setCoverage] = useState<{current: number, max: number}>({current: 0, max: 0});
  const [maxRecord, setMaxRecord] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState(0);

  const pulseScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      const state = useGameStore.getState();
      setTimeOfDay(state.timeOfDay);

      // Read precomputed water coverage from MinimapHUD (avoids duplicate 25,600-cell scan)
      const activeTiles = currentWaterTiles;
      const totalTiles = waterEngine.size * waterEngine.size;

      setMaxRecord(prev => {
        const newPeak = Math.max(prev, activeTiles);
        if (newPeak > prev && prev > 0) {
          Animated.sequence([
            Animated.timing(pulseScale, { toValue: 1.5, duration: 150, useNativeDriver: true }),
            Animated.timing(pulseScale, { toValue: 1, duration: 300, useNativeDriver: true })
          ]).start();
        }
        return newPeak;
      });
      setCoverage({ current: activeTiles, max: totalTiles });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const currentPct = coverage.max > 0 ? Math.round((coverage.current / coverage.max) * 100) : 0;
  const peakPct = coverage.max > 0 ? Math.round((maxRecord / coverage.max) * 100) : 0;

  return (
    <View style={styles.nativeWrapper} pointerEvents="box-none">
      <Pressable 
        onHoverIn={() => setIsHovered(true)} 
        onHoverOut={() => setIsHovered(false)}
        style={styles.container}
      >
        <View style={[styles.statsPanel, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View style={{ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' }}>
            <Text style={styles.statsValue}>💧 {currentPct}%</Text>
            <Animated.Text style={[styles.statsHigh, { transform: [{ scale: pulseScale }], marginLeft: 22 }]}>
              Peak: {peakPct}%
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

        <View style={styles.canvasWrapper} />
      </Pressable>

      {/* Dynamic Hover Legend */}
      {isHovered && Platform.OS === 'web' && (
        <View style={styles.hoverLegendPos}>
          <MinimapLegend />
        </View>
      )}
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
    backgroundColor: 'transparent',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  hoverLegendPos: {
    marginLeft: 12,
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
  canvasWrapper: {
    width: 154,
    height: 154,
    backgroundColor: 'transparent',
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
