export interface WoodState {
  treeSticks: Map<string, number>;
  dirtyChunks: Map<string, number>; 
}

const state: WoodState = {
  treeSticks: new Map<string, number>(),
  dirtyChunks: new Map<string, number>(),
};

export const woodEngine = {
  getSticks(id: string, isBig: boolean): number {
    if (state.treeSticks.has(id)) return state.treeSticks.get(id)!;
    return isBig ? 12 : 3;
  },

  setSticks(id: string, sticks: number, chunkCoordsStr: string) {
    state.treeSticks.set(id, sticks);
    const prev = state.dirtyChunks.get(chunkCoordsStr) || 0;
    state.dirtyChunks.set(chunkCoordsStr, prev + 1);
  },

  isChunkFloraDirty(chunkStr: string, lastSeenStamp: number): boolean {
    const currentStamp = state.dirtyChunks.get(chunkStr) || 0;
    return currentStamp !== lastSeenStamp;
  },

  getChunkStamp(chunkStr: string): number {
    return state.dirtyChunks.get(chunkStr) || 0;
  },

  serialize() {
    return Object.fromEntries(state.treeSticks.entries());
  },

  deserialize(data: Record<string, number> | null) {
    state.treeSticks.clear();
    state.dirtyChunks.clear();
    if (!data) return;
    for (const [k, v] of Object.entries(data)) {
        state.treeSticks.set(k, v);
    }
    // Mark everything dirty
    state.dirtyChunks.set('global', Date.now());
  }
};
