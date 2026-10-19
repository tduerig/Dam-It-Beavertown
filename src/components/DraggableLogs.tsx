import { useFrame } from '@react-three/fiber';
import { useGameStore, PlacedBlock, DraggableLog } from '../store';
import { waterEngine } from '../utils/WaterEngine';
import { getTerrainHeight } from '../utils/terrain';
import { createMaterial } from '../utils/qualityTier';
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

const MAX_LOGS = 250;

export function DraggableLogs() {
  const { logGeo, logMat, leavesGeo, leavesMat, branchGeo, whittleGeo, whittleMat } = useMemo(() => {
    const lGeo = new THREE.CylinderGeometry(1.12, 1.68, 11.2, 8);
    const lMat = createMaterial({ color: '#5C4033' });
    const wMat = createMaterial({ color: '#E6C280' }); // Lighter wood color

    // Precomputed 64x64 noise texture (replaces 70-FLOP procedural 3D noise per fragment)
    const texSize = 64;
    const texData = new Uint8Array(texSize * texSize * 4);
    for (let i = 0; i < texSize * texSize * 4; i += 4) {
      const v = Math.random() * 255;
      texData[i] = v; texData[i + 1] = v; texData[i + 2] = v; texData[i + 3] = 255;
    }
    const noiseTex = new THREE.DataTexture(texData, texSize, texSize, THREE.RGBAFormat);
    noiseTex.wrapS = THREE.RepeatWrapping;
    noiseTex.wrapT = THREE.RepeatWrapping;
    noiseTex.magFilter = THREE.LinearFilter;
    noiseTex.minFilter = THREE.LinearFilter;
    noiseTex.needsUpdate = true;
    
    const leGeo = new THREE.ConeGeometry(7, 14, 8);
    leGeo.setAttribute('aDissolve', new THREE.InstancedBufferAttribute(new Float32Array(MAX_LOGS), 1));
    
    const leMat = createMaterial({ color: '#228B22', side: THREE.DoubleSide });
    leMat.onBeforeCompile = (shader) => {
      shader.uniforms.tNoise = { value: noiseTex };
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
        uniform sampler2D tNoise;
        varying float vDissolve;
        varying vec3 vPos;
        ${shader.fragmentShader}
      `.replace(
        `vec4 diffuseColor = vec4( diffuse, opacity );`,
        `
        vec4 diffuseColor = vec4( diffuse, opacity );
        if (vDissolve < 0.99) {
          float rawNoise = texture2D(tNoise, vPos.xy * 0.2).r;
          float threshold = vDissolve * 1.2 - 0.1;
          if (rawNoise > threshold) {
            discard;
          }
          if (rawNoise > threshold - 0.15) {
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.4, 0.2, 0.0), 0.8);
          }
        }
        `
      );
    };

    const bGeo = new THREE.CylinderGeometry(0.28, 0.56, 4.2, 8);
    const sGeo = new THREE.ConeGeometry(1.68, 2.1, 8);
    
    // Explicit bounding sphere for native frustum culling
    // Logs are global, so we use a huge sphere covering the map
    const cullingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2000);
    lGeo.boundingSphere = cullingSphere;
    leGeo.boundingSphere = cullingSphere;
    bGeo.boundingSphere = cullingSphere;
    sGeo.boundingSphere = cullingSphere;

    return {
      logGeo: lGeo,
      logMat: lMat,
      leavesGeo: leGeo,
      leavesMat: leMat,
      branchGeo: bGeo,
      whittleGeo: sGeo,
      whittleMat: wMat,
    };
  }, []);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const leavesMeshRef = useRef<THREE.InstancedMesh>(null);
  const branchesMeshRef = useRef<THREE.InstancedMesh>(null);
  const whittleMeshRef = useRef<THREE.InstancedMesh>(null);
  
  const leavesScales = useRef(new Map<string, number>());
  const pivotHeightsRef = useRef(new Map<string, number>());
  const restingMapRef = useRef(new Map<string, boolean>());
  const lastLogCountRef = useRef(-1);
  const lastLogsRef = useRef<DraggableLog[] | null>(null);
  
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
    if (!meshRef.current || !leavesMeshRef.current || !branchesMeshRef.current || !whittleMeshRef.current) return;

    const { gameState, playerPosition, playerRotation, draggableLogs: logs } = useGameStore.getState();
    const renderCount = Math.min(logs.length, MAX_LOGS);
    const logsChanged = logs !== lastLogsRef.current || renderCount !== lastLogCountRef.current;

    if (logsChanged) {
      lastLogsRef.current = logs;
      lastLogCountRef.current = renderCount;
      meshRef.current.count = renderCount;
      leavesMeshRef.current.count = renderCount;
      branchesMeshRef.current.count = renderCount * BRANCH_CONFIGS.length;
      whittleMeshRef.current.count = renderCount;
    }

    if (gameState !== 'playing' && !logsChanged) return;
    if (renderCount === 0) return;

    const dt = gameState === 'playing' ? Math.min(delta, 0.1) : 0;
    let needsInstanceUpdate = logsChanged;
    
    // Batch terrain modifications to avoid Zustand shallow-copy storm (AP-2 fix)
    const terrainBatch: Array<{x: number, z: number, amount: number, radius: number}> = [];

    for (let i = 0; i < renderCount; i++) {
      const log = logs[i];
      let [lx, ly, lz] = log.position;
      let [rx, ry, rz] = log.rotation;
      
      let currentLeavesScale = leavesScales.current.get(log.id);
      if (currentLeavesScale === undefined) currentLeavesScale = 1;

      // SLEEP ZONE: If the log is cemented OR flat on the ground and resting,
      // and leaves are fully decayed, it physically never moves again UNLESS flooded or dragged.
      // Bypass all JS math and Matrix float calculations!
      const isResting = restingMapRef.current.get(log.id) === true;
      if (!logsChanged && !log.isDragged && rx >= Math.PI / 2 - 0.01 && currentLeavesScale === 0) {
        if (log.isMudded) continue; // Permanently buried
        
        const waterHeight = waterEngine.getSurfaceHeight(lx, lz);
        if (waterHeight <= ly - 1 && isResting) {
          continue; // Resting on land, safe from water. Sleep!
        }
      }
      
      needsInstanceUpdate = true;

      // Only check collision floats for active entities
      if (log.isDragged) {
        const dragDist = 5.6; 
        const targetX = playerPosition[0] - Math.sin(playerRotation) * dragDist;
        const targetZ = playerPosition[2] - Math.cos(playerRotation) * dragDist;
        
        lx += (targetX - lx) * 3 * dt;
        lz += (targetZ - lz) * 3 * dt;
        
        const dx = playerPosition[0] - lx;
        const dz = playerPosition[2] - lz;
        const targetRy = Math.atan2(dx, dz);
        
        let diff = targetRy - ry;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        ry += diff * 4 * dt;
        
        rx = Math.PI / 2; // Dragging horizontally
        rz = 0;
        
        const waterHeight = waterEngine.getSurfaceHeight(lx, lz);
        const groundHeight = getEffectiveGroundHeightFromHash(lx, lz, blockHashRef.current);
        
        if (waterHeight > groundHeight + 1) {
          ly = waterHeight; // Float
        } else {
          ly = groundHeight + 0.4; // Drag on ground
        }
        
        log.position[0] = lx; log.position[1] = ly; log.position[2] = lz;
        log.rotation[0] = rx; log.rotation[1] = ry; log.rotation[2] = rz;
        restingMapRef.current.set(log.id, false);
      } else {
        if (rx < Math.PI / 2) {
          // Falling animation
          const oldRx = rx;
          const sinRx = Math.sin(rx);
          const fallSpeed = 0.15 + sinRx * sinRx * 3.6;
          rx += fallSpeed * dt;
          if (rx > Math.PI / 2) rx = Math.PI / 2;
          
          let groundHeight = pivotHeightsRef.current.get(log.id);
          if (groundHeight === undefined) {
            const baseX = lx - Math.sin(ry) * 7.7 * Math.sin(rx);
            const baseZ = lz - Math.cos(ry) * 7.7 * Math.sin(rx);
            groundHeight = getEffectiveGroundHeightFromHash(baseX, baseZ, blockHashRef.current);
            pivotHeightsRef.current.set(log.id, groundHeight);
          }
          
          const fallProgress = rx / (Math.PI / 2);
          const pivotHeight = groundHeight + 1.4 + fallProgress * (1.68 - 1.4);
          
          ly = pivotHeight + Math.cos(rx) * 7.7;
          
          const horizontalShift = 7.7 * (Math.sin(rx) - Math.sin(oldRx));
          lx += Math.sin(ry) * horizontalShift;
          lz += Math.cos(ry) * horizontalShift;
          
          log.position[0] = lx; log.position[1] = ly; log.position[2] = lz;
          log.rotation[0] = rx; log.rotation[1] = ry; log.rotation[2] = rz;
        } else {
          const waterHeight = waterEngine.getSurfaceHeight(lx, lz);
          const effectiveGroundHeight = getEffectiveGroundHeightFromHash(lx, lz, blockHashRef.current);
          const groundHeight = effectiveGroundHeight + 0.4;
          
          if (!log.isMudded) {
            if (waterHeight > ly - 1) {
              ly += (waterHeight - ly) * 5 * dt;
              
              const flow = waterEngine.getVelocity(lx, lz);
              lx += flow.x * dt;
              lz += flow.z * dt;
              
              if (Math.abs(flow.x) > 0.1 || Math.abs(flow.z) > 0.1) {
                const targetRot = Math.atan2(flow.x, flow.z);
                ry += (targetRot - ry) * dt;
              }
              
              if (ly <= groundHeight + 0.1) {
                log.isMudded = true;
                useGameStore.getState().setLogMudded(log.id, true);
              }
              restingMapRef.current.set(log.id, false);
            } else {
              if (ly > groundHeight) {
                ly -= 10 * dt;
                restingMapRef.current.set(log.id, false);
              }
            }
            
            if (ly <= groundHeight) {
              ly = groundHeight;
              restingMapRef.current.set(log.id, true);
            }
          } else {
            if (ly > groundHeight) {
              ly -= 10 * dt;
            }
            if (ly <= groundHeight) {
              ly = groundHeight;
              restingMapRef.current.set(log.id, true);
            }
          }
          
          log.position[0] = lx; log.position[1] = ly; log.position[2] = lz;
          log.rotation[0] = rx; log.rotation[1] = ry; log.rotation[2] = rz;
        }
      }

      dummy.position.set(lx, ly, lz);
      dummy.rotation.set(rx, ry, rz, 'YXZ');
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
      
      const prevLeavesScale = currentLeavesScale;
      
      if (rx >= Math.PI / 2 - 0.01) {
        const isFlooded = waterEngine.getSurfaceHeight(lx, lz) > ly;
        const fadeRate = isFlooded ? 0.4 : 0.0375;
        currentLeavesScale = Math.max(0, currentLeavesScale - dt * fadeRate);
        leavesScales.current.set(log.id, currentLeavesScale);
        needsInstanceUpdate = true;
      }
      
      leavesGeo.attributes.aDissolve.setX(i, currentLeavesScale);
      
      dummyLog.position.set(lx, ly, lz);
      dummyLog.rotation.set(rx, ry, rz, 'YXZ');
      dummyLog.updateMatrixWorld(true);
      
      dummyLeaves.position.set(0, 4.9, 0); 
      dummyLeaves.scale.set(1, 1, 1);
      dummyLeaves.rotation.set(0, 0, 0);
      dummyLeaves.matrix.compose(dummyLeaves.position, dummyLeaves.quaternion, dummyLeaves.scale);
      dummyLeaves.matrixWorld.multiplyMatrices(dummyLog.matrixWorld, dummyLeaves.matrix);
      leavesMeshRef.current!.setMatrixAt(i, dummyLeaves.matrixWorld);
      
      for (let bIdx = 0; bIdx < BRANCH_CONFIGS.length; bIdx++) {
        const config = BRANCH_CONFIGS[bIdx];
        const branchScale = config.scale[0] * (0.1 + 0.9 * (1 - currentLeavesScale));
        const b = dummyBranches[bIdx];
        b.position.set(...config.pos);
        b.quaternion.set(config.quat[0], config.quat[1], config.quat[2], config.quat[3]);
        b.scale.set(branchScale, branchScale, branchScale);
        b.matrix.compose(b.position, b.quaternion, b.scale);
        b.matrixWorld.multiplyMatrices(dummyLog.matrixWorld, b.matrix);
        branchesMeshRef.current!.setMatrixAt(i * 8 + bIdx, b.matrixWorld);
      }
      
      dummyWhittle.position.set(0, -6.65, 0); 
      dummyWhittle.rotation.set(Math.PI, 0, 0); 
      dummyWhittle.scale.set(1, 1, 1);
      dummyWhittle.matrix.compose(dummyWhittle.position, dummyWhittle.quaternion, dummyWhittle.scale);
      dummyWhittle.matrixWorld.multiplyMatrices(dummyLog.matrixWorld, dummyWhittle.matrix);
      whittleMeshRef.current!.setMatrixAt(i, dummyWhittle.matrixWorld);
      
      if (prevLeavesScale > 0 && currentLeavesScale < prevLeavesScale) {
        const expectedDrops = (prevLeavesScale - currentLeavesScale) * 150;
        let dropsThisFrame = Math.floor(expectedDrops);
        if (Math.random() < (expectedDrops - dropsThisFrame)) {
          dropsThisFrame++;
        }
        
        for (let d = 0; d < dropsThisFrame; d++) {
          const coneLocalY = -7.0 + Math.random() * 14.0;
          const progress = (coneLocalY + 7.0) / 14.0;
          const maxRadius = 7.0 * (1 - progress);
          
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.sqrt(Math.random()) * maxRadius; 
          const localX = Math.cos(angle) * radius;
          const localZ = Math.sin(angle) * radius;
          
          _leafDropPos.set(localX, coneLocalY + 4.9, localZ);
          dummyLog.localToWorld(_leafDropPos);
          
          terrainBatch.push({ x: _leafDropPos.x, z: _leafDropPos.z, amount: 0.1, radius: 1.5 });
        }
      }
    }

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

  return (
    <group>
      <instancedMesh ref={meshRef} args={[logGeo, logMat, MAX_LOGS]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={leavesMeshRef} args={[leavesGeo, leavesMat, MAX_LOGS]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={branchesMeshRef} args={[branchGeo, logMat, MAX_LOGS * BRANCH_CONFIGS.length]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={whittleMeshRef} args={[whittleGeo, whittleMat, MAX_LOGS]} castShadow receiveShadow frustumCulled={false} />
    </group>
  );
}
