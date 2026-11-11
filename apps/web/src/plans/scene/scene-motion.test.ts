import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { beginEntrance, entranceDelay, idle, makeEntrance, stepEntrance } from './scene-motion';
import { layoutTables, type SceneGroup } from './scene-model';
import type { Person } from './scene-people';

/** A person with the real parts of the rig but no textures (jsdom cannot draw canvases). */
function fakePerson(group: SceneGroup = 'sit'): Person {
  const part = (): THREE.Group => new THREE.Group();
  return {
    entry: { id: 'p', name: 'An', group, say: null },
    root: part(),
    body: part(),
    head: part(),
    arms: [part(), part()],
    standLegs: part(),
    sitLegs: part(),
    cup: part(),
    ring: new THREE.Mesh(),
    fill: new THREE.Mesh(),
    label: new THREE.Sprite(),
    bubble: null,
    seated: false,
    phase: 0,
    lit: false,
    dim: false,
  };
}

describe('the walk-in', () => {
  it('lets people in about 0.35 s apart, and a crowd of 48 still within five seconds', () => {
    expect(entranceDelay(0, 5)).toBe(0);
    expect(entranceDelay(3, 5)).toBeCloseTo(1.05);
    expect(entranceDelay(47, 48)).toBeLessThanOrEqual(5);
  });

  it('comes in from the street along the aisle at the end of the table, then across to the chair', () => {
    const seat = layoutTables(5).seats[0];
    if (!seat) throw new Error('no seat');
    const entrance = makeEntrance(fakePerson(), seat, 0, 5);
    expect(entrance.path).toEqual([[seat.aisleX, 1.2], [seat.aisleX, seat.z], [seat.x, seat.z]]);
    expect(entrance.length).toBeGreaterThan(0);
  });

  it('keeps the person out of sight and standing until their turn, then walks, turns and sits', () => {
    const seat = layoutTables(5).seats[0];
    if (!seat) throw new Error('no seat');
    const person = fakePerson();
    const entrance = makeEntrance(person, seat, 2, 5);
    beginEntrance(entrance);
    expect(person.root.visible).toBe(false);
    expect(person.seated).toBe(false);
    expect(stepEntrance(entrance, entrance.delay - 0.01)).toBe(false);
    expect(person.root.visible).toBe(false);
    expect(stepEntrance(entrance, entrance.delay + 0.5)).toBe(false);
    expect(person.root.visible).toBe(true);
    expect(person.seated).toBe(false);
    expect(stepEntrance(entrance, entrance.delay + 60)).toBe(true);
    expect(person.seated).toBe(true);
    expect([person.root.position.x, person.root.position.z]).toEqual([seat.x, seat.z]);
    expect(person.root.rotation.y).toBeCloseTo(seat.back ? 0 : Math.PI);
  });

  it('never walks across a table, whatever the number of people', () => {
    for (const sitting of [5, 12, 30, 48]) {
      const { seats, tables } = layoutTables(sitting);
      for (const seat of seats) {
        const person = fakePerson();
        const entrance = makeEntrance(person, seat, 0, seats.length);
        beginEntrance(entrance);
        for (let t = 0; t < 30; t += 0.05) {
          stepEntrance(entrance, t);
          const { x, z } = person.root.position;
          if (t < entrance.length / 1.8 - 0.3) {
            // On the way (before the last step to the chair) the body stays clear of every table top.
            for (const table of tables) expect(Math.abs(x - table.x) > 0.8 || Math.abs(z - table.z) > 0.5).toBe(true);
          }
        }
      }
    }
  });
});

describe('idle motion', () => {
  it('stands still with reduced motion (scale 0): the glass stays at the same angle', () => {
    const person = fakePerson();
    const seat = layoutTables(1).seats[0];
    if (!seat) throw new Error('no seat');
    const entrance = makeEntrance(person, seat, 0, 1);
    stepEntrance(entrance, 60);
    idle(person, 3.2, 0);
    const first = person.arms[1].rotation.x;
    idle(person, 9.7, 0);
    expect(person.arms[1].rotation.x).toBe(first);
    expect(person.head.rotation.y).toBeCloseTo(0);
  });

  it('bows the head of someone who said no', () => {
    const person = fakePerson('no');
    idle(person, 0, 1);
    expect(person.head.rotation.x).toBeGreaterThan(0.3);
  });
});
