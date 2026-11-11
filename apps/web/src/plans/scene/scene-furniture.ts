/** The plastic furniture: long olive tables with six tall slatted green chairs each, and what is on the tables. */
import * as THREE from 'three';
import { type Kit } from './scene-kit';
import type { TableLayout } from './scene-model';

const TABLE_TOP = 0.44;

function chair(kit: Kit, root: THREE.Group, x: number, z: number, yaw: number): void {
  const green = kit.mat(kit.p.chair, 0.42);
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  kit.box(group, [0.34, 0.05, 0.34], green, 0, 0.255, 0);
  kit.box(group, [0.3, 0.03, 0.3], green, 0, 0.225, 0);
  for (const [lx, lz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]] as const) {
    const leg = kit.box(group, [0.05, 0.23, 0.05], green, lx, 0.115, lz);
    leg.rotation.z = lx * 0.5;
    leg.rotation.x = -lz * 0.5;
  }
  for (const px of [-0.15, 0.15]) kit.box(group, [0.035, 0.34, 0.04], green, px, 0.43, -0.16);
  for (let i = 0; i < 5; i++) kit.box(group, [0.29, 0.036, 0.03], green, 0, 0.3 + i * 0.062, -0.165);
  // A half disc caps the backrest.
  const cap = kit.mesh(group, new THREE.CylinderGeometry(0.17, 0.17, 0.04, 14, 1, false, 0, Math.PI), green, 0, 0.6, -0.165);
  cap.rotation.set(Math.PI / 2, 0, Math.PI);
  root.add(group);
}

function tableTop(kit: Kit, root: THREE.Group, x: number, z: number, makeGlass: () => THREE.Group): void {
  const { p } = kit;
  const dark = kit.mat(p.tableDark, 0.5);
  kit.box(root, [1.3, 0.045, 0.72], kit.mat(p.table, 0.45), x, TABLE_TOP, z);
  kit.box(root, [1.2, 0.05, 0.62], dark, x, 0.4, z);
  for (const [lx, lz] of [[-0.57, -0.28], [0.57, -0.28], [-0.57, 0.28], [0.57, 0.28]] as const) kit.box(root, [0.07, 0.4, 0.07], dark, x + lx, 0.2, z + lz);
  kit.cylinder(root, 0.1, 0.1, 0.02, kit.mat(p.plate, 0.8), x, 0.47, z, false, 14);
  const snack = new THREE.SphereGeometry(0.018, 6, 5);
  for (let n = 0; n < 5; n++) kit.mesh(root, snack, kit.mat(p.snack, 0.8), x + (n - 2) * 0.03, 0.49, z + (n % 2) * 0.025, false);
  kit.box(root, [0.1, 0.07, 0.06], kit.mat(p.tissue, 0.9), x + 0.5, 0.505, z, false);
  for (const gx of [-0.42, 0.42]) {
    for (const gz of [-0.15, 0.15]) {
      const glass = makeGlass();
      glass.scale.setScalar(1.6);
      glass.position.set(x + gx, 0.56, z + gz);
      root.add(glass);
    }
  }
}

export function buildFurniture(kit: Kit, layout: TableLayout, makeGlass: () => THREE.Group): THREE.Group {
  const root = new THREE.Group();
  for (const table of layout.tables) tableTop(kit, root, table.x, table.z, makeGlass);
  // Seats come back-side first; draw every chair once.
  for (const seat of layout.seats) chair(kit, root, seat.x, seat.z, seat.back ? 0 : Math.PI);
  return root;
}
