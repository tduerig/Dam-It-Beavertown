import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../store';
import { waterEngine } from '../utils/WaterEngine';
import { getTerrainHeight } from '../utils/terrain';
import * as THREE from 'three';
import { useMemo, useRef } from 'react';

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

  useFrame((state, delta) => {
    if (!meshRef.current || !leavesMeshRef.current || !branchesMeshRef.current || !whittleMeshRef.current) return;

    const { playerPosition, playerRotation } = useGameStore.getState();

    logs.forEach((log, i) => {
      let [lx, ly, lz] = log.position;
      let [rx, ry, rz] = log.rotation;

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
        lx += (targetX - lx) * 3 * delta;
        lz += (targetZ - lz) * 3 * delta;
        
        // The log should point from its center towards the player.
        // Actually, if it's dragging behind, its rotation should just match the player's rotation.
        // Let's make it ragdoll a bit by pointing it towards the player's position.
        const dx = playerPosition[0] - lx;
        const dz = playerPosition[2] - lz;
        const targetRy = Math.atan2(dx, dz);
        
        let diff = targetRy - ry;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        ry += diff * 4 * delta;
        
        rx = Math.PI / 2; // Dragging horizontally
        rz = 0;
        
        // Height based on water or terrain
        const waterHeight = waterEngine.getSurfaceHeight(lx, lz);
        const groundHeight = getTerrainHeight(lx, lz);
        
        if (waterHeight > groundHeight + 1) {
          ly = waterHeight; // Float
        } else {
          ly = groundHeight + 1.12; // Drag on ground
        }
        
        // Mutate directly to avoid re-renders
        log.position = [lx, ly, lz];
        log.rotation = [rx, ry, rz];
      } else {
        if (rx < Math.PI / 2) {
          // Falling animation
          const oldRx = rx;
          // Start slow, accelerate as it falls.
          const fallSpeed = 0.2 + Math.sin(rx) * 2.0;
          rx += fallSpeed * delta;
          if (rx > Math.PI / 2) rx = Math.PI / 2;
          
          const groundHeight = getTerrainHeight(lx, lz);
          // Center height goes from 5.6 to 1.12
          ly = groundHeight + 1.12 + Math.cos(rx) * 4.48;
          
          // Shift horizontally to keep base fixed
          const horizontalShift = 5.6 * (Math.sin(rx) - Math.sin(oldRx));
          lx += Math.sin(ry) * horizontalShift;
          lz += Math.cos(ry) * horizontalShift;
          
          log.position = [lx, ly, lz];
          log.rotation = [rx, ry, rz];
        } else {
          // Floating physics if in water
          const waterHeight = waterEngine.getSurfaceHeight(lx, lz);
          const groundHeight = getTerrainHeight(lx, lz) + 1.12; // Log radius is ~1.12
          
          if (!log.isMudded) {
            if (waterHeight > ly - 1) {
              // Float up
              ly += (waterHeight - ly) * 5 * delta;
              
              // Drift with water flow
              const flow = waterEngine.getVelocity(lx, lz);
              lx += flow.x * delta;
              lz += flow.z * delta;
              
              // Slowly rotate to align with flow
              if (Math.abs(flow.x) > 0.1 || Math.abs(flow.z) > 0.1) {
                const targetRot = Math.atan2(flow.x, flow.z);
                ry += (targetRot - ry) * delta;
              }
            } else {
              // Fall to ground
              if (ly > groundHeight) {
                ly -= 10 * delta; // Gravity
              }
            }
            
            // Prevent clipping into ground
            if (ly < groundHeight) {
              ly = groundHeight;
            }
          } else {
            // Mudded log: just fall to ground if it's somehow above it, but don't float
            if (ly > groundHeight) {
              ly -= 10 * delta;
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

      // Render trunk
      dummy.position.set(lx, ly, lz);
      dummy.rotation.set(rx, ry, rz);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
      
      // Leaves and branches logic
      const isFlooded = waterEngine.getSurfaceHeight(lx, lz) > ly;
      let currentLeavesScale = leavesScales.current.get(log.id);
      if (currentLeavesScale === undefined) currentLeavesScale = 1;
      
      // Leaves always melt away for downed logs. Faster in water.
      const fadeRate = isFlooded ? 0.2 : (1 / 30); // 5s in water, 30s on land
      currentLeavesScale = Math.max(0, currentLeavesScale - delta * fadeRate);
      leavesScales.current.set(log.id, currentLeavesScale);
      
      if (i < 1000) {
        leavesGeo.attributes.aDissolve.setX(i, currentLeavesScale);
      }
      
      // Position leaves relative to log
      // Log is 11.2 units long, rotated by rx, ry, rz
      // The top of the log is along its local Y axis
      const logObj = new THREE.Object3D();
      logObj.position.set(lx, ly, lz);
      logObj.rotation.set(rx, ry, rz);
      
      // Leaves at the top half
      const leavesObj = new THREE.Object3D();
      leavesObj.position.set(0, 2.8, 0); // Offset along local Y
      leavesObj.scale.set(1, 1, 1);
      logObj.add(leavesObj);
      
      // Branches (always visible, but more obvious when leaves are gone)
      const branches: THREE.Object3D[] = [];
      BRANCH_CONFIGS.forEach((config) => {
        const branch = new THREE.Object3D();
        branch.position.set(...config.pos);
        branch.quaternion.set(config.quat[0], config.quat[1], config.quat[2], config.quat[3]);
        
        // Scale branch based on leaves. When leaves are full (scale 1), branches are small (scale 0.1).
        // When leaves are gone (scale 0), branches are full size (config.scale).
        const branchScale = config.scale[0] * (0.1 + 0.9 * (1 - currentLeavesScale));
        branch.scale.set(branchScale, branchScale, branchScale);
        
        logObj.add(branch);
        branches.push(branch);
      });
      
      const whittle = new THREE.Object3D();
      whittle.position.set(0, -6.65, 0); // Bottom of 11.2-unit log is -5.6, cone is 2.1 units tall, so -5.6 - 1.05 = -6.65
      whittle.rotation.set(Math.PI, 0, 0); // Point down
      logObj.add(whittle);
      
      logObj.updateMatrixWorld(true);
      
      branches.forEach((branch, bIdx) => {
        branchesMeshRef.current!.setMatrixAt(i * BRANCH_CONFIGS.length + bIdx, branch.matrixWorld);
      });
      
      leavesMeshRef.current!.setMatrixAt(i, leavesObj.matrixWorld);
      whittleMeshRef.current!.setMatrixAt(i, whittle.matrixWorld);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    leavesMeshRef.current.instanceMatrix.needsUpdate = true;
    branchesMeshRef.current.instanceMatrix.needsUpdate = true;
    whittleMeshRef.current.instanceMatrix.needsUpdate = true;
    
    if (logs.length > 0) {
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
