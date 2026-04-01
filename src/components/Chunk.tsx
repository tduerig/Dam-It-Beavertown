import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE, getTerrainHeight, getBaseTerrainHeight, generateTreesForChunk } from '../utils/terrain';
import { useGameStore } from '../store';
import { waterEngine } from '../utils/WaterEngine';
import { BRANCH_CONFIGS } from './DraggableLogs';

const dummy = new THREE.Object3D();

export function Chunk({ chunkX, chunkZ }: { chunkX: number, chunkZ: number }) {
  const treeSticks = useGameStore(state => state.treeSticks);
  const terrainOffsets = useGameStore(state => state.terrainOffsets);
  
  const terrainGeo = useMemo(() => {
    const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 40, 40);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position.array;
    const colors = new Float32Array(pos.length);
    const color = new THREE.Color();
    const mudColor = new THREE.Color('#4a3018'); // Dark, wet mud color
    
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i] + chunkX * CHUNK_SIZE;
      const z = pos[i + 2] + chunkZ * CHUNK_SIZE;
      const y = getTerrainHeight(x, z);
      const baseY = getBaseTerrainHeight(x, z);
      const offset = y - baseY;
      pos[i + 1] = y;

      // Biome colors based on altitude
      if (y > 14) {
        color.set('#ffffff'); // Snow
      } else if (y > 10) {
        color.set('#888888').lerp(new THREE.Color('#ffffff'), (y - 10) / 4); // Rock to Snow
      } else if (y > 0) {
        color.set('#4a5d23').lerp(new THREE.Color('#888888'), y / 10); // Forest to Rock
      } else if (y > -4) {
        color.set('#e6d59d').lerp(new THREE.Color('#4a5d23'), (y + 4) / 4); // Sand to Forest
      } else {
        color.set('#e6d59d'); // Sand
      }

      // Blend in mud color based on terrain modification
      if (Math.abs(offset) > 0.05) {
        const blend = Math.min(1, Math.abs(offset) / 0.8); // Max mud color at 0.8 offset
        color.lerp(mudColor, blend);
      }

      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [chunkX, chunkZ, terrainOffsets]);

  const trees = useMemo(() => generateTreesForChunk(chunkX, chunkZ), [chunkX, chunkZ]);

  const activeTrees = useMemo(() => {
    return trees.filter(tree => {
      const maxSticks = tree.type === 'big' ? 12 : 3;
      return (treeSticks[tree.id] ?? maxSticks) > 0;
    });
  }, [trees, treeSticks]);

  const stumps = useMemo(() => {
    return trees.filter(tree => {
      const maxSticks = tree.type === 'big' ? 12 : 3;
      return (treeSticks[tree.id] ?? maxSticks) <= 0;
    });
  }, [trees, treeSticks]);

  const { trunkGeo, leavesGeo, trunkMat, leavesMat, branchGeo, stumpGeo, stumpMat } = useMemo(() => {
    const tGeo = new THREE.CylinderGeometry(0.4, 0.6, 4, 8);
    tGeo.setAttribute('aWhittle', new THREE.InstancedBufferAttribute(new Float32Array(100), 1));
    
    const tMat = new THREE.MeshStandardMaterial({ color: '#5C4033' });
    tMat.onBeforeCompile = (shader) => {
      shader.vertexShader = `
        attribute float aWhittle;
        varying float vWhittle;
        varying float vY;
        ${shader.vertexShader}
      `.replace(
        `#include <begin_vertex>`,
        `
        #include <begin_vertex>
        vWhittle = aWhittle;
        vY = position.y;
        if (position.y < -1.0) {
          float d = clamp(abs(position.y + 1.5) / 0.5, 0.0, 1.0);
          float taperAmount = mix(mix(0.05, 1.0, d), 1.0, aWhittle);
          transformed.x *= taperAmount;
          transformed.z *= taperAmount;
        }
        `
      );
      shader.fragmentShader = `
        varying float vWhittle;
        varying float vY;
        ${shader.fragmentShader}
      `.replace(
        `vec4 diffuseColor = vec4( diffuse, opacity );`,
        `
        vec3 finalColor = diffuse;
        if (vY < -1.0 && vWhittle < 0.99) {
          float d = clamp(abs(vY + 1.5) / 0.5, 0.0, 1.0);
          float taperAmount = mix(mix(0.05, 1.0, d), 1.0, vWhittle);
          finalColor = mix(vec3(0.9, 0.75, 0.5), diffuse, taperAmount);
        }
        vec4 diffuseColor = vec4( finalColor, opacity );
        `
      );
    };

    const lGeo = new THREE.ConeGeometry(2.5, 5, 8);
    lGeo.setAttribute('aDissolve', new THREE.InstancedBufferAttribute(new Float32Array(100), 1));
    
    const lMat = new THREE.MeshStandardMaterial({ color: '#228B22', side: THREE.DoubleSide });
    lMat.onBeforeCompile = (shader) => {
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
          float n = noise(vPos * 2.0);
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

    const bGeo = new THREE.CylinderGeometry(0.1, 0.2, 1.5, 8);
    
    const sGeo = new THREE.ConeGeometry(0.6, 1.0, 8);
    const sMat = new THREE.MeshStandardMaterial({ color: '#E6C280' });

    return { trunkGeo: tGeo, trunkMat: tMat, leavesGeo: lGeo, leavesMat: lMat, branchGeo: bGeo, stumpGeo: sGeo, stumpMat: sMat };
  }, []);

  const trunkMeshRef = useRef<THREE.InstancedMesh>(null);
  const leavesMeshRef = useRef<THREE.InstancedMesh>(null);
  const branchesMeshRef = useRef<THREE.InstancedMesh>(null);
  const stumpMeshRef = useRef<THREE.InstancedMesh>(null);
  const leavesScales = useRef(new Map<string, number>());

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    if (!trunkMeshRef.current || !leavesMeshRef.current) return;
    
    // We can check water level dynamically, but for performance we might just do it occasionally
    // For now, we'll do it every frame since there aren't too many active trees per chunk
    const time = Date.now() * 0.001;
    let needsUpdate = false;

    activeTrees.forEach((tree, i) => {
      const isBig = tree.type === 'big';
      const scale = isBig ? 2.8 : 1;
      
      // Calculate how many sticks are left to visually whittle the tree
      const maxSticks = isBig ? 12 : 3;
      const currentSticks = treeSticks[tree.id] ?? maxSticks;
      const whittleScale = currentSticks / maxSticks;
      
      if (i < 100) {
        trunkGeo.attributes.aWhittle.setX(i, whittleScale);
      }
      
      // Base position
      dummy.position.set(
        tree.position[0] - chunkX * CHUNK_SIZE, 
        tree.position[1] + (2 * scale), // trunk offset
        tree.position[2] - chunkZ * CHUNK_SIZE
      );
      
      // Scale trunk based on whittling (only scale X and Z, keep Y same or slightly reduced)
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trunkMeshRef.current!.setMatrixAt(i, dummy.matrix);
      
      // Check if flooded
      const waterHeight = waterEngine.getSurfaceHeight(tree.position[0], tree.position[2]);
      const isFlooded = waterHeight > tree.position[1] + (1 * scale); // Flooded if water is above base of trunk
      
      // Leaves
      dummy.position.y += (4.5 * scale); // leaves offset
      
      // Scale leaves based on flooding only
      const targetLeavesScale = isFlooded ? 0 : 1;
      let currentLeavesScale = leavesScales.current.get(tree.id) ?? targetLeavesScale;
      
      // Gradually change leaves scale
      if (currentLeavesScale < targetLeavesScale) {
        currentLeavesScale = Math.min(targetLeavesScale, currentLeavesScale + dt * 0.5);
      } else if (currentLeavesScale > targetLeavesScale) {
        currentLeavesScale = Math.max(targetLeavesScale, currentLeavesScale - dt * 0.5);
      }
      leavesScales.current.set(tree.id, currentLeavesScale);
      
      if (i < 100) {
        leavesGeo.attributes.aDissolve.setX(i, currentLeavesScale);
      }
      
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      leavesMeshRef.current!.setMatrixAt(i, dummy.matrix);
      
      // Branches (only for big trees)
      if (branchesMeshRef.current) {
        if (isBig) {
          const treeObj = new THREE.Object3D();
          treeObj.position.set(
            tree.position[0] - chunkX * CHUNK_SIZE,
            tree.position[1] + (2 * scale),
            tree.position[2] - chunkZ * CHUNK_SIZE
          );
          treeObj.scale.set(scale, scale, scale);
          
          const branches: THREE.Object3D[] = [];
          BRANCH_CONFIGS.forEach((config) => {
            const branchObj = new THREE.Object3D();
            // The config positions are for the 11.2 unit log.
            // Our treeObj is scaled by 2.8, and the base trunk is 4 units long.
            // 4 * 2.8 = 11.2.
            // So we need to divide the config positions by 2.8 to get them into the local space of the 4-unit trunk.
            branchObj.position.set(config.pos[0] / 2.8, config.pos[1] / 2.8, config.pos[2] / 2.8);
            branchObj.quaternion.set(config.quat[0], config.quat[1], config.quat[2], config.quat[3]);
            // The scale in config is relative to the branch size.
            // We just use it directly.
            const branchScale = config.scale[0] * (0.1 + 0.9 * (1 - currentLeavesScale));
            branchObj.scale.set(branchScale, branchScale, branchScale);
            
            treeObj.add(branchObj);
            branches.push(branchObj);
          });
          
          treeObj.updateMatrixWorld(true);
          
          branches.forEach((branchObj, bIdx) => {
            branchesMeshRef.current!.setMatrixAt(i * BRANCH_CONFIGS.length + bIdx, branchObj.matrixWorld);
          });
        } else {
          // Hide branch for small trees
          BRANCH_CONFIGS.forEach((_, bIdx) => {
            dummy.position.set(0, -1000, 0);
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            branchesMeshRef.current!.setMatrixAt(i * BRANCH_CONFIGS.length + bIdx, dummy.matrix);
          });
        }
      }
    });
    
    trunkMeshRef.current.instanceMatrix.needsUpdate = true;
    leavesMeshRef.current.instanceMatrix.needsUpdate = true;
    if (branchesMeshRef.current) {
      branchesMeshRef.current.instanceMatrix.needsUpdate = true;
    }
    if (activeTrees.length > 0) {
      trunkGeo.attributes.aWhittle.needsUpdate = true;
      leavesGeo.attributes.aDissolve.needsUpdate = true;
    }
    
    if (stumpMeshRef.current) {
      stumps.forEach((tree, i) => {
        const isBig = tree.type === 'big';
        const scale = isBig ? 2.8 : 1;
        
        // Base position
        dummy.position.set(
          tree.position[0] - chunkX * CHUNK_SIZE, 
          tree.position[1] + (0.5 * scale), // stump offset
          tree.position[2] - chunkZ * CHUNK_SIZE
        );
        
        dummy.scale.set(scale, scale, scale);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        stumpMeshRef.current!.setMatrixAt(i, dummy.matrix);
      });
      stumpMeshRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group position={[chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE]}>
      <mesh geometry={terrainGeo} receiveShadow>
        <meshStandardMaterial vertexColors={true} roughness={0.8} metalness={0.1} />
      </mesh>

      {activeTrees.length > 0 && (
        <>
          <instancedMesh ref={trunkMeshRef} args={[trunkGeo, trunkMat, activeTrees.length]} castShadow receiveShadow frustumCulled={false} />
          <instancedMesh ref={leavesMeshRef} args={[leavesGeo, leavesMat, activeTrees.length]} castShadow receiveShadow frustumCulled={false} />
          <instancedMesh ref={branchesMeshRef} args={[branchGeo, trunkMat, activeTrees.length * BRANCH_CONFIGS.length]} castShadow receiveShadow frustumCulled={false} />
        </>
      )}
      
      {stumps.length > 0 && (
        <instancedMesh ref={stumpMeshRef} args={[stumpGeo, stumpMat, stumps.length]} castShadow receiveShadow frustumCulled={false} />
      )}
    </group>
  );
}
