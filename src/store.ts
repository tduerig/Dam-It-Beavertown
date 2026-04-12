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
  saveGame: () => Promise<void>;
  loadGame: () => Promise<void>;
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
  autopilot: false,
  aiState: 'IDLE',
  aiTarget: null,
  setAutopilot: (val: boolean) => set({ autopilot: val }),
  setAIState: (val: string) => set({ aiState: val }),
  setAITarget: (val: [number, number, number] | null) => set({ aiTarget: val }),
  setGameState: (state) => set({ gameState: state }),
  
  updateTimeOfDay: (dt) => set((state) => {
    // 75% Day / 25% Night mapping
    let newTime = state.timeOfDay + (dt / state.dayLength);
    if (newTime >= 1.0) {
        newTime = newTime % 1.0;
        state.triggerEcologyTick(); // Evolve map at the break of dawn!
    }
    return { timeOfDay: newTime };
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

  saveGame: async () => {
    const { inventory, stats, settings, placedBlocks, draggableLogs, playerPosition, playerRotation, timeOfDay } = get();
    const saveState = {
      inventory, stats, settings, placedBlocks, draggableLogs, playerPosition, playerRotation, timeOfDay,
      terrainOffsets: serializeOffsets(),
      treeSticks: woodEngine.serialize(),
      mudSaturation: serializeMud()
    };
    try {
      await AsyncStorage.setItem('beavertown_save', JSON.stringify(saveState));
    } catch (e) {
      console.warn("Save Error:", e);
    }
  },

  loadGame: async () => {
    try {
      const data = await AsyncStorage.getItem('beavertown_save');
      if (data) {
        const loadedState = JSON.parse(data);
        if (loadedState.terrainOffsets) {
          deserializeOffsets(loadedState.terrainOffsets);
        }
        if (loadedState.treeSticks) {
          woodEngine.deserialize(loadedState.treeSticks);
        } else {
          woodEngine.deserialize({});
        }
        if (loadedState.mudSaturation) {
          deserializeMud(loadedState.mudSaturation);
        }
        set({
          inventory: loadedState.inventory,
          stats: loadedState.stats,
          settings: loadedState.settings,
          placedBlocks: loadedState.placedBlocks,
          draggableLogs: loadedState.draggableLogs,
          playerPosition: loadedState.playerPosition,
          playerRotation: loadedState.playerRotation,
          terrainStamp: getGlobalStamp(),
          gameState: 'paused',
        });
      }
    } catch (e) {
      console.warn("Load Error:", e);
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
