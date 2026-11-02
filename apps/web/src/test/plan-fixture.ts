/** A plan as the API answers it (the mockup's "Cà phê thứ Bảy"), and a fetch stand-in for the component tests. */
import { vi } from 'vitest';
import type { Participant, PlanView } from '../api/plans-api';

export const T1 = '11111111-1111-4111-8111-111111111111';
export const T2 = '22222222-2222-4222-8222-222222222222';
export const P1 = '33333333-3333-4333-8333-333333333333';
export const P2 = '44444444-4444-4444-8444-444444444444';
export const PLAN_ID = '55555555-5555-4555-8555-555555555555';
export const TOKEN = 'A'.repeat(43);

export function person(id: string, displayName: string, optionIds: string[] = [], rsvp: Participant['rsvp'] = null, isCreator = false): Participant {
  return { id, displayName, rsvp, isCreator, optionIds };
}

export function makePlan(overrides: Partial<PlanView> = {}): PlanView {
  return {
    title: 'Cà phê thứ Bảy',
    activity: 'coffee',
    area: 'Quận 3',
    budgetPerPerson: 60000,
    groupSize: null,
    voteDeadline: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    readOnlyAt: new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'open',
    creatorName: 'Minh',
    lockedOptionIds: [],
    options: [
      { id: T1, kind: 'time', label: '', mapUrl: null, startsAt: '2026-11-07T02:00:00.000Z', votes: 4 },
      { id: T2, kind: 'time', label: '', mapUrl: null, startsAt: '2026-11-08T08:00:00.000Z', votes: 2 },
      { id: P1, kind: 'place', label: 'Quán cà phê A', mapUrl: null, startsAt: null, votes: 3 },
      { id: P2, kind: 'place', label: 'Quán cà phê B', mapUrl: 'https://maps.app.goo.gl/QuanB', startsAt: null, votes: 3 },
    ],
    participants: [],
    viewer: { isCreator: false, participantId: null },
    can: { join: true, vote: true, rsvp: true, edit: false, lock: false, cancel: false, done: false, rotateLink: false },
    ...overrides,
  };
}

export function creatorPlan(overrides: Partial<PlanView> = {}): PlanView {
  return makePlan({
    id: PLAN_ID,
    share: { token: TOKEN, url: `https://lockin.hoandat.com/k/${TOKEN}` },
    viewer: { isCreator: true, participantId: null },
    can: { join: true, vote: true, rsvp: true, edit: true, lock: true, cancel: true, done: false, rotateLink: true },
    ...overrides,
  });
}

export interface Call {
  path: string;
  method: string;
  body: unknown;
}

/** Stubs fetch: each call is recorded and answered by `answer` (a JSON body, or a Response). */
export function stubFetch(answer: (call: Call) => unknown): { calls: Call[]; restore(): void } {
  const calls: Call[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const call: Call = { path: String(input), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const result = answer(call);
    return result instanceof Response ? result : Response.json(result);
  });
  return { calls, restore: () => spy.mockRestore() };
}
