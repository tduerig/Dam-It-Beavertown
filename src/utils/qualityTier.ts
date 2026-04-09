/**
 * Per-Aspect Quality Tier System
 * 
 * Three independent quality axes, each 'low' | 'medium' | 'high':
 *   - simulation: Water grid size, physics substeps, tick rate
 *   - graphics:   Shadows, water material type, fog distance
 *   - rendering:  Rain particles, view distance, vertex normals, minimap resolution
 * 
 * Replaces all scattered Platform.OS === 'web' checks with a unified,
 * user-configurable, per-aspect quality system.
 */

let Platform: { OS: string } = { OS: 'web' };
try {
  Platform = require('react-native').Platform;
} catch (e) {
  // Test environment — default to web
}

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  simulation: QualityLevel;
  graphics: QualityLevel;
  rendering: QualityLevel;
}

// ─── Simulation Config ─────────────────────────────────────────────────────

export interface SimulationConfig {
  waterSize: number;
  physicsSubsteps: number;
  physicsTPS: number;
}

const SIM_CONFIGS: Record<QualityLevel, SimulationConfig> = {
  low:    { waterSize: 48,  physicsSubsteps: 1, physicsTPS: 15 },
  medium: { waterSize: 80,  physicsSubsteps: 2, physicsTPS: 30 },
  high:   { waterSize: 160, physicsSubsteps: 4, physicsTPS: 30 },
};

// ─── Graphics Config ────────────────────────────────────────────────────────

export interface GraphicsConfig {
  shadowsEnabled: boolean;
  shadowMapSize: number;
  usePhysicalWaterMat: boolean;
  antiAlias: boolean;
  fogNear: number;
  fogFar: number;
  useEnvironmentMap: boolean;
}

const GFX_CONFIGS: Record<QualityLevel, GraphicsConfig> = {
  low: {
    shadowsEnabled: false,
    shadowMapSize: 0,
    usePhysicalWaterMat: false,
    antiAlias: false,
    fogNear: 20,
    fogFar: 50,
    useEnvironmentMap: false,
  },
  medium: {
    shadowsEnabled: false,
    shadowMapSize: 0,
    usePhysicalWaterMat: false,
    antiAlias: false,
    fogNear: 25,
    fogFar: 65,
    useEnvironmentMap: false,
  },
  high: {
    shadowsEnabled: true,
    shadowMapSize: 2048,
    usePhysicalWaterMat: true,
    antiAlias: false,
    fogNear: 30,
    fogFar: 80,
    useEnvironmentMap: true,
  },
};

// ─── Rendering Config ───────────────────────────────────────────────────────

export interface RenderingConfig {
  rainCount: number;
  chunkViewDistance: number;
  computeWaterNormals: boolean;
  waterNormalSkipFrames: number;   // 0 = every frame, 1 = every other, etc.
  minimapResolution: number;
  minimapUpdateMs: number;
}

const RENDER_CONFIGS: Record<QualityLevel, RenderingConfig> = {
  low: {
    rainCount: 200,
    chunkViewDistance: 2,
    computeWaterNormals: false,
    waterNormalSkipFrames: 0,
    minimapResolution: 40,
    minimapUpdateMs: 500,
  },
  medium: {
    rainCount: 1000,
    chunkViewDistance: 2,
    computeWaterNormals: false,
    waterNormalSkipFrames: 1,
    minimapResolution: 60,
    minimapUpdateMs: 250,
  },
  high: {
    rainCount: 5000,
    chunkViewDistance: 3,
    computeWaterNormals: true,
    waterNormalSkipFrames: 0,
    minimapResolution: 100,
    minimapUpdateMs: 250,
  },
};

// ─── Cached configs (updated when settings change) ──────────────────────────

let _cachedSim: SimulationConfig = SIM_CONFIGS.high;
let _cachedGfx: GraphicsConfig = GFX_CONFIGS.high;
let _cachedRender: RenderingConfig = RENDER_CONFIGS.high;

export function updateCachedConfigs(settings: QualitySettings) {
  _cachedSim = SIM_CONFIGS[settings.simulation];
  _cachedGfx = GFX_CONFIGS[settings.graphics];
  _cachedRender = RENDER_CONFIGS[settings.rendering];
}

export function getSimConfig(): SimulationConfig {
  return _cachedSim;
}

export function getGraphicsConfig(): GraphicsConfig {
  return _cachedGfx;
}

export function getRenderConfig(): RenderingConfig {
  return _cachedRender;
}

// ─── Auto-detection ─────────────────────────────────────────────────────────

export function detectDefaultQuality(): QualitySettings {
  if (Platform.OS === 'web') {
    // Web defaults to high — desktop browsers can handle it
    // Could refine with navigator.hardwareConcurrency / WebGL renderer string
    let level: QualityLevel = 'high';
    
    if (typeof navigator !== 'undefined') {
      const cores = navigator.hardwareConcurrency || 4;
      // Mobile web detection
      const isMobileWeb = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isMobileWeb) {
        level = cores >= 6 ? 'medium' : 'low';
      }
    }
    
    return { simulation: level, graphics: level, rendering: level };
  }
  
  // Native (iOS/Android) defaults to conservative settings
  return {
    simulation: 'medium',
    graphics: 'low',
    rendering: 'medium',
  };
}
