import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Hud, OrthographicCamera } from '@react-three/drei';
import { useGameStore } from '../store';
import { getRenderConfig } from '../utils/qualityTier';
import { CHUNK_SIZE, generateTreesForChunk } from '../utils/terrain';
import { waterEngine } from '../utils/WaterEngine';
import { woodEngine } from '../utils/woodEngine';

export let currentWaterTiles = 0;

function stamp3x3(data: Uint8Array, resolution: number, mx: number, mz: number, r: number, g: number, b: number) {
  for (let dy = -1; dy <= 1; dy++) {
    const rowOffset = (mz + dy) * resolution;
    for (let dx = -1; dx <= 1; dx++) {
      const i = (rowOffset + mx + dx) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
}

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

    // --- 1. Update water coverage metric ---
    let activeTiles = 0;
    const totalTiles = waterEngine.size * waterEngine.size;
    const W = waterEngine.W;
    for (let i = 0; i < totalTiles; i++) {
      if (W[i] > 0.1) activeTiles++;
    }
    currentWaterTiles = activeTiles;
    const currentPct = Math.floor((activeTiles / totalTiles) * 100);
    const prevMax = store.stats.maxWaterCoverage || 0;
    if (currentPct > prevMax) {
      useGameStore.setState(s => ({
        stats: { ...s.stats, maxWaterCoverage: currentPct }
      }));
    }

    // --- 2. Base pass: Write Water / Land directly to DataTexture buffer ---
    for (let y = 0; y < RESOLUTION; y++) {
      const worldZ = pz - (y - halfSize);
      const rowOffset = y * RESOLUTION;
      for (let x = 0; x < RESOLUTION; x++) {
        const i = (rowOffset + x) * 4;
        const worldX = px + (x - halfSize);
        const waterHeight = waterEngine.getSurfaceHeight(worldX, worldZ);

        if (waterHeight > -50) {
          data[i] = 28; data[i + 1] = 163; data[i + 2] = 236; data[i + 3] = 255; // Water
        } else {
          data[i] = 85; data[i + 1] = 195; data[i + 2] = 85; data[i + 3] = 255; // Land
        }
      }
    }

    // --- 3. Stamp Features (Trees, Blocks, Logs) directly into buffer (0 Map/string allocations) ---
    const chunkX = Math.floor((px + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const chunkZ = Math.floor((pz + CHUNK_SIZE / 2) / CHUNK_SIZE);
    
    // Trees
    for (let cx = chunkX - 2; cx <= chunkX + 2; cx++) {
      for (let cz = chunkZ - 2; cz <= chunkZ + 2; cz++) {
        const trees = generateTreesForChunk(cx, cz);
        for (let t = 0; t < trees.length; t++) {
          const tree = trees[t];
          const isBig = tree.type === 'big';
          const sticks = woodEngine.getSticks(tree.id, isBig);
          if (sticks > 0) {
            const mx = Math.floor(tree.position[0] - px + halfSize);
            const mz = Math.floor(pz - tree.position[2] + halfSize);
            if (mx >= 1 && mx < RESOLUTION - 1 && mz >= 1 && mz < RESOLUTION - 1) {
              if (isBig) {
                stamp3x3(data, RESOLUTION, mx, mz, 10, 100, 10);
              } else {
                stamp3x3(data, RESOLUTION, mx, mz, 34, 139, 34);
              }
            }
          }
        }
      }
    }

    // Dams
    for (let b = 0; b < placedBlocks.length; b++) {
      const block = placedBlocks[b];
      const mx = Math.floor(block.position[0] - px + halfSize);
      const mz = Math.floor(pz - block.position[2] + halfSize);
      if (mx >= 1 && mx < RESOLUTION - 1 && mz >= 1 && mz < RESOLUTION - 1) {
        if (block.type === 'stick') {
          stamp3x3(data, RESOLUTION, mx, mz, 139, 69, 19);
        } else {
          stamp3x3(data, RESOLUTION, mx, mz, 61, 40, 23);
        }
      }
    }

    // Draggable Logs
    for (let l = 0; l < draggableLogs.length; l++) {
      const log = draggableLogs[l];
      const mx = Math.floor(log.position[0] - px + halfSize);
      const mz = Math.floor(pz - log.position[2] + halfSize);
      if (mx >= 1 && mx < RESOLUTION - 1 && mz >= 1 && mz < RESOLUTION - 1) {
        if (log.isMudded) {
          stamp3x3(data, RESOLUTION, mx, mz, 61, 40, 23);
        } else {
          stamp3x3(data, RESOLUTION, mx, mz, 139, 69, 19);
        }
      }
    }

    // --- 4. Stamp Directional Player Arrow in 11x11 center box ---
    const playerRot = store.playerRotation || 0;
    const cosR = Math.cos(playerRot);
    const sinR = Math.sin(playerRot);
    const minC = Math.max(0, halfSize - 5);
    const maxC = Math.min(RESOLUTION - 1, halfSize + 5);
    for (let y = minC; y <= maxC; y++) {
      const dy = halfSize - y;
      const rowOffset = y * RESOLUTION;
      for (let x = minC; x <= maxC; x++) {
        const dx = x - halfSize;
        const rx = dx * cosR - dy * sinR;
        const ry = dx * sinR + dy * cosR;
        if (ry >= -4 && ry <= 3 && Math.abs(rx) <= (ry + 4) * 0.4) {
          const i = (rowOffset + x) * 4;
          data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
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
