/** The little low-poly people: dressed from their name, with a group ring, a name label and (outside) a speech bubble. */
import * as THREE from 'three';
import { type Kit } from './scene-kit';
import type { SceneEntry, SceneGroup } from './scene-model';
import { bubbleTexture, labelTexture } from './scene-textures';

const SEATED_HIP = 0.27;
const STANDING_HIP = 0.33;
const ARMS_FORWARD = -1.05;

export interface Person {
  entry: SceneEntry;
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  arms: [THREE.Group, THREE.Group];
  standLegs: THREE.Group;
  sitLegs: THREE.Group;
  cup: THREE.Group;
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  label: THREE.Sprite;
  bubble: THREE.Sprite | null;
  seated: boolean;
  /** Offsets the idle motion so people do not move in step. */
  phase: number;
  lit: boolean;
  dim: boolean;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function sprite(texture: THREE.Texture, width: number, height: number, order: number): THREE.Sprite {
  const result = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  result.scale.set(width, height, 1);
  result.renderOrder = order;
  return result;
}

export const LABEL_SIZE = { width: 1.38, height: 0.3 } as const;
export const BUBBLE_SIZE = { width: 1.6, height: 0.47 } as const;

/** Sprites ignore depth, so draw order alone decides who is on top: the selected person's label and bubble sit above everyone else's. */
export const SPRITE_ORDER = { label: 10, bubble: 11, selectedLabel: 20, selectedBubble: 21 } as const;

export class PeopleFactory {
  private readonly geo = {
    thigh: new THREE.CylinderGeometry(0.058, 0.058, 0.24, 8),
    shin: new THREE.CylinderGeometry(0.055, 0.052, 0.26, 8),
    leg: new THREE.CylinderGeometry(0.06, 0.055, 0.33, 8),
    shoe: new THREE.BoxGeometry(0.1, 0.05, 0.16),
    torso: new THREE.CylinderGeometry(0.14, 0.17, 0.36, 14),
    head: new THREE.SphereGeometry(0.2, 18, 14),
    cap: new THREE.SphereGeometry(0.212, 18, 12, 0, Math.PI * 2, 0, 1.75),
    eye: new THREE.SphereGeometry(0.024, 8, 6),
    arm: new THREE.CylinderGeometry(0.042, 0.038, 0.26, 8),
    hand: new THREE.SphereGeometry(0.045, 8, 6),
    ring: new THREE.RingGeometry(0.3, 0.37, 40),
    disc: new THREE.CircleGeometry(0.37, 40),
  };

  constructor(
    private readonly kit: Kit,
    private readonly status: Record<SceneGroup, string>,
    private readonly makeGlass: () => THREE.Group,
  ) {}

  create(entry: SceneEntry): Person {
    const { kit, geo } = this;
    const { p } = kit;
    const h = hash(entry.name);
    const skin = kit.mat(p.skins[h % p.skins.length] ?? p.skins[0] ?? '', 0.8);
    const hair = kit.mat(p.hairs[(h >> 3) % p.hairs.length] ?? p.hairs[0] ?? '', 0.8);
    const shirt = kit.mat(p.shirts[(h >> 5) % p.shirts.length] ?? p.shirts[0] ?? '', 0.85);
    const trousers = kit.mat(p.trousers, 0.9);
    const shoe = kit.mat(p.shoe, 0.8);
    const colour = this.status[entry.group];

    const root = new THREE.Group();
    const standLegs = new THREE.Group();
    const sitLegs = new THREE.Group();
    root.add(standLegs, sitLegs);
    for (const side of [-1, 1]) {
      kit.mesh(standLegs, geo.leg, trousers, side * 0.075, 0.165, 0);
      kit.mesh(standLegs, geo.shoe, shoe, side * 0.075, 0.025, 0.04);
      kit.mesh(sitLegs, geo.thigh, trousers, side * 0.075, SEATED_HIP, 0.12).rotation.x = Math.PI / 2;
      kit.mesh(sitLegs, geo.shin, trousers, side * 0.075, 0.13, 0.24);
      kit.mesh(sitLegs, geo.shoe, shoe, side * 0.075, 0.025, 0.28);
    }

    // The body is drawn seated; a standing body is lifted by the difference of the hips.
    const body = new THREE.Group();
    root.add(body);
    kit.mesh(body, geo.torso, shirt, 0, SEATED_HIP + 0.18, 0);
    const head = new THREE.Group();
    head.position.set(0, SEATED_HIP + 0.53, 0);
    body.add(head);
    kit.mesh(head, geo.head, skin, 0, 0, 0);
    kit.mesh(head, geo.cap, hair, 0, 0.005, -0.005, false).rotation.x = -0.28;
    if (h % 3 === 0) kit.mesh(head, geo.head, hair, 0, -0.07, -0.1, false).scale.set(0.98, 1.05, 0.62);
    for (const side of [-1, 1]) kit.mesh(head, geo.eye, kit.mat(p.black, 0.4), side * 0.075, 0.015, 0.185, false);
    const arms: ArmPair = [new THREE.Group(), new THREE.Group()];
    arms.forEach((pivot, index) => {
      const side = index === 0 ? -1 : 1;
      pivot.position.set(side * 0.2, SEATED_HIP + 0.32, 0);
      kit.mesh(pivot, geo.arm, shirt, 0, -0.13, 0);
      kit.mesh(pivot, geo.hand, skin, 0, -0.27, 0);
      body.add(pivot);
    });
    const cup = this.makeGlass();
    cup.position.set(0, -0.3, 0.02);
    arms[1].add(cup);

    const ring = new THREE.Mesh(geo.ring, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    const fill = new THREE.Mesh(geo.disc, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.015;
    root.add(ring, fill);

    const label = sprite(labelTexture(p, entry.name, colour), LABEL_SIZE.width, LABEL_SIZE.height, SPRITE_ORDER.label);
    root.add(label);
    let bubble: THREE.Sprite | null = null;
    if (entry.say) {
      bubble = sprite(bubbleTexture(p, entry.say, colour), BUBBLE_SIZE.width, BUBBLE_SIZE.height, SPRITE_ORDER.bubble);
      bubble.center.set(0.5, 0.02);
      root.add(bubble);
    }
    const person: Person = { entry, root, body, head, arms, standLegs, sitLegs, cup, ring, fill, label, bubble, seated: false, phase: (h % 100) / 16, lit: false, dim: false };
    root.userData = { personId: entry.id };
    setSeated(person, entry.group === 'sit');
    return person;
  }
}

type ArmPair = [THREE.Group, THREE.Group];

/** Switches between the standing and the seated figure: legs, body height, arms and the glass in hand. */
export function setSeated(person: Person, seated: boolean): void {
  person.seated = seated;
  person.sitLegs.visible = seated;
  person.standLegs.visible = !seated;
  person.cup.visible = seated;
  person.body.position.y = seated ? 0 : STANDING_HIP - SEATED_HIP;
  person.arms.forEach((arm, index) => {
    arm.rotation.set(seated ? ARMS_FORWARD : 0, 0, seated ? 0 : (index === 0 ? 0.12 : -0.12));
  });
  const hip = seated ? SEATED_HIP : STANDING_HIP;
  person.label.position.set(0, hip + 0.93, 0);
  person.bubble?.position.set(0, hip + 1.05, 0);
}

