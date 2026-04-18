import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Hud, OrthographicCamera } from '@react-three/drei';
import { useGameStore } from '../store';
import { getRenderConfig } from '../utils/qualityTier';
import { CHUNK_SIZE, generateTreesForChunk } from '../utils/terrain';
import { waterEngine } from '../utils/WaterEngine';
import { woodEngine } from '../utils/woodEngine';

export function MinimapHUD() {
  const { size } = useThree(); // Logical canvas size in CSS pixels
  
  // The UI rendering size of the map (matches old Minimap styling)
  const VISUAL_SIZE = 150; 
  // Native resolution of the DataTexture buffer
  const renderCfg = getRenderConfig();
  const RESOLUTION = renderCfg.minimapResolution;
  const UPDATE_MS = renderCfg.minimapUpdateMs;

  const { data, texture } = useMemo(() => {
    // 4 bytes per pixel for RGBA
    const arr = new Uint8Array(RESOLUTION * RESOLUTION * 4);
    arr.fill(255);
    const tex = new THREE.DataTexture(arr, RESOLUTION, RESOLUTION, THREE.RGBAFormat);
    // Nearest filtering keeps it crisp and pixel-art styled
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    return { data: arr, texture: tex };
  }, [RESOLUTION]);

  const lastUpdate = useRef(0);

  useFrame((state) => {
    if (state.clock.elapsedTime - lastUpdate.current < UPDATE_MS / 1000) return;
    lastUpdate.current = state.clock.elapsedTime;
    
    const store = useGameStore.getState();
    const [px, _py, pz] = store.playerPosition;
    const placedBlocks = store.placedBlocks;
    const draggableLogs = store.draggableLogs;
    
    const halfSize = Math.floor(RESOLUTION / 2);
    const chunkMap = new Map<string, {r:number, g:number, b:number}>();
    
    // --- 1. Evaluate Features (Trees, Blocks, Logs) ---
    const chunkX = Math.floor((px + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const chunkZ = Math.floor((pz + CHUNK_SIZE / 2) / CHUNK_SIZE);
    
    // Trees
    for (let cx = chunkX - 2; cx <= chunkX + 2; cx++) {
      for (let cz = chunkZ - 2; cz <= chunkZ + 2; cz++) {
        const trees = generateTreesForChunk(cx, cz);
        for (const tree of trees) {
          const isBig = tree.type === 'big';
          const sticks = woodEngine.getSticks(tree.id, isBig);
          if (sticks > 0) {
            const mx = Math.floor(tree.position[0] - px + halfSize);
            const mz = Math.floor(pz - tree.position[2] + halfSize);
            if (mx >= 1 && mx < RESOLUTION-1 && mz >= 1 && mz < RESOLUTION-1) {
              const treeColor = isBig ? {r: 10, g: 100, b: 10} : {r: 34, g: 139, b: 34};
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

    // Dams
    for (const block of placedBlocks) {
      const mx = Math.floor(block.position[0] - px + halfSize);
      const mz = Math.floor(pz - block.position[2] + halfSize);
      if (mx >= 1 && mx < RESOLUTION-1 && mz >= 1 && mz < RESOLUTION-1) {
         const color = block.type === 'stick' ? {r: 139, g: 69, b: 19} : {r: 61, g: 40, b: 23};
         for(let i=-1; i<=1; i++) {
           for(let j=-1; j<=1; j++) {
             chunkMap.set(`${mx+i},${mz+j}`, color); 
           }
         }
      }
    }

    // Draggable Logs
    for (const log of draggableLogs) {
      const mx = Math.floor(log.position[0] - px + halfSize);
      const mz = Math.floor(pz - log.position[2] + halfSize);
      if (mx >= 1 && mx < RESOLUTION-1 && mz >= 1 && mz < RESOLUTION-1) {
         const logColor = log.isMudded ? {r: 61, g: 40, b: 23} : {r: 139, g: 69, b: 19};
         for(let i=-1; i<=1; i++) {
           for(let j=-1; j<=1; j++) {
             chunkMap.set(`${mx+i},${mz+j}`, logColor); 
           }
         }
      }
    }

    // --- 2. Write natively to the DataTexture buffer ---
    let activeTiles = 0;
    const totalTiles = waterEngine.size * waterEngine.size;
    for (let i = 0; i < totalTiles; i++) {
      if (waterEngine.W[i] > 0.1) activeTiles++;
    }
    const maxRecord = Math.max(useGameStore.getState().stats.maxWaterCoverage || 0, Math.floor((activeTiles / totalTiles) * 100));
    useGameStore.setState(state => ({
       stats: { ...state.stats, maxWaterCoverage: maxRecord }
    }));

    for (let y = 0; y < RESOLUTION; y++) {
      for (let x = 0; x < RESOLUTION; x++) {
        const i = (y * RESOLUTION + x) * 4;

        if (x === halfSize && y === halfSize) {
          data[i] = 255; data[i+1] = 0; data[i+2] = 0; data[i+3] = 255;
          continue;
        }

        const overlay = chunkMap.get(`${x},${y}`);
        if (overlay) {
          data[i] = overlay.r; data[i+1] = overlay.g; data[i+2] = overlay.b; data[i+3] = 255;
          continue;
        }

        const worldX = px + (x - halfSize);
        const worldZ = pz - (y - halfSize);
        const waterHeight = waterEngine.getSurfaceHeight(worldX, worldZ);

        if (waterHeight > -50) {
          data[i] = 28; data[i+1] = 163; data[i+2] = 236; data[i+3] = 255; // Water
        } else {
          data[i] = 85; data[i+1] = 195; data[i+2] = 85; data[i+3] = 255; // Land
        }
      }
    }

    // Trigger GPU sync instantly bypassing JS serialization
    texture.needsUpdate = true;
  });

  // Calculate top-right position
  // In a Top-Left (0,0) Ortho camera setup:
  // Left edge = 0. Box center is at VISUAL_SIZE/2 + paddingLeft
  // Top edge = 0. Box center is at -VISUAL_SIZE/2 - paddingTop
  // The CSS DOM overlay starts at top: 100, left: 16.
  // The DOM overlay has a stats panel that is ~24px tall before the image starts.
  // The CSS also has a 4px border.
  const paddingLeft = 16 + 4; 
  const paddingTop = 100 + 30 + 4; // 100 absolute offset + 30 panel height + 4 border
  const x = (VISUAL_SIZE / 2) + paddingLeft; 
  const y = -(VISUAL_SIZE / 2) - paddingTop;

  return (
    <Hud renderPriority={1}>
      <OrthographicCamera 
        makeDefault 
        left={0} 
        right={size.width} 
        top={0} 
        bottom={-size.height} 
        near={0.1} 
        far={100} 
        position={[0, 0, 10]} 
      />
      <mesh position={[x, y, 0]}>
        <planeGeometry args={[VISUAL_SIZE, VISUAL_SIZE]} />
        <meshBasicMaterial map={texture} depthTest={false} transparent />
      </mesh>
      
      {/* Nice minimap border to match CSS styles */}
      <mesh position={[x, y, -0.1]}>
         <planeGeometry args={[VISUAL_SIZE + 4, VISUAL_SIZE + 4]} />
         <meshBasicMaterial color="rgba(255, 255, 255, 0.4)" depthTest={false} transparent />
      </mesh>
    </Hud>
  );
}
