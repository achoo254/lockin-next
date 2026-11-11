/** Small builders shared by the scene's parts: cached materials, meshes and boxes, and the bia hơi glass. */
import * as THREE from 'three';
import type { ScenePalette } from './scene-palette';

export class Kit {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();
  constructor(readonly p: ScenePalette) {}

  mat(colour: string, roughness = 0.8, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    const key = `${colour}|${roughness}|${JSON.stringify(extra)}`;
    let material = this.cache.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: colour, roughness, metalness: 0, ...extra });
      this.cache.set(key, material);
    }
    return material;
  }

  basic(colour: string): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color: colour });
  }

  mesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (shadow) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    parent.add(mesh);
    return mesh;
  }

  box(parent: THREE.Object3D, size: [number, number, number], material: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
    return this.mesh(parent, new THREE.BoxGeometry(size[0], size[1], size[2]), material, x, y, z, shadow);
  }

  cylinder(parent: THREE.Object3D, top: number, bottom: number, height: number, material: THREE.Material, x = 0, y = 0, z = 0, shadow = true, segments = 16): THREE.Mesh {
    return this.mesh(parent, new THREE.CylinderGeometry(top, bottom, height, segments), material, x, y, z, shadow);
  }
}

/** A factory of bia hơi glasses: thick faceted greenish glass, golden beer, a tall white head of foam. */
export function glassFactory(kit: Kit): () => THREE.Group {
  const { p } = kit;
  const shellGeo = new THREE.CylinderGeometry(0.052, 0.04, 0.125, 10, 1, true);
  const beerGeo = new THREE.CylinderGeometry(0.046, 0.036, 0.085, 10);
  const foamGeo = new THREE.CylinderGeometry(0.05, 0.047, 0.045, 10);
  const domeGeo = new THREE.SphereGeometry(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  const baseGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.014, 10);
  const shell = new THREE.MeshStandardMaterial({ color: p.glass, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.38, flatShading: true, side: THREE.DoubleSide, depthWrite: false });
  const beer = new THREE.MeshStandardMaterial({ color: p.beer, roughness: 0.25, emissive: p.beerGlow, emissiveIntensity: 0.35, flatShading: true });
  const foam = kit.mat(p.foam, 0.95);
  const base = new THREE.MeshStandardMaterial({ color: p.glassBase, roughness: 0.2, transparent: true, opacity: 0.8 });
  return () => {
    const group = new THREE.Group();
    kit.mesh(group, baseGeo, base, 0, -0.062, 0, false);
    kit.mesh(group, beerGeo, beer, 0, -0.016, 0, false);
    kit.mesh(group, foamGeo, foam, 0, 0.049, 0, true);
    const dome = kit.mesh(group, domeGeo, foam, 0, 0.071, 0, false);
    dome.scale.y = 0.5;
    kit.mesh(group, shellGeo, shell, 0, 0, 0, true);
    return group;
  };
}

/** Frees the geometry, materials and textures of everything under `root`. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      const textured = material as THREE.Material & { map?: THREE.Texture | null };
      textured.map?.dispose();
      material.dispose();
    }
  });
}
