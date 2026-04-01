import { useEffect, useRef } from 'react';
import { useGameStore } from '../store';
import { getTerrainHeight, getRiverCenter, RIVER_WIDTH, generateTreesForChunk, CHUNK_SIZE } from '../utils/terrain';
import { waterEngine } from '../utils/WaterEngine';

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let lastRender = 0;

    const render = (time: number) => {
      animationFrameId = requestAnimationFrame(render);
      
      // Throttle to ~10 FPS for performance
      if (time - lastRender < 100) return;
      lastRender = time;

      const state = useGameStore.getState();
      const [px, py, pz] = state.playerPosition;
      const placedBlocks = state.placedBlocks;
      const treeSticks = state.treeSticks;

      const size = 100;
      const halfSize = size / 2;
      
      ctx.clearRect(0, 0, size, size);

      // Draw terrain & water
      const imgData = ctx.createImageData(size, size);
      const data = imgData.data;

      for (let x = 0; x < size; x++) {
        for (let z = 0; z < size; z++) {
          const worldX = px + (x - halfSize);
          const worldZ = pz + (z - halfSize);
          
          const waterHeight = waterEngine.getSurfaceHeight(worldX, worldZ);
          const isWater = waterHeight > -50; // -100 is returned when no water
          
          const idx = (z * size + x) * 4;
          
          if (isWater) {
            data[idx] = 28;     // R
            data[idx+1] = 163;  // G
            data[idx+2] = 236;  // B
            data[idx+3] = 255;  // A
          } else {
            data[idx] = 74;     // R
            data[idx+1] = 93;   // G
            data[idx+2] = 35;   // B
            data[idx+3] = 255;  // A
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);

      // Draw trees (available sticks)
      const chunkX = Math.floor(px / CHUNK_SIZE);
      const chunkZ = Math.floor(pz / CHUNK_SIZE);
      
      ctx.fillStyle = '#228B22'; // Forest Green
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

      // Draw placed blocks
      for (const block of placedBlocks) {
        const mx = block.position[0] - px + halfSize;
        const mz = block.position[2] - pz + halfSize;
        if (mx >= 0 && mx < size && mz >= 0 && mz < size) {
          ctx.fillStyle = block.type === 'stick' ? '#8B4513' : '#3d2817';
          ctx.fillRect(mx - 1, mz - 1, 3, 3);
        }
      }

      // Draw player
      ctx.fillStyle = '#FF0000';
      ctx.beginPath();
      ctx.arc(halfSize, halfSize, 2, 0, Math.PI * 2);
      ctx.fill();

      // Draw player direction
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
    <div className="absolute bottom-4 right-4 border-4 border-amber-900 rounded-lg overflow-hidden bg-amber-100/50 shadow-lg pointer-events-auto">
      <div className="bg-amber-900 text-amber-100 text-xs text-center py-1 font-bold tracking-wider">MINIMAP</div>
      <canvas ref={canvasRef} width={100} height={100} className="w-40 h-40" style={{ imageRendering: 'pixelated' }} />
    </div>
  );
}
