import { Platform, View, Text, StyleSheet } from 'react-native';
import { useEffect, useRef } from 'react';
import { useGameStore } from '../store';
import { getTerrainHeight, getRiverCenter, RIVER_WIDTH, generateTreesForChunk, CHUNK_SIZE } from '../utils/terrain';
import { waterEngine } from '../utils/WaterEngine';

export function Minimap() {
  if (Platform.OS !== 'web') {
    return (
      <View style={styles.nativeContainer}>
        <View style={styles.header}><Text style={styles.headerText}>MINIMAP</Text></View>
        <View style={styles.placeholder}><Text style={styles.placeholderText}>Map disabled on mobile MVP</Text></View>
      </View>
    );
  }

  // Web only implementation using canvas
  const canvasRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let lastRender = 0;

    const render = (time: number) => {
      animationFrameId = requestAnimationFrame(render);
      if (time - lastRender < 100) return;
      lastRender = time;

      const state = useGameStore.getState();
      const [px, py, pz] = state.playerPosition;
      const placedBlocks = state.placedBlocks;
      const treeSticks = state.treeSticks;

      const size = 100;
      const halfSize = size / 2;
      ctx.clearRect(0, 0, size, size);

      const imgData = ctx.createImageData(size, size);
      const data = imgData.data;

      for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
          const worldX = px + (x - halfSize);
          const worldZ = pz + (z - halfSize);
          const waterHeight = waterEngine.getSurfaceHeight(worldX, worldZ);
          const isWater = waterHeight > -50;
          
          const idx = (z * size + x) * 4;
          if (isWater) {
            data[idx] = 28; data[idx+1] = 163; data[idx+2] = 236; data[idx+3] = 255;
          } else {
            data[idx] = 74; data[idx+1] = 93; data[idx+2] = 35; data[idx+3] = 255;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);

      const chunkX = Math.floor(px / CHUNK_SIZE);
      const chunkZ = Math.floor(pz / CHUNK_SIZE);
      ctx.fillStyle = '#228B22';
      for (let cx = chunkX - 2; cx <= chunkX + 2; cx++) {
        for (let cz = chunkZ - 2; cz <= chunkZ + 2; cz++) {
          const trees = generateTreesForChunk(cx, cz);
          for (const tree of trees) {
            const sticks = treeSticks[tree.id] ?? 3;
            if (sticks > 0) {
              const mx = tree.position[0] - px + halfSize;
              const mz = tree.position[2] - pz + halfSize;
              if (mx >= 0 && mx < size && mz >= 0 && mz < size) {
                ctx.fillRect(mx - 1, mz - 1, 3, 3);
              }
            }
          }
        }
      }

      for (const block of placedBlocks) {
        const mx = block.position[0] - px + halfSize;
        const mz = block.position[2] - pz + halfSize;
        if (mx >= 0 && mx < size && mz >= 0 && mz < size) {
          ctx.fillStyle = block.type === 'stick' ? '#8B4513' : '#3d2817';
          ctx.fillRect(mx - 1, mz - 1, 3, 3);
        }
      }

      ctx.fillStyle = '#FF0000';
      ctx.beginPath();
      ctx.arc(halfSize, halfSize, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#FF0000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(halfSize, halfSize);
      ctx.lineTo(halfSize + Math.sin(state.playerRotation) * 6, halfSize + Math.cos(state.playerRotation) * 6);
      ctx.stroke();
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <View style={styles.nativeContainer} pointerEvents="none">
      <View style={styles.header}><Text style={styles.headerText}>MINIMAP</Text></View>
      {Platform.OS === 'web' && (
        <View style={styles.canvasWrapper}>
          <canvas ref={canvasRef} width={100} height={100} style={{ width: 160, height: 160, imageRendering: 'pixelated' }} />
        </View>
      )}
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
    backgroundColor: 'rgba(254, 243, 199, 0.5)',
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
  }
});
