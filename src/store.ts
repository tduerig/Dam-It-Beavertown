import { create } from 'zustand';
import * as THREE from 'three';

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
  gameState: 'menu' | 'playing';
  inventory: {
    sticks: number;
    mud: number;
  };
  placedBlocks: PlacedBlock[];
  draggableLogs: DraggableLog[];
  treeSticks: Record<string, number>;
  playerPosition: [number, number, number];
  playerRotation: number;
  lastAction: { type: 'gather' | 'place' | 'none', blockType?: BlockType, time: number };
  rainIntensity: number;
  cameraAngle: number;
  cameraPitch: number;
  terrainOffsets: Record<string, number>;
  particleEmitters: ParticleEmitter[];
  virtualJoystick: { x: number, y: number };
  virtualCamera: { x: number, y: number };
  virtualCamera: { x: number, y: number };
  virtualButtons: { jump: boolean, crouch: boolean, action1: boolean, action2: boolean, action3: boolean };
  setGameState: (state: 'menu' | 'playing') => void;
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
  chopTree: (id: string, isBig?: boolean) => void;
  triggerAction: (type: 'gather' | 'place', blockType?: BlockType) => void;
  saveGame: () => void;
  loadGame: (jsonData?: string) => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  gameState: 'menu',
  inventory: {
    sticks: 0,
    mud: 0,
  },
  placedBlocks: [],
  draggableLogs: [],
  treeSticks: {},
  playerPosition: [0, 0, 0],
  playerRotation: 0,
  lastAction: { type: 'none', time: 0 },
  rainIntensity: 0,
  cameraAngle: 0,
  cameraPitch: Math.PI / 6, // 30 degrees down
  virtualJoystick: { x: 0, y: 0 },
  virtualCamera: { x: 0, y: 0 },
  virtualButtons: { jump: false, crouch: false, action1: false, action2: false, action3: false },
  terrainOffsets: {},
  particleEmitters: [],
  setGameState: (state) => set({ gameState: state }),
  setVirtualJoystick: (x, y) => set({ virtualJoystick: { x, y } }),
  setVirtualCamera: (x, y) => set({ virtualCamera: { x, y } }),
  setVirtualButton: (button, value) => set((state) => ({ virtualButtons: { ...state.virtualButtons, [button]: value } })),
  setRainIntensity: (val) => set({ rainIntensity: Math.max(0, Math.min(1, val)) }),
  setCameraAngle: (val) => set({ cameraAngle: val }),
  setCameraPitch: (val) => set({ cameraPitch: Math.max(0.1, Math.min(Math.PI / 2 - 0.1, val)) }),
  modifyTerrain: (cx, cz, amount, radius) => set((state) => {
    const newOffsets = { ...state.terrainOffsets };
    
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      for (let z = Math.floor(cz - radius); z <= Math.ceil(cz + radius); z++) {
        const dx = Math.abs(x - cx);
        const dz = Math.abs(z - cz);
        
        // Superellipse distance for a vaguely cube-like rounded shape
        const dist = Math.pow(Math.pow(dx, 4) + Math.pow(dz, 4), 0.25);
        
        if (dist <= radius) {
          const key = `${x},${z}`;
          const current = newOffsets[key] || 0;
          
          // Flat top, rounded downward falloff
          const t = dist / radius;
          const falloff = 1 - Math.pow(t, 4); // Stays very flat, then curves down steeply
          
          newOffsets[key] = current + amount * falloff;
        }
      }
    }
    return { terrainOffsets: newOffsets };
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
  chopTree: (id, isBig) =>
    set((state) => {
      const maxSticks = isBig ? 12 : 3;
      const current = state.treeSticks[id] ?? maxSticks;
      if (current > 0) {
        return { treeSticks: { ...state.treeSticks, [id]: current - 1 } };
      }
      return state;
    }),
  triggerAction: (type, blockType) => set({ lastAction: { type, blockType, time: Date.now() } }),
  saveGame: () => {
    const state = get();
    const saveData = {
      inventory: state.inventory,
      placedBlocks: state.placedBlocks,
      treeSticks: state.treeSticks,
      playerPosition: state.playerPosition,
      playerRotation: state.playerRotation,
    };
    const json = JSON.stringify(saveData);
    
    // Fallbacks for React Native vs Web
    if (typeof window !== 'undefined') {
      localStorage.setItem('beaver_game_save', json);
      
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'beaver_map.json';
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        console.warn("DOM Blob download unavailable in this environment");
      }
    } else {
      console.log("Game Saved Native Stub: ", json.length, "bytes");
    }
  },
  loadGame: (jsonData?: string) => {
    const data = jsonData || (typeof window !== 'undefined' ? localStorage.getItem('beaver_game_save') : null);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        set({
          inventory: parsed.inventory,
          placedBlocks: parsed.placedBlocks,
          treeSticks: parsed.treeSticks,
          playerPosition: parsed.playerPosition,
          playerRotation: parsed.playerRotation,
        });
      } catch (e) {
        console.error("Failed to load game", e);
        alert("Failed to load map file. It might be corrupted.");
      }
    } else if (!jsonData) {
      alert("No saved game found in local storage.");
    }
  },
}));
