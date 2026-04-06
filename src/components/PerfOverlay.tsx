import { useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useFrame, useThree } from '@react-three/fiber';
import { useGameStore } from '../store';

/**
 * PerfOverlay — Live performance HUD
 * 
 * Replaces drei <Stats> with a purpose-built overlay showing:
 * - Frame time (ms) with color coding
 * - FPS (rolling 60-frame average)
 * - Draw calls
 * - Active entities
 * - JS heap (web only)
 * - Current quality tier display
 * 
 * Toggled via settings.showStatsOverlay
 */

// Module-scope perf counters shared between the 3D hook and the 2D overlay
let _frameTimeMs = 0;
let _fps = 60;
let _drawCalls = 0;
let _triangles = 0;
let _waterTickMs = 0;

// FPS rolling buffer
const FPS_BUFFER_SIZE = 60;
const _frameTimes: number[] = new Array(FPS_BUFFER_SIZE).fill(16.6);
let _frameIdx = 0;

// Export for WaterRenderer to stamp its tick cost
export function reportWaterTickCost(ms: number) {
  _waterTickMs = ms;
}

/**
 * 3D component that runs inside the Canvas to read gl.info each frame.
 * Must be a child of <Canvas>.
 */
export function PerfProbe() {
  const { gl } = useThree();
  const lastTime = useRef(performance.now());

  useFrame(() => {
    const now = performance.now();
    const dt = now - lastTime.current;
    lastTime.current = now;

    _frameTimeMs = dt;
    _frameTimes[_frameIdx % FPS_BUFFER_SIZE] = dt;
    _frameIdx++;

    // Rolling average FPS
    let sum = 0;
    for (let i = 0; i < FPS_BUFFER_SIZE; i++) sum += _frameTimes[i];
    _fps = Math.round(1000 / (sum / FPS_BUFFER_SIZE));

    _drawCalls = gl.info.render.calls;
    _triangles = gl.info.render.triangles;
  });

  return null;
}

/**
 * 2D overlay component placed outside the Canvas.
 * Polls the module-scope counters on a timer.
 */
export function PerfOverlayUI() {
  const [frameTime, setFrameTime] = useState(0);
  const [fps, setFps] = useState(60);
  const [draws, setDraws] = useState(0);
  const [tris, setTris] = useState(0);
  const [waterTick, setWaterTick] = useState(0);
  const [heap, setHeap] = useState(0);

  const quality = useGameStore(state => state.settings.quality);
  const logs = useGameStore(state => state.draggableLogs.length);
  const blocks = useGameStore(state => state.placedBlocks.length);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrameTime(+_frameTimeMs.toFixed(1));
      setFps(_fps);
      setDraws(_drawCalls);
      setTris(_triangles);
      setWaterTick(+_waterTickMs.toFixed(1));

      if (Platform.OS === 'web' && (performance as any).memory) {
        setHeap(Math.round((performance as any).memory.usedJSHeapSize / 1048576));
      }
    }, 200); // 5Hz update to avoid overhead

    return () => clearInterval(interval);
  }, []);

  const ftColor = frameTime <= 10 ? '#4ade80' : frameTime <= 16.6 ? '#facc15' : '#ef4444';

  return (
    <View style={styles.container}>
      <Text style={[styles.metric, { color: ftColor }]}>
        {frameTime}ms
      </Text>
      <Text style={styles.metric}>{fps} FPS</Text>
      <Text style={styles.metric}>DC: {draws}</Text>
      <Text style={styles.metric}>△: {(tris / 1000).toFixed(0)}k</Text>
      <Text style={styles.metric}>💧: {waterTick}ms</Text>
      {heap > 0 && <Text style={styles.metric}>Heap: {heap}MB</Text>}
      <Text style={styles.dim}>Logs:{logs} Blk:{blocks}</Text>
      <Text style={styles.dim}>
        S:{quality.simulation[0].toUpperCase()} G:{quality.graphics[0].toUpperCase()} R:{quality.rendering[0].toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    zIndex: 999,
    gap: 1,
  },
  metric: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  dim: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
});
