import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Duel } from '../api/plans-api';
import { I18nProvider, translator } from '../i18n/i18n';
import { PlanTicket } from './plan-ticket';
import { creatorPlan, makePlan } from '../test/plan-fixture';
import { DuelCard } from './duel-card';
import { DuelFields, duelInput, initialDuel } from './duel-fields';
import { type CreateForm, buildCreateInput, initialForm } from './plan-form';
import { useState } from 'react';

// jsdom has no WebGL: the 3D chunk is a stand-in that never finishes loading, the ticket around it is what is tested.
vi.mock('./scene/scene-controller', () => ({ SceneController: { create: () => new Promise(() => undefined) } }));

const t = translator('vi');
const NOW = new Date('2026-11-06T03:00:00Z');
const DUEL: Duel = {
  game: 'lmht',
  bestOf: 3,
  winCondition: 'first_blood',
  rules: ['basic_attacks_only', 'no_bush', 'no_minion_farm', 'no_heal'],
  customRules: ['Không mua đồ trong 3 phút đầu'],
  stake: 'Thua bao ly trà sữa',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('DuelCard', () => {
  it('lists the game, rounds, win condition, every rule, the stake and the accept hint', () => {
    render(
      <I18nProvider>
        <DuelCard duel={DUEL} withAccept />
      </I18nProvider>,
    );
    const card = document.querySelector('[data-id="duel-card"]');
    const inside = within(card as HTMLElement);
    expect(inside.getByText(t('duel.game.lmht'))).toBeTruthy();
    expect(inside.getByText(t('duel.bestOf.3'))).toBeTruthy();
    expect(inside.getByText(t('duel.win.first_blood'))).toBeTruthy();
    for (const rule of DUEL.rules) expect(inside.getByText(t(`duel.rule.${rule}`))).toBeTruthy();
    expect(inside.getByText('Không mua đồ trong 3 phút đầu')).toBeTruthy();
    expect(inside.getByText(t('duel.stake', { stake: 'Thua bao ly trà sữa' }))).toBeTruthy();
    expect(inside.getByText(t('duel.accept'))).toBeTruthy();
  });

  it('says so when a duel has no rules, and shows no stake line without a stake', () => {
    render(
      <I18nProvider>
        <DuelCard duel={{ ...DUEL, rules: [], customRules: [], stake: null }} />
      </I18nProvider>,
    );
    expect(screen.getByText(t('duel.noRules'))).toBeTruthy();
    expect(document.querySelector('[data-id="duel-stake"]')).toBeNull();
  });

  it('is on the locked ticket of a solo game plan and not on any other', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const locked = { status: 'locked' as const, lockedOptionIds: [], duel: DUEL, activity: 'solo_game' as const };
    const { rerender } = render(
      <I18nProvider>
        <PlanTicket plan={creatorPlan(locked)} link="https://lockin.hoandat.com/k/x" />
      </I18nProvider>,
    );
    expect(document.querySelector('[data-id="duel-card"]')).not.toBeNull();
    rerender(
      <I18nProvider>
        <PlanTicket plan={makePlan({ status: 'locked' })} link="https://lockin.hoandat.com/k/x" />
      </I18nProvider>,
    );
    expect(document.querySelector('[data-id="duel-card"]')).toBeNull();
  });
});

function Harness(): ReturnType<typeof DuelFields> {
  const [duel, setDuel] = useState(initialDuel());
  return (
    <>
      <DuelFields duel={duel} onChange={setDuel} />
      <output data-id="state">{JSON.stringify(duelInput(duel))}</output>
    </>
  );
}
const state = (): Duel => JSON.parse(document.querySelector('[data-id="state"]')?.textContent ?? '{}') as Duel;

describe('DuelFields', () => {
  it('starts with the 1v1 classics ticked: basic attacks only, no bush, no minion farm, no healing', () => {
    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );
    expect(state()).toEqual({ game: 'lien_quan', bestOf: 1, winCondition: 'first_blood', rules: ['basic_attacks_only', 'no_bush', 'no_minion_farm', 'no_heal'], customRules: [], stake: null });
  });

  it('toggles a rule, keeps the rules in list order, picks game, rounds and win condition, adds and removes own rules, takes a stake', () => {
    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );
    const click = (id: string): boolean => fireEvent.click(document.querySelector(`[data-id="${id}"]`) as HTMLElement);
    click('duel-rule-no_bush');
    click('duel-rule-no_recall');
    click('duel-rule-no_summoner_spells');
    expect(state().rules).toEqual(['basic_attacks_only', 'no_summoner_spells', 'no_minion_farm', 'no_heal', 'no_recall']);
    click('duel-game-lmht');
    click('duel-best-of-5');
    click('duel-win-first_tower');
    expect(state()).toMatchObject({ game: 'lmht', bestOf: 5, winCondition: 'first_tower' });

    const input = document.querySelector('[data-id="duel-custom-input"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: ' Không mua đồ ' } });
    click('duel-custom-add');
    fireEvent.change(input, { target: { value: 'không mua đồ' } });
    click('duel-custom-add');
    expect(state().customRules).toEqual(['Không mua đồ']);
    fireEvent.click(screen.getByLabelText(t('duel.form.customRemove', { n: 1 })));
    expect(state().customRules).toEqual([]);

    fireEvent.change(document.querySelector('[data-id="duel-stake-input"]') as HTMLInputElement, { target: { value: ' bao trà sữa ' } });
    expect(state().stake).toBe('bao trà sữa');
  });
});

describe('buildCreateInput for a solo game', () => {
  const base = (overrides: Partial<CreateForm> = {}): CreateForm => ({
    ...initialForm(NOW, 'Minh', t),
    places: [{ key: 'p', label: 'Phòng custom', mapUrl: null }],
    ...overrides,
  });

  it('sends the duel with a group of two and no budget, only for a solo game', () => {
    const built = buildCreateInput(base({ activity: 'solo_game', budget: '60000', groupSize: '9', duel: { ...initialDuel(), stake: ' trà sữa ' } }), NOW);
    expect(built.ok && built.input).toMatchObject({ activity: 'solo_game', groupSize: 2, duel: { game: 'lien_quan', stake: 'trà sữa' } });
    expect(built.ok && 'budgetPerPerson' in built.input).toBe(false);
    const coffee = buildCreateInput(base({ duel: { ...initialDuel(), game: 'lmht' } }), NOW);
    expect(coffee.ok && 'duel' in coffee.input).toBe(false);
  });
});
