export interface TreeItem {
  id: string;
  position: [number, number, number];
  type: 'big' | 'small' | 'sapling';
}

export interface AquaticFloraItem {
  id: string;
  position: [number, number, number];
  type: 'lily' | 'cattail';
}

export type FloraItem = TreeItem | AquaticFloraItem;

const cache: Record<string, FloraItem[]> = {};

export const floraCache = {
  get(chunkKey: string): FloraItem[] {
    return cache[chunkKey] || [];
  },
  
  getAllChunks(): FloraItem[][] {
    return Object.values(cache);
  },

  set(chunkKey: string, items: FloraItem[]) {
    cache[chunkKey] = items;
  },

  add(chunkKey: string, item: FloraItem) {
    if (!cache[chunkKey]) cache[chunkKey] = [];
    cache[chunkKey].push(item);
  },

  remove(chunkKey: string, id: string): boolean {
    if (!cache[chunkKey]) return false;
    const initialLen = cache[chunkKey].length;
    cache[chunkKey] = cache[chunkKey].filter(item => item.id !== id);
    return cache[chunkKey].length < initialLen;
  },
  
  clear() {
    for (const key in cache) delete cache[key];
  }
};
