import { create } from 'zustand';
import * as THREE from 'three';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTerrainHeight, getRiverCenter, RIVER_WIDTH } from './utils/terrain';
import { floraCache } from './utils/floraCache';
import { propagateForest } from './utils/ecology';
import { rebuildRegionData } from './components/GlobalFlora';
import { woodEngine } from './utils/woodEngine';
import { QualitySettings, QualityLevel, detectDefaultQuality, updateCachedConfigs } from './utils/qualityTier';
import { applyTerrainMod, applyTerrainBatch, serializeOffsets, deserializeOffsets, getGlobalStamp } from './utils/terrainOffsets';
import { serializeMud, deserializeMud, clearMud } from './utils/mudEngine';
import { captureMinimapThumbnail } from './components/Minimap';

// ── Multi-Slot Save Types ────────────────────────────────────────
export interface SaveSlotMeta {
  id: string;            // UUID or 'autosave'
  timestamp: number;     // Date.now() at save time
  thumbnail: string;     // base64 BMP data URI from minimap
  screenshot: string;    // base64 JPEG data URI from WebGL canvas (web only)
  stats: {
    waterCoverage: number;
    treesDowned: number;
    sticksPlaced: number;
    dayNumber: number;
  };
}

/**
 * Screenshot cache — captures frames while playing so we have a recent
 * screenshot available when the user pauses and saves. The pause overlay
 * blocks the canvas, so we can't capture at save time.
 */
let _cachedScreenshot = '';

function _refreshScreenshotCache(): void {
  if (typeof document === 'undefined') return;
  try {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas || canvas.width === 0) return;
    const w = 320;
    const h = Math.round(w * (canvas.height / canvas.width));
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0, w, h);
    _cachedScreenshot = offscreen.toDataURL('image/jpeg', 0.55);
  } catch { /* ignore */ }
}

/** 
 * Synchronously capture the WebGL canvas before the UI renders over it.
 * Called immediately when transitioning to the Pause menu.
 */

function captureScreenshot(): string {
  return _cachedScreenshot;
}


// ── Utility: Deep Merge ──────────────────────────────────────────
/**
 * Recursively merges source into target.
 * Objects are merged deeply. Arrays and primitives overwrite entirely.
 * This guarantees new save-fields natively initialize on legacy saves.
 */
function deepMerge<T>(target: T, source: any): T {
  if (target === null || target === undefined) return source;
  if (source === null || source === undefined) return target as any;
  if (typeof target !== 'object' || typeof source !== 'object') return source;
  if (Array.isArray(target) || Array.isArray(source)) return source; // Overwrite arrays

  const result = { ...target } as any;
  for (const key of Object.keys(source)) {
    if (source[key] !== undefined) {
      result[key] = deepMerge(result[key], source[key]);
    }
  }
  return result as T;
}

const SAVES_INDEX_KEY = 'beavertown_saves_index';
const SLOT_KEY_PREFIX = 'beavertown_slot_';
const LEGACY_SAVE_KEY = 'beavertown_save';

async function loadSavesIndex(): Promise<SaveSlotMeta[]> {
  try {
    const raw = await AsyncStorage.getItem(SAVES_INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }

  await migrateLegacySave();
  
  try {
    const raw = await AsyncStorage.getItem(SAVES_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function writeSavesIndex(index: SaveSlotMeta[]): Promise<void> {
  await AsyncStorage.setItem(SAVES_INDEX_KEY, JSON.stringify(index));
}

/** One-time migration of legacy single-save to the new multi-slot system. */
async function migrateLegacySave(): Promise<void> {
  try {
    const legacy = await AsyncStorage.getItem(LEGACY_SAVE_KEY);
    if (!legacy) return;

    try {
      const existingRaw = await AsyncStorage.getItem(SAVES_INDEX_KEY);
      if (existingRaw && JSON.parse(existingRaw).length > 0) {
        // Already migrated
        await AsyncStorage.removeItem(LEGACY_SAVE_KEY);
        return;
      }
    } catch { /* ignore */ }

    const parsed = JSON.parse(legacy);
    const slotId = 'migrated_' + Date.now();
    const meta: SaveSlotMeta = {
      id: slotId,
      timestamp: Date.now(),
      thumbnail: '', // No thumbnail for legacy saves
      screenshot: '', // No screenshot for legacy saves
      stats: {
        waterCoverage: parsed.stats?.maxWaterCoverage || 0,
        treesDowned: parsed.stats?.treesDowned || 0,
        sticksPlaced: parsed.stats?.sticksPlaced || 0,
        dayNumber: 0,
      },
    };
    await AsyncStorage.setItem(SLOT_KEY_PREFIX + slotId, legacy);
    await writeSavesIndex([meta]);
    await AsyncStorage.removeItem(LEGACY_SAVE_KEY);
    console.log('[SaveSystem] Migrated legacy save to slot:', slotId);
  } catch (e) {
    console.warn('[SaveSystem] Migration error:', e);
  }
}
export type BlockType = 'stick' | 'mud';

export interface PlacedBlock {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  type: BlockType;
  health?: number;
}

export interface DraggableLog {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  isDragged: boolean;
  isMudded?: boolean;
}

export interface ParticleEmitter {
  id: string;
  position: [number, number, number];
  color: string;
  createdAt: number;
}

interface GameState {
  gameState: 'start_menu' | 'playing' | 'paused';
  inventory: {
    sticks: number;
    mud: number;
  };
  stats: {
    mudDug: number;
    mudPatted: number;
    treesDowned: number;
    sticksPlaced: number;
    massiveTreesFelled: number;
    maxWaterCoverage: number;
    snacksEaten: number;
  };
  settings: {
    showStatsOverlay: boolean;
    physicsSubsteps: number;
    reflectionsActive: boolean;
    quality: QualitySettings;
  };
  placedBlocks: PlacedBlock[];
  draggableLogs: DraggableLog[];

  playerPosition: [number, number, number];
  playerRotation: number;
  lastAction: { type: 'gather' | 'place' | 'none', blockType?: BlockType, time: number };
  rainIntensity: number;
  cameraAngle: number;
  cameraPitch: number;
  terrainStamp: number; // Incremented when any terrain is modified; replaces terrainOffsets object
  ecologyStamp: number;
  particleEmitters: ParticleEmitter[];
  virtualJoystick: { x: number, y: number };
  virtualCamera: { x: number, y: number };
  virtualButtons: { jump: boolean, crouch: boolean, action1: boolean, action2: boolean, action3: boolean };
  timeOfDay: number;
  dayLength: number;
  dayNumber: number;
  autopilot: boolean;
  aiState: string;
  aiTarget: [number, number, number] | null;
  setAutopilot: (val: boolean) => void;
  setAIState: (val: string) => void;
  setAITarget: (val: [number, number, number] | null) => void;
  setGameState: (state: 'start_menu' | 'playing' | 'paused') => void;
  updateTimeOfDay: (dt: number) => void;
  triggerEcologyTick: () => void;
  updateMaxWaterCoverage: (val: number) => void;
  eatSnack: (id: string, chunkKey: string) => void;
  setSetting: (key: keyof GameState['settings'], value: any) => void;
  setQuality: (aspect: keyof QualitySettings, level: QualityLevel) => void;
  batchModifyTerrain: (modifications: Array<{x: number, z: number, amount: number, radius: number}>) => void;
  saveGame: (slotId?: string) => Promise<void>;
  loadGame: (slotId: string) => Promise<void>;
  getSaveSlots: () => Promise<SaveSlotMeta[]>;
  deleteSlot: (slotId: string) => Promise<void>;
  resetGame: () => void;
  setVirtualJoystick: (x: number, y: number) => void;
  setVirtualCamera: (x: number, y: number) => void;
  setVirtualButton: (button: 'jump' | 'crouch' | 'action1' | 'action2' | 'action3', value: boolean) => void;
  modifyTerrain: (x: number, z: number, amount: number, radius: number) => void;
  addInventory: (type: BlockType, amount: number) => void;
  removeInventory: (type: BlockType, amount: number) => boolean;
  placeBlock: (position: [number, number, number], rotation: [number, number, number], type: BlockType) => void;
  removeBlock: (id: string) => void;
  addDraggableLog: (position: [number, number, number], rotation: [number, number, number]) => void;
  updateDraggableLog: (id: string, position: [number, number, number], rotation: [number, number, number]) => void;
  toggleDragLog: (id: string, isDragged: boolean) => void;
  setLogMudded: (id: string, isMudded: boolean) => void;
  spawnParticles: (position: [number, number, number], color: string) => void;
  removeParticleEmitter: (id: string) => void;
  setPlayerPosition: (pos: [number, number, number]) => void;
  setPlayerRotation: (rot: number) => void;
  setRainIntensity: (val: number) => void;
  setCameraAngle: (val: number) => void;
  setCameraPitch: (val: number) => void;
  chopTree: (id: string, isBig: boolean, chunkKey: string) => void;
  triggerAction: (type: 'gather' | 'place', blockType?: BlockType) => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  gameState: 'start_menu',
  inventory: {
    sticks: 0,
    mud: 0,
  },
  stats: {
    mudDug: 0,
    mudPatted: 0,
    treesDowned: 0,
    sticksPlaced: 0,
    massiveTreesFelled: 0,
    maxWaterCoverage: 0,
    snacksEaten: 0,
  },
  settings: {
    showStatsOverlay: false,
    physicsSubsteps: 4,
    reflectionsActive: false,
    quality: detectDefaultQuality(),
  },
  placedBlocks: [],
  draggableLogs: [],
  playerPosition: [0, 0, 0],
  playerRotation: 0,
  lastAction: { type: 'none', time: 0 },
  rainIntensity: 0,
  cameraAngle: 0,
  cameraPitch: Math.PI / 6, // 30 degrees down
  virtualJoystick: { x: 0, y: 0 },
  virtualCamera: { x: 0, y: 0 },
  virtualButtons: { jump: false, crouch: false, action1: false, action2: false, action3: false },
  terrainStamp: 0,
  ecologyStamp: 0,
  particleEmitters: [],
  timeOfDay: 0,
  dayLength: 300, // 5 minutes real-time for testing purposes
  dayNumber: 1,
  autopilot: false,
  aiState: 'IDLE',
  aiTarget: null,
  setAutopilot: (val: boolean) => set({ autopilot: val }),
  setAIState: (val: string) => set({ aiState: val }),
  setAITarget: (val: [number, number, number] | null) => set({ aiTarget: val }),
  setGameState: (state) => {
    // Capture the WebGL state synchronously BEFORE the React render pass paints the Pause Overlay
    if (state === 'paused' || state === 'start_menu') {
      _refreshScreenshotCache();
    }
    set({ gameState: state });
  },
  
  updateTimeOfDay: (dt) => set((state) => {
    // 75% Day / 25% Night mapping
    let newTime = state.timeOfDay + (dt / state.dayLength);
    let newDay = state.dayNumber;
    if (newTime >= 1.0) {
        newTime = newTime % 1.0;
        newDay = state.dayNumber + 1;
        state.triggerEcologyTick(); // Evolve map at the break of dawn!
        // Auto-save at dawn
        setTimeout(() => {
          useGameStore.getState().saveGame('autosave');
          console.log('[AutoSave] Dawn of Day', newDay);
        }, 0);
    }
    return { timeOfDay: newTime, dayNumber: newDay };
  }),
  
  triggerEcologyTick: () => {
      propagateForest();
  },
  
  eatSnack: (id, chunkKey) => set(state => {
      const items = floraCache.get(chunkKey);
      const idx = items.findIndex((t) => t.id === id);
      let isSapling = false;
      if (idx !== -1) {
          isSapling = items[idx].type === 'sapling';
          floraCache.remove(chunkKey, id);
          // Rebuild shared flora data SYNCHRONOUSLY so the next useFrame
          // sees the updated data — no waiting for React's render cycle.
          rebuildRegionData();
      }
      return {
          stats: { ...state.stats, snacksEaten: isSapling ? state.stats.snacksEaten : state.stats.snacksEaten + 1 },
          ecologyStamp: state.ecologyStamp + 1
      };
  }),

  setSetting: (key, value) => set(state => ({
    settings: { ...state.settings, [key]: value }
  })),

  setQuality: (aspect, level) => set(state => {
    const newQuality = { ...state.settings.quality, [aspect]: level };
    updateCachedConfigs(newQuality);
    return { settings: { ...state.settings, quality: newQuality } };
  }),

  batchModifyTerrain: (modifications) => set((state) => {
    if (modifications.length === 0) return state;
    
    // Delegate to the module-scope terrain offset engine (no shallow copy)
    applyTerrainBatch(modifications);
    
    let mudDelta = 0;
    let patDelta = 0;
    for (const mod of modifications) {
      if (mod.amount < 0) mudDelta++;
      if (mod.amount > 0) patDelta++;
    }

    return {
      terrainStamp: getGlobalStamp(),
      stats: {
        ...state.stats,
        mudDug: state.stats.mudDug + mudDelta,
        mudPatted: state.stats.mudPatted + patDelta,
      }
    };
  }),

  saveGame: async (slotId?: string) => {
    const { inventory, stats, settings, placedBlocks, draggableLogs, playerPosition, playerRotation, timeOfDay, dayNumber } = get();
    try {
      const id = slotId || ('save_' + Date.now());
      const isAutoSave = id === 'autosave';

      // Capture minimap thumbnail + WebGL screenshot
      let thumbnail = '';
      let screenshot = '';
      try { thumbnail = captureMinimapThumbnail(); } catch (_) {}
      try { screenshot = captureScreenshot(); } catch (_) {}

      // Chunk payload into separate DB rows to bypass iOS SQLite size limits
      const basePayload = { inventory, stats, settings, placedBlocks, draggableLogs, playerPosition, playerRotation, timeOfDay, dayNumber };
      await AsyncStorage.setItem(SLOT_KEY_PREFIX + id + '_base', JSON.stringify(basePayload));
      await AsyncStorage.setItem(SLOT_KEY_PREFIX + id + '_terrain', JSON.stringify(serializeOffsets()));
      await AsyncStorage.setItem(SLOT_KEY_PREFIX + id + '_wood', JSON.stringify(woodEngine.serialize()));
      await AsyncStorage.setItem(SLOT_KEY_PREFIX + id + '_mud', JSON.stringify(serializeMud()));

      // Update index
      const index = await loadSavesIndex();
      const meta: SaveSlotMeta = {
        id,
        timestamp: Date.now(),
        thumbnail,
        screenshot,
        stats: {
          waterCoverage: stats.maxWaterCoverage,
          treesDowned: stats.treesDowned,
          sticksPlaced: stats.sticksPlaced,
          dayNumber: dayNumber,
        },
      };
      // Replace existing slot or append
      const existingIdx = index.findIndex(s => s.id === id);
      if (existingIdx >= 0) {
        index[existingIdx] = meta;
      } else {
        index.push(meta);
      }
      await writeSavesIndex(index);
      if (!isAutoSave) console.log('[SaveSystem] Saved to slot:', id);
    } catch (e) {
      console.warn('[SaveSystem] Save Error:', e);
    }
  },

  loadGame: async (slotId: string) => {
    try {
      let loadedState: any = null;
      let terrainData: any = null;
      let treeData: any = null;
      let mudData: any = null;

      const baseData = await AsyncStorage.getItem(SLOT_KEY_PREFIX + slotId + '_base');
      if (baseData) {
        loadedState = JSON.parse(baseData);
        const tStr = await AsyncStorage.getItem(SLOT_KEY_PREFIX + slotId + '_terrain');
        const wStr = await AsyncStorage.getItem(SLOT_KEY_PREFIX + slotId + '_wood');
        const mStr = await AsyncStorage.getItem(SLOT_KEY_PREFIX + slotId + '_mud');
        if (tStr) terrainData = JSON.parse(tStr);
        if (wStr) treeData = JSON.parse(wStr);
        if (mStr) mudData = JSON.parse(mStr);
      } else {
        // Fallback for legacy monolithic saves
        const data = await AsyncStorage.getItem(SLOT_KEY_PREFIX + slotId);
        if (data) {
          loadedState = JSON.parse(data);
          terrainData = loadedState.terrainOffsets;
          treeData = loadedState.treeSticks;
          mudData = loadedState.mudSaturation;
        }
      }

      if (loadedState) {
        deserializeOffsets(terrainData || {});
        woodEngine.deserialize(treeData || {});
        deserializeMud(mudData || {});
        const defaultState = {
          inventory: { sticks: 0, mud: 0 },
          stats: {
            mudDug: 0, mudPatted: 0, treesDowned: 0, sticksPlaced: 0,
            massiveTreesFelled: 0, maxWaterCoverage: 0, snacksEaten: 0,
          },
          settings: {
            showStatsOverlay: false,
            physicsSubsteps: 4,
            reflectionsActive: false,
            quality: detectDefaultQuality(),
          },
          placedBlocks: [] as any[],
          draggableLogs: [] as any[],
          playerPosition: [0, 0, 0] as [number, number, number],
          playerRotation: 0,
          timeOfDay: 0,
          dayNumber: 1,
        };

        const safeInventory = deepMerge(defaultState.inventory, loadedState.inventory);
        const safeStats = deepMerge(defaultState.stats, loadedState.stats);
        const safeSettings = deepMerge(defaultState.settings, loadedState.settings);

        set({
          inventory: safeInventory,
          stats: safeStats,
          settings: safeSettings,
          placedBlocks: loadedState.placedBlocks || defaultState.placedBlocks,
          draggableLogs: loadedState.draggableLogs || defaultState.draggableLogs,
          playerPosition: loadedState.playerPosition || defaultState.playerPosition,
          playerRotation: loadedState.playerRotation ?? defaultState.playerRotation,
          timeOfDay: loadedState.timeOfDay ?? defaultState.timeOfDay,
          dayNumber: loadedState.dayNumber ?? defaultState.dayNumber,
          terrainStamp: getGlobalStamp(),
          gameState: 'paused',
        });
        console.log('[SaveSystem] Loaded slot:', slotId);
      }
    } catch (e) {
      console.warn('[SaveSystem] Load Error:', e);
    }
  },

  getSaveSlots: async () => {
    return loadSavesIndex();
  },

  deleteSlot: async (slotId: string) => {
    try {
      await AsyncStorage.removeItem(SLOT_KEY_PREFIX + slotId);
      await AsyncStorage.removeItem(SLOT_KEY_PREFIX + slotId + '_base');
      await AsyncStorage.removeItem(SLOT_KEY_PREFIX + slotId + '_terrain');
      await AsyncStorage.removeItem(SLOT_KEY_PREFIX + slotId + '_wood');
      await AsyncStorage.removeItem(SLOT_KEY_PREFIX + slotId + '_mud');
      const index = await loadSavesIndex();
      const filtered = index.filter(s => s.id !== slotId);
      await writeSavesIndex(filtered);
      console.log('[SaveSystem] Deleted slot:', slotId);
    } catch (e) {
      console.warn('[SaveSystem] Delete Error:', e);
    }
  },

  resetGame: () => {
    // Because reloading in Expo might be finicky between platforms,
    // we do a deep state reset instead to avoid crashing the RN app.
    deserializeOffsets({}); 
    woodEngine.deserialize({}); 
    clearMud();
    floraCache.clear();
    const { clearGeneratedTerrain } = require('./utils/terrain');
    clearGeneratedTerrain();
    
    set({
      gameState: 'start_menu',
      inventory: { sticks: 0, mud: 0 },
      stats: { mudDug: 0, mudPatted: 0, treesDowned: 0, sticksPlaced: 0, massiveTreesFelled: 0, maxWaterCoverage: 0, snacksEaten: 0 },
      placedBlocks: [],
      draggableLogs: [],
      playerPosition: [0, 0, 0],
      playerRotation: 0,
      terrainStamp: getGlobalStamp(),
      ecologyStamp: get().ecologyStamp + 1,
      timeOfDay: 0,
      dayNumber: 1,
      autopilot: false,
      aiState: 'IDLE',
      aiTarget: null,
      particleEmitters: []
    });
  },

  updateMaxWaterCoverage: (val) => set((state) => {
    if (val > state.stats.maxWaterCoverage) {
      return { stats: { ...state.stats, maxWaterCoverage: val } };
    }
    return state;
  }),

  setVirtualJoystick: (x, y) => set({ virtualJoystick: { x, y } }),
  setVirtualCamera: (x, y) => set({ virtualCamera: { x, y } }),
  setVirtualButton: (button, value) => set((state) => ({ virtualButtons: { ...state.virtualButtons, [button]: value } })),
  setRainIntensity: (val) => set({ rainIntensity: Math.max(0, Math.min(1, val)) }),
  setCameraAngle: (val) => set({ cameraAngle: val }),
  setCameraPitch: (val) => set({ cameraPitch: Math.max(0.1, Math.min(Math.PI / 2 - 0.1, val)) }),
  modifyTerrain: (cx, cz, amount, radius) => set((state) => {
    // Delegate to the module-scope terrain offset engine (no shallow copy)
    applyTerrainMod(cx, cz, amount, radius);
    
    return { 
      terrainStamp: getGlobalStamp(),
      stats: {
        ...state.stats,
        mudDug: amount < 0 ? state.stats.mudDug + 1 : state.stats.mudDug,
        mudPatted: amount > 0 ? state.stats.mudPatted + 1 : state.stats.mudPatted,
      }
    };
  }),
  addInventory: (type, amount) =>
    set((state) => ({
      inventory: {
        ...state.inventory,
        [type === 'stick' ? 'sticks' : 'mud']: state.inventory[type === 'stick' ? 'sticks' : 'mud'] + amount,
      },
    })),
  removeInventory: (type, amount) => {
    const state = get();
    const current = state.inventory[type === 'stick' ? 'sticks' : 'mud'];
    if (current >= amount) {
      set((state) => ({
        inventory: {
          ...state.inventory,
          [type === 'stick' ? 'sticks' : 'mud']: current - amount,
        },
      }));
      return true;
    }
    return false;
  },
  placeBlock: (position, rotation, type) =>
    set((state) => ({
      placedBlocks: [
        ...state.placedBlocks,
        { id: Math.random().toString(36).substring(7), position, rotation, type },
      ],
      stats: {
        ...state.stats,
        sticksPlaced: type === 'stick' ? state.stats.sticksPlaced + 1 : state.stats.sticksPlaced,
      }
    })),
  removeBlock: (id) =>
    set((state) => ({
      placedBlocks: state.placedBlocks.filter(b => b.id !== id),
    })),
  addDraggableLog: (position, rotation) =>
    set((state) => ({
      draggableLogs: [
        ...state.draggableLogs,
        { id: Math.random().toString(36).substring(7), position, rotation, isDragged: false },
      ],
    })),
  updateDraggableLog: (id, position, rotation) =>
    set((state) => ({
      draggableLogs: state.draggableLogs.map(log => 
        log.id === id ? { ...log, position, rotation } : log
      ),
    })),
  toggleDragLog: (id, isDragged) =>
    set((state) => ({
      draggableLogs: state.draggableLogs.map(log => 
        log.id === id ? { ...log, isDragged } : log
      ),
    })),
  setLogMudded: (id, isMudded) =>
    set((state) => ({
      draggableLogs: state.draggableLogs.map(log => 
        log.id === id ? { ...log, isMudded } : log
      ),
    })),
  spawnParticles: (position, color) =>
    set((state) => ({
      particleEmitters: [
        ...state.particleEmitters,
        { id: Math.random().toString(36).substring(7), position, color, createdAt: Date.now() }
      ],
    })),
  removeParticleEmitter: (id) =>
    set((state) => ({
      particleEmitters: state.particleEmitters.filter(e => e.id !== id),
    })),
  setPlayerPosition: (pos) => set({ playerPosition: pos }),
  setPlayerRotation: (rot) => set({ playerRotation: rot }),
  chopTree: (id, isBig, chunkKey) =>
    set((state) => {
      const current = woodEngine.getSticks(id, isBig);
      if (current > 0) {
        woodEngine.setSticks(id, current - 1, chunkKey);
        
        if (current === 1) { // Tree fell
          return { 
            stats: { 
              ...state.stats, 
              treesDowned: state.stats.treesDowned + 1,
              massiveTreesFelled: isBig ? state.stats.massiveTreesFelled + 1 : state.stats.massiveTreesFelled 
            }
          };
        }
      }
      return state;
    }),
  triggerAction: (type: 'gather' | 'place', blockType?: BlockType) => set({ lastAction: { type, blockType, time: Date.now() } }),
}));

// Initialize quality tier cache from the store defaults
updateCachedConfigs(useGameStore.getState().settings.quality);

if (typeof window !== 'undefined') {
  (window as any).gameStore = useGameStore;
}

if (typeof window !== 'undefined') {
  (window as any).gameStore = useGameStore;
}
