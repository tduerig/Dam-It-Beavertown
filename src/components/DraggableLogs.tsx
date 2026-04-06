import { useFrame } from '@react-three/fiber';
import { useGameStore, PlacedBlock } from '../store';
import { waterEngine } from '../utils/WaterEngine';
import { getTerrainHeight } from '../utils/terrain';
import * as THREE from 'three';
import { useMemo, useRef, useEffect } from 'react';

// Pre-allocated scratch for leaf decay terrain deposits
const _leafDropPos = new THREE.Vector3();

function getEffectiveGroundHeightFromHash(x: number, z: number, blockHash: Map<string, number>) {
  let h = getTerrainHeight(x, z);
  // Blocks are snapped to 0.5 increments. Check local neighborhood instead of global iteration array.
  const snapX = Math.round(x * 2) / 2;
  const snapZ = Math.round(z * 2) / 2;
  
  for (let dx = -1; dx <= 1; dx += 0.5) {
    for (let dz = -1; dz <= 1; dz += 0.5) {
      const bx = snapX + dx;
      const bz = snapZ + dz;
      // Precise physics boundary check natively
      if (Math.abs(x - bx) < 1.0 && Math.abs(z - bz) < 1.0) {
        const bh = blockHash.get(`${bx},${bz}`);
        if (bh !== undefined && bh > h) {
          h = bh;
        }
      }
    }
  }
  return h;
}

export const BRANCH_CONFIGS = [
  { y: 4.0, angle: 0, tilt: Math.PI/4, swivel: 0.1, scale: 0.8 },
  { y: 2.0, angle: Math.PI*2/3, tilt: Math.PI/5, swivel: -0.2, scale: 1.0 },
  { y: 0.0, angle: Math.PI*4/3, tilt: Math.PI/3.5, swivel: 0.15, scale: 1.2 },
  { y: -2.0, angle: Math.PI/3, tilt: Math.PI/4, swivel: -0.1, scale: 0.9 },
  { y: -4.0, angle: Math.PI, tilt: Math.PI/6, swivel: 0.2, scale: 1.3 },
  { y: 3.0, angle: Math.PI*1.2, tilt: Math.PI/4.5, swivel: -0.15, scale: 0.7 },
  { y: -1.0, angle: Math.PI*1.8, tilt: Math.PI/5.5, swivel: 0.1, scale: 1.1 },
  { y: -5.0, angle: Math.PI/2, tilt: Math.PI/4, swivel: -0.2, scale: 1.4 },
].map(cfg => {
  const radius = 1.68 - ((cfg.y + 5.6) / 11.2) * (1.68 - 1.12);
  // Use sin for X and cos for Z so that angle=0 means +Z position, matching the +Z pointing direction
  const px = Math.sin(cfg.angle) * radius * 0.9;
  const pz = Math.cos(cfg.angle) * radius * 0.9;
  
  const qRadial = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cfg.angle);
  const qSwivel = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cfg.swivel);
  const qTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI/2 - cfg.tilt);
  
  const quat = new THREE.Quaternion();
  quat.multiply(qRadial).multiply(qSwivel).multiply(qTilt);
  
  return {
    pos: [px, cfg.y, pz] as [number, number, number],
    quat: [quat.x, quat.y, quat.z, quat.w] as [number, number, number, number],
    scale: [cfg.scale, cfg.scale, cfg.scale] as [number, number, number]
  };
});

const dummy = new THREE.Object3D();
const dummyLog = new THREE.Object3D();
const dummyLeaves = new THREE.Object3D();
const dummyWhittle = new THREE.Object3D();
const dummyBranches: THREE.Object3D[] = [];
for (let i = 0; i < 8; i++) {
  dummyBranches.push(new THREE.Object3D());
}

export function DraggableLogs() {
  const logs = useGameStore(state => state.draggableLogs);

  const { logGeo, logMat, leavesGeo, leavesMat, branchGeo, whittleGeo, whittleMat } = useMemo(() => {
    const lGeo = new THREE.CylinderGeometry(1.12, 1.68, 11.2, 8);
    const lMat = new THREE.MeshStandardMaterial({ color: '#5C4033' });
    const wMat = new THREE.MeshStandardMaterial({ color: '#E6C280' }); // Lighter wood color
    
    const maxLogs = 1000;
    
    const leGeo = new THREE.ConeGeometry(7, 14, 8);
    leGeo.setAttribute('aDissolve', new THREE.InstancedBufferAttribute(new Float32Array(maxLogs), 1));
    
    const leMat = new THREE.MeshStandardMaterial({ color: '#228B22', side: THREE.DoubleSide });
    leMat.onBeforeCompile = (shader) => {
      shader.vertexShader = `
        attribute float aDissolve;
        varying float vDissolve;
        varying vec3 vPos;
        ${shader.vertexShader}
      `.replace(
        `#include <begin_vertex>`,
        `
        #include <begin_vertex>
        vDissolve = aDissolve;
        vPos = position;
        `
      );
      shader.fragmentShader = `
        varying float vDissolve;
        varying vec3 vPos;
        
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + .1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                         mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                         mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        ${shader.fragmentShader}
      `.replace(
        `vec4 diffuseColor = vec4( diffuse, opacity );`,
        `
        vec4 diffuseColor = vec4( diffuse, opacity );
        if (vDissolve < 0.99) {
          float n = noise(vPos * 1.0);
          float threshold = vDissolve * 1.2 - 0.1;
          if (n > threshold) {
            discard;
          }
          if (n > threshold - 0.15) {
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.4, 0.2, 0.0), 0.8);
          }
        }
        `
      );
    };

    return {
      logGeo: lGeo,
      logMat: lMat,
      leavesGeo: leGeo,
      leavesMat: leMat,
      branchGeo: new THREE.CylinderGeometry(0.28, 0.56, 4.2, 8),
      whittleGeo: new THREE.ConeGeometry(1.68, 2.1, 8),
      whittleMat: wMat,
    };
  }, []);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const leavesMeshRef = useRef<THREE.InstancedMesh>(null);
  const branchesMeshRef = useRef<THREE.InstancedMesh>(null);
  const whittleMeshRef = useRef<THREE.InstancedMesh>(null);
  
  const leavesScales = useRef(new Map<string, number>());
  const pivotHeightsRef = useRef(new Map<string, number>());
  
  // Track mesh identity so we can detect when the InstancedMesh remounts
  // (e.g. when logs.length changes). On remount, ALL matrices must be rebuilt.
  const lastMeshInstance = useRef<THREE.InstancedMesh | null>(null);
  
  const blockHashRef = useRef(new Map<string, number>());
  
  useEffect(() => {
    let lastBlocks = useGameStore.getState().placedBlocks;
    
    const updateHash = (placedBlocks: PlacedBlock[]) => {
      const map = new Map<string, number>();
      for (const block of placedBlocks) {
        const bx = block.position[0];
        const bz = block.position[2];
        const blockTopY = block.position[1] + (block.type === 'mud' ? 0.25 : 0.4);
        const key = `${bx},${bz}`;
        const existing = map.get(key);
        if (existing === undefined || blockTopY > existing) {
          map.set(key, blockTopY);
        }
      }
      blockHashRef.current = map;
    };
    
    updateHash(lastBlocks);

    const unsub = useGameStore.subscribe((state) => {
      if (state.placedBlocks !== lastBlocks) {
        lastBlocks = state.placedBlocks;
        updateHash(lastBlocks);
      }
    });
    
    return unsub;
  }, []);

  useFrame((state, delta) => {
    const { gameState } = useGameStore.getState();
    if (gameState !== 'playing') return;

    const dt = Math.min(delta, 0.1);
    if (!meshRef.current || !leavesMeshRef.current || !branchesMeshRef.current || !whittleMeshRef.current) return;

    const { playerPosition, playerRotation, placedBlocks } = useGameStore.getState();

    let needsInstanceUpdate = false;
    
    // Detect InstancedMesh remount: when logs.length changes, R3F destroys
    // and recreates the mesh. The new mesh has uninitialized (identity) matrices.
    // Cemented/sleeping logs would skip their matrix update and appear to vanish.
    const meshRemounted = meshRef.current !== lastMeshInstance.current;
    if (meshRemounted) {
      lastMeshInstance.current = meshRef.current;
    }
    
    // Batch terrain modifications to avoid Zustand shallow-copy storm (AP-2 fix)
    const terrainBatch: Array<{x: number, z: number, amount: number, radius: number}> = [];

    logs.forEach((log, i) => {
      let [lx, ly, lz] = log.position;
      let [rx, ry, rz] = log.rotation;
      
      let currentLeavesScale = leavesScales.current.get(log.id);
      if (currentLeavesScale === undefined) currentLeavesScale = 1;

      // SLEEP ZONE: If the log is cemented, flat on the ground, and leaves are fully decayed,
      // it physically never moves again. Bypass all JS math and Matrix float calculations!
      // BUT: skip sleep on the first frame after a mesh remount — we must set the matrix at least once.
      if (!meshRemounted && log.isMudded && !log.isDragged && rx >= Math.PI / 2 - 0.01 && currentLeavesScale === 0) {
        return; 
      }
      
      needsInstanceUpdate = true;

      // Only check collision floats for active entities
      if (log.isDragged) {
        // We want the log to drag naturally.
        // The player grabs it by the pointy end.
        // The log is 11.2 units long. The pointy end is at local y = -5.6.
        // So the center of the log should be 5.6 units behind the player.
        
        // Let's make the log drag behind the player, pointing towards the player.
        const dragDist = 5.6; 
        const targetX = playerPosition[0] - Math.sin(playerRotation) * dragDist;
        const targetZ = playerPosition[2] - Math.cos(playerRotation) * dragDist;
        
        // Smoothly move towards target (slower = heavier feel)
        lx += (targetX - lx) * 3 * dt;
        lz += (targetZ - lz) * 3 * dt;
        
        // The log should point from its center towards the player.
        // Actually, if it's dragging behind, its rotation should just match the player's rotation.
        // Let's make it ragdoll a bit by pointing it towards the player's position.
        const dx = playerPosition[0] - lx;
        const dz = playerPosition[2] - lz;
        const targetRy = Math.atan2(dx, dz);
        
        let diff = targetRy - ry;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        ry += diff * 4 * dt;
        
        rx = Math.PI / 2; // Dragging horizontally
        rz = 0;
        
        // Height based on water or terrain
        const waterHeight = waterEngine.getSurfaceHeight(lx, lz);
        const groundHeight = getEffectiveGroundHeightFromHash(lx, lz, blockHashRef.current);
        
        if (waterHeight > groundHeight + 1) {
          ly = waterHeight; // Float
        } else {
          ly = groundHeight + 0.4; // Drag on ground
        }
        
        // Mutate directly to avoid re-renders
        log.position = [lx, ly, lz];
        log.rotation = [rx, ry, rz];
      } else {
        if (rx < Math.PI / 2) {
          // Falling animation
          const oldRx = rx;
          // Start VERY slow, accelerate smoothly as it falls.
          const fallSpeed = 0.15 + Math.pow(Math.sin(rx), 2) * 3.6;
          rx += fallSpeed * dt;
          if (rx > Math.PI / 2) rx = Math.PI / 2;
          
          // Calculate ground height at the BASE of the tree, cached!
          let groundHeight = pivotHeightsRef.current.get(log.id);
          if (groundHeight === undefined) {
            const baseX = lx - Math.sin(ry) * 7.7 * Math.sin(rx);
            const baseZ = lz - Math.cos(ry) * 7.7 * Math.sin(rx);
            groundHeight = getEffectiveGroundHeightFromHash(baseX, baseZ, blockHashRef.current);
            pivotHeightsRef.current.set(log.id, groundHeight);
          }
          
          // The pinch point (hinge) is 1.4 units above ground.
          // As it falls, the hinge breaks and it slides down to rest flush with the ground.
          // When flat (rx = PI/2), the log rests on its side, so its center is at groundHeight + 1.68.
          const fallProgress = rx / (Math.PI / 2);
          const pivotHeight = groundHeight + 1.4 + fallProgress * (1.68 - 1.4);
          
          // Center height
          ly = pivotHeight + Math.cos(rx) * 7.7;
          
          // Shift horizontally to keep pivot fixed (relative to its sliding down)
          const horizontalShift = 7.7 * (Math.sin(rx) - Math.sin(oldRx));
          lx += Math.sin(ry) * horizontalShift;
          lz += Math.cos(ry) * horizontalShift;
          
          log.position = [lx, ly, lz];
          log.rotation = [rx, ry, rz];
        } else {
          // Floating physics if in water
          const waterHeight = waterEngine.getSurfaceHeight(lx, lz);
          const effectiveGroundHeight = getEffectiveGroundHeightFromHash(lx, lz, blockHashRef.current);
          const groundHeight = effectiveGroundHeight + 0.4; // Log radius is ~0.4
          
          if (!log.isMudded) {
            if (waterHeight > ly - 1) {
              // Float up
              ly += (waterHeight - ly) * 5 * dt;
              
              // Drift with water flow
              const flow = waterEngine.getVelocity(lx, lz);
              lx += flow.x * dt;
              lz += flow.z * dt;
              
              // Slowly rotate to align with flow
              if (Math.abs(flow.x) > 0.1 || Math.abs(flow.z) > 0.1) {
                const targetRot = Math.atan2(flow.x, flow.z);
                ry += (targetRot - ry) * dt;
              }
              
              // If it touches the ground while in water, it gets mudded!
              if (ly <= groundHeight + 0.1) {
                log.isMudded = true; // Mutate locally to prevent spamming
                useGameStore.getState().setLogMudded(log.id, true);
              }
            } else {
              // Fall to ground
              if (ly > groundHeight) {
                ly -= 10 * dt; // Gravity
              }
            }
            
            // Prevent clipping into ground
            if (ly < groundHeight) {
              ly = groundHeight;
            }
          } else {
            // Mudded log: just fall to ground if it's somehow above it, but don't float
            if (ly > groundHeight) {
              ly -= 10 * dt;
              if (ly < groundHeight) {
                ly = groundHeight;
              }
            }
            // If ly < groundHeight, it means mud was placed on top of it. Let it stay buried!
          }
          
          // Mutate directly to avoid re-renders
          log.position = [lx, ly, lz];
          log.rotation = [rx, ry, rz];
        }
      }

      // Apply rotation updates
      dummy.position.set(lx, ly, lz);
      dummy.rotation.set(rx, ry, rz, 'YXZ');
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
      
      const prevLeavesScale = currentLeavesScale;
      
      // ONLY melt leaves if the log has finished falling!
      if (rx >= Math.PI / 2 - 0.01) {
        // Leaves melt away for downed logs. Faster in water.
        const isFlooded = waterEngine.getSurfaceHeight(lx, lz) > ly;
        const fadeRate = isFlooded ? 0.4 : 0.0375; // ~2.5s in water safely, restore slow 26s cinematic decay on land
        currentLeavesScale = Math.max(0, currentLeavesScale - dt * fadeRate);
        leavesScales.current.set(log.id, currentLeavesScale);
        needsInstanceUpdate = true;
      }
      
      if (i < 1000) {
        leavesGeo.attributes.aDissolve.setX(i, currentLeavesScale);
      }
      
      // Position leaves relative to log
      dummyLog.position.set(lx, ly, lz);
      dummyLog.rotation.set(rx, ry, rz, 'YXZ');
      dummyLog.updateMatrixWorld(true);
      
      // Leaves at the top half
      dummyLeaves.position.set(0, 4.9, 0); 
      dummyLeaves.scale.set(1, 1, 1);
      dummyLeaves.rotation.set(0, 0, 0);
      dummyLeaves.matrix.compose(dummyLeaves.position, dummyLeaves.quaternion, dummyLeaves.scale);
      dummyLeaves.matrixWorld.multiplyMatrices(dummyLog.matrixWorld, dummyLeaves.matrix);
      leavesMeshRef.current!.setMatrixAt(i, dummyLeaves.matrixWorld);
      
      // Branches (always visible, but more obvious when leaves are gone)
      BRANCH_CONFIGS.forEach((config, bIdx) => {
        const branchScale = config.scale[0] * (0.1 + 0.9 * (1 - currentLeavesScale));
        const b = dummyBranches[bIdx];
        b.position.set(...config.pos);
        b.quaternion.set(config.quat[0], config.quat[1], config.quat[2], config.quat[3]);
        b.scale.set(branchScale, branchScale, branchScale);
        b.matrix.compose(b.position, b.quaternion, b.scale);
        b.matrixWorld.multiplyMatrices(dummyLog.matrixWorld, b.matrix);
        branchesMeshRef.current!.setMatrixAt(i * 8 + bIdx, b.matrixWorld);
      });
      
      // Pencil-end only at the bottom (root) of the log, not the crown
      dummyWhittle.position.set(0, -6.65, 0); 
      dummyWhittle.rotation.set(Math.PI, 0, 0); 
      dummyWhittle.scale.set(1, 1, 1);
      dummyWhittle.matrix.compose(dummyWhittle.position, dummyWhittle.quaternion, dummyWhittle.scale);
      dummyWhittle.matrixWorld.multiplyMatrices(dummyLog.matrixWorld, dummyWhittle.matrix);
      whittleMeshRef.current!.setMatrixAt(i, dummyWhittle.matrixWorld);
      
      // Drop mud randomly as leaves disintegrate
      if (prevLeavesScale > 0 && currentLeavesScale < prevLeavesScale) {
        // We want to drop a thin, even layer.
        // Do multiple small drops per frame based on the amount melted.
        const expectedDrops = (prevLeavesScale - currentLeavesScale) * 150;
        let dropsThisFrame = Math.floor(expectedDrops);
        if (Math.random() < (expectedDrops - dropsThisFrame)) {
          dropsThisFrame++;
        }
        
        for (let d = 0; d < dropsThisFrame; d++) {
          // Leaves cone: center at local Y=4.9, height=14, radius=7
          // Cone base is at 4.9 - 7 = -2.1, tip at 4.9 + 7 = 11.9
          const coneLocalY = -7.0 + Math.random() * 14.0; // -7 to +7 relative to cone center
          const progress = (coneLocalY + 7.0) / 14.0; // 0 at base, 1 at tip
          const maxRadius = 7.0 * (1 - progress); // 7 at base, 0 at tip
          
          const angle = Math.random() * Math.PI * 2;
          // Use sqrt(random) for uniform distribution in the circular cross-section
          const radius = Math.sqrt(Math.random()) * maxRadius; 
          const localX = Math.cos(angle) * radius;
          const localZ = Math.sin(angle) * radius;
          
          // Offset by the leaves' position (4.9) relative to log center
          _leafDropPos.set(localX, coneLocalY + 4.9, localZ);
          dummyLog.localToWorld(_leafDropPos);
          
          // Accumulate into batch instead of dispatching per-drop
          terrainBatch.push({ x: _leafDropPos.x, z: _leafDropPos.z, amount: 0.1, radius: 1.5 });
        }
      }
    });

    // Single batched Zustand dispatch for all terrain modifications this frame
    if (terrainBatch.length > 0) {
      useGameStore.getState().batchModifyTerrain(terrainBatch);
    }

    if (needsInstanceUpdate) {
      meshRef.current.instanceMatrix.needsUpdate = true;
      leavesMeshRef.current.instanceMatrix.needsUpdate = true;
      branchesMeshRef.current.instanceMatrix.needsUpdate = true;
      whittleMeshRef.current.instanceMatrix.needsUpdate = true;
      leavesGeo.attributes.aDissolve.needsUpdate = true;
    }
  });

  if (logs.length === 0) return null;

  return (
    <group>
      <instancedMesh ref={meshRef} args={[logGeo, logMat, logs.length]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={leavesMeshRef} args={[leavesGeo, leavesMat, logs.length]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={branchesMeshRef} args={[branchGeo, logMat, logs.length * BRANCH_CONFIGS.length]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={whittleMeshRef} args={[whittleGeo, whittleMat, logs.length]} castShadow receiveShadow frustumCulled={false} />
    </group>
  );
}
