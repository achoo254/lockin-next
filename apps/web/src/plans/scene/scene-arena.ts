/**
 * The arena of a solo game plan: a lane between two towers with a banner above, walls behind and beside it, and the
 * stands (benches in rising rows) where the people who match the locked time and place watch from.
 */
import * as THREE from 'three';
import { type Kit } from './scene-kit';
import { STAND_COLUMNS, type StandLayout, standRow } from './scene-model';
import { type Signage, arenaBannerTexture } from './scene-textures';
import { street } from './scene-world';

const LANE_Z = -2.6;
const LANE_DEPTH = 2.0;
const TOWER_X = 4.9;

function floor(kit: Kit, root: THREE.Group): void {
  const { p } = kit;
  kit.box(root, [26, 0.14, 5.4], kit.mat(p.arenaStoneDark, 0.9), 0, -0.07, -3.55, false).receiveShadow = true;
  kit.box(root, [11.2, 0.03, LANE_DEPTH], kit.mat(p.arenaGrass, 0.95), 0, 0.005, LANE_Z, false).receiveShadow = true;
  // Mown stripes along the lane.
  for (let i = 0; i < 8; i += 2) kit.box(root, [1.4, 0.032, LANE_DEPTH], kit.mat(p.arenaGrassDark, 0.95), -4.9 + i * 1.4, 0.007, LANE_Z, false);
  kit.box(root, [0.08, 0.04, LANE_DEPTH], kit.mat(p.arenaLine, 0.8), 0, 0.012, LANE_Z, false);
  const circle = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 40), new THREE.MeshBasicMaterial({ color: p.arenaLine, side: THREE.DoubleSide }));
  circle.rotation.x = -Math.PI / 2;
  circle.position.set(0, 0.03, LANE_Z);
  root.add(circle);
  street(kit, root);
}

function walls(kit: Kit, root: THREE.Group, signage: Signage): void {
  const { p } = kit;
  kit.box(root, [14, 5, 0.3], kit.mat(p.arenaStone, 0.85), 0, 2.5, -6.3, false);
  kit.box(root, [14, 0.9, 0.34], kit.mat(p.arenaStoneDark, 0.9), 0, 0.45, -6.28, false);
  for (const x of [-6.65, 6.65]) kit.box(root, [0.3, 2.6, 5.3], kit.mat(p.arenaStone, 0.85), x, 1.3, -3.6, false);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 1.07), new THREE.MeshBasicMaterial({ map: arenaBannerTexture(p, signage) }));
  banner.position.set(0, 3.5, -6.1);
  root.add(banner);
}

/** A tower at one end of the lane, topped by a glowing crystal in the colour of that side. */
function tower(kit: Kit, root: THREE.Group, x: number, colour: string): void {
  const { p } = kit;
  const group = new THREE.Group();
  group.position.set(x, 0, LANE_Z);
  kit.cylinder(group, 0.5, 0.58, 0.4, kit.mat(p.arenaStoneDark, 0.9), 0, 0.2, 0, true, 8);
  kit.cylinder(group, 0.3, 0.42, 1.5, kit.mat(p.arenaStone, 0.85), 0, 1.15, 0, true, 8);
  kit.cylinder(group, 0.46, 0.34, 0.16, kit.mat(p.arenaStoneDark, 0.9), 0, 2.0, 0, true, 8);
  const crystal = kit.mesh(group, new THREE.OctahedronGeometry(0.36), kit.mat(colour, 0.25, { emissive: colour, emissiveIntensity: 0.55, flatShading: true }), 0, 2.5, 0);
  crystal.scale.y = 1.4;
  root.add(group);
}

export function buildArena(kit: Kit, signage: Signage): THREE.Group {
  const { p } = kit;
  const root = new THREE.Group();
  floor(kit, root);
  walls(kit, root, signage);
  tower(kit, root, -TOWER_X, p.arenaBlue);
  tower(kit, root, TOWER_X, p.arenaRed);
  return root;
}

/** The benches and the tiers under them, as many rows as the spectators need. */
export function buildStands(kit: Kit, layout: StandLayout): THREE.Group {
  const { p } = kit;
  const root = new THREE.Group();
  const width = STAND_COLUMNS * 0.9 + 0.4;
  for (let row = 0; row < layout.rows; row++) {
    const { z, y } = standRow(row);
    if (y > 0) kit.box(root, [width, y, 0.62], kit.mat(p.arenaStoneDark, 0.9), 0, y / 2, z - 0.1);
    kit.box(root, [width, 0.05, 0.34], kit.mat(p.arenaBench, 0.6), 0, y + 0.255, z);
    for (const side of [-1, 1]) kit.box(root, [0.06, 0.23, 0.3], kit.mat(p.arenaBench, 0.6), side * (width / 2 - 0.1), y + 0.115, z);
  }
  return root;
}
