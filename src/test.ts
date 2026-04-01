import * as THREE from 'three';
const geo = new THREE.PlaneGeometry(2, 2, 2, 2);
geo.rotateX(-Math.PI / 2);
const pos = geo.attributes.position.array;
for(let i=0; i<pos.length; i+=3) {
    console.log(`v${i/3}: x=${pos[i]}, z=${pos[i+2]}`);
}
