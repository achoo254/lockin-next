/** The street beer hall around the tables: floor, kerb, road, shop front, roof, brick walls, shelves, bikes, signs. */
import * as THREE from 'three';
import { type Kit } from './scene-kit';
import { type Signage, boardTexture, brickTexture, fasciaTexture, floorTexture, kerbTexture, pillarTexture, roundSignTexture } from './scene-textures';

function ground(kit: Kit, root: THREE.Group): void {
  const { p } = kit;
  kit.box(root, [26, 0.14, 5.4], new THREE.MeshStandardMaterial({ map: floorTexture(p), roughness: 0.85 }), 0, -0.07, -3.55, false).receiveShadow = true;
  kit.box(root, [26, 0.2, 0.28], new THREE.MeshStandardMaterial({ map: kerbTexture(p), roughness: 0.8 }), 0, 0.02, -0.74, false);
  kit.box(root, [34, 0.1, 12], kit.mat(p.road, 0.7), 0, -0.1, 5.2, false).receiveShadow = true;
  for (let x = -12; x < 13; x += 3) kit.box(root, [1.4, 0.01, 0.12], kit.mat(p.roadMark, 0.7), x, -0.04, 6.6, false);
}

function backWall(kit: Kit, root: THREE.Group): void {
  const { p } = kit;
  kit.box(root, [14, 5, 0.3], kit.mat(p.yellowDeep, 0.75), 0, 2.5, -6.3, false);
  kit.box(root, [14, 0.9, 0.34], kit.mat(p.wainscot, 0.9), 0, 0.45, -6.28, false);
  const neck = new THREE.CylinderGeometry(0.025, 0.04, 0.08, 8);
  const body = new THREE.CylinderGeometry(0.06, 0.065, 0.26, 8);
  for (const y of [1.35, 2.15]) {
    kit.box(root, [11.6, 0.06, 0.4], kit.mat(p.shelf, 0.7), 0, y, -5.95, false);
    for (let i = 0; i < 38; i++) {
      const bottle = kit.mat(i % 3 === 0 ? p.bottleGreen : p.bottleAmber, 0.35);
      kit.mesh(root, body, bottle, -5.55 + i * 0.3, y + 0.16, -5.95, false);
      kit.mesh(root, neck, bottle, -5.55 + i * 0.3, y + 0.33, -5.95, false);
    }
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 32), new THREE.MeshBasicMaterial({ map: roundSignTexture(p) }));
  disc.position.set(0, 3.15, -6.1);
  root.add(disc);
  for (const [x, z] of [[-6.2, -5.4], [-5.5, -5.5], [6.2, -5.4]] as const) {
    const keg = kit.cylinder(root, 0.3, 0.3, 0.78, kit.mat(p.keg, 0.25, { metalness: 0.85 }), x, 0.39, z, true, 20);
    for (const y of [0.28, -0.28]) {
      const ring = kit.mesh(keg, new THREE.TorusGeometry(0.3, 0.02, 6, 20), kit.mat(p.kegRing, 0.4, { metalness: 0.8 }), 0, y, 0, false);
      ring.rotation.x = Math.PI / 2;
    }
  }
  for (let i = 0; i < 3; i++) kit.box(root, [0.62, 0.26, 0.42], kit.mat(p.crate, 0.7), 5.2, 0.13 + i * 0.27, -5.6);
}

function sideWalls(kit: Kit, root: THREE.Group): void {
  const { p } = kit;
  const brick = new THREE.MeshStandardMaterial({ map: brickTexture(p), roughness: 0.9 });
  for (const x of [-6.65, 6.65]) {
    kit.box(root, [0.3, 1.5, 5.3], brick, x, 0.75, -3.6);
    kit.box(root, [0.3, 2.6, 5.3], kit.mat(p.yellowDeep, 0.75), x, 2.8, -3.6, false);
  }
}

function front(kit: Kit, root: THREE.Group, signage: Signage): void {
  const { p } = kit;
  const red = kit.mat(p.red, 0.6);
  const pillar = new THREE.MeshStandardMaterial({ map: pillarTexture(p), roughness: 0.6 });
  for (const x of [-6.35, 6.35]) kit.box(root, [0.92, 4.6, 0.92], [red, red, red, red, pillar, red], x, 2.3, -0.95);
  kit.box(root, [12, 1.4, 0.32], kit.mat(p.red, 0.55), 0, 3.85, -0.95);
  const fascia = new THREE.Mesh(new THREE.PlaneGeometry(11.6, 1), new THREE.MeshBasicMaterial({ map: fasciaTexture(p, signage) }));
  fascia.position.set(0, 3.85, -0.78);
  root.add(fascia);
  kit.box(root, [14.2, 0.3, 4.6], kit.mat(p.red, 0.55), 0, 4.75, -3.05, false);
  kit.box(root, [14.5, 0.14, 4.8], kit.mat(p.redDark, 0.6), 0, 4.55, -2.95, false);
  kit.box(root, [12, 0.12, 0.34], kit.mat(p.yellowPale, 0.5), 0, 3.1, -0.95, false);
  for (const x of [-4.5, 0, 4.5]) {
    kit.cylinder(root, 0.03, 0.03, 0.55, kit.mat(p.dark), x, 5.2, -1.2, false, 6);
    kit.box(root, [0.5, 0.12, 0.3], kit.mat(p.dark), x, 5.5, -1.05, false).rotation.x = 0.3;
  }
}

function bike(kit: Kit, root: THREE.Group, colour: string, x: number, z: number, yaw: number): void {
  const { p } = kit;
  const group = new THREE.Group();
  const body = kit.mat(colour, 0.4, { metalness: 0.3 });
  const dark = kit.mat(p.black, 0.7);
  kit.box(group, [0.3, 0.26, 0.9], body, 0, 0.42, 0);
  kit.box(group, [0.28, 0.08, 0.5], dark, 0, 0.6, -0.12);
  kit.box(group, [0.58, 0.05, 0.05], dark, 0, 0.95, 0.52);
  kit.cylinder(group, 0.03, 0.03, 0.62, dark, 0, 0.62, 0.5, true, 6);
  kit.mesh(group, new THREE.SphereGeometry(0.09, 10, 8), kit.basic(p.headlight), 0, 0.82, 0.62, false);
  kit.box(group, [0.34, 0.2, 0.3], body, 0, 0.28, -0.52);
  for (const zz of [0.56, -0.58]) kit.cylinder(group, 0.22, 0.22, 0.1, dark, 0, 0.22, zz).rotation.z = Math.PI / 2;
  kit.box(group, [0.3, 0.2, 0.26], kit.mat(p.motoSeat, 0.9), 0, 0.5, -0.72);
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  group.scale.setScalar(0.66);
  root.add(group);
}

/** A chalkboard on two posts at a standing spot: the reason the people next to it stand outside. */
function board(kit: Kit, root: THREE.Group, x: number, z: number, label: string, icon: 'clock' | 'pin'): void {
  const { p } = kit;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = 0.15;
  for (const px of [-0.28, 0.28]) kit.box(group, [0.05, 0.7, 0.05], kit.mat(p.post, 0.9), px, 0.35, 0);
  kit.box(group, [0.66, 0.5, 0.04], new THREE.MeshStandardMaterial({ map: boardTexture(p, label, icon), roughness: 0.9 }), 0, 0.82, 0.02);
  root.add(group);
}

export interface WorldLabels {
  timeBoard: string;
  placeBoard: string;
}

export function buildWorld(kit: Kit, signage: Signage, labels: WorldLabels, makeGlass: () => THREE.Group): THREE.Group {
  const { p } = kit;
  const root = new THREE.Group();
  ground(kit, root);
  backWall(kit, root);
  sideWalls(kit, root);
  front(kit, root, signage);
  bike(kit, root, p.motoRed, 2.6, 0.55, Math.PI / 2 + 0.08);
  bike(kit, root, p.motoBlue, 6, 0.6, Math.PI / 2 - 0.1);
  board(kit, root, -4.6, 0.35, labels.timeBoard, 'clock');
  board(kit, root, 4.3, 0.35, labels.placeBoard, 'pin');
  // A pair of oversized glasses on a red stand, like a shop advert.
  kit.box(root, [0.8, 0.5, 0.6], kit.mat(p.red, 0.55), -5.7, 0.25, -2.1, false);
  for (const [dx, dz] of [[-0.17, 0], [0.17, 0.12]] as const) {
    const glass = makeGlass();
    glass.scale.setScalar(7);
    glass.position.set(-5.7 + dx, 0.93, -2.1 + dz);
    root.add(glass);
  }
  return root;
}
