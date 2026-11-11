import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/i18n';
import { P1, P2, T1, T2, makePlan, person } from '../../test/plan-fixture';
import type { SceneController } from './scene-controller';

/** Stands in for the 3D chunk: jsdom has no WebGL, and what is tested here is the page around the canvas. */
const controller = {
  onSelect: null as ((id: string | null) => void) | null,
  setRoster: vi.fn(),
  setHighlight: vi.fn(),
  zoomBy: vi.fn(),
  dispose: vi.fn(),
};
const create = vi.fn();

vi.mock('./scene-controller', () => ({ SceneController: { create: (...args: unknown[]) => create(...args) } }));

import { PlanScene } from './plan-scene';

const plan = makePlan({
  activity: 'dinner',
  status: 'locked',
  lockedOptionIds: [T1, P1],
  participants: [person('a', 'An', [T1, P1], 'going', true), person('b', 'Bình', [T1, P1]), person('c', 'Chi', [T2, P1]), person('d', 'Dũng', [T1, P2]), person('e', 'Em', [])],
});

function show(enter = false): void {
  render(
    <I18nProvider>
      <PlanScene plan={plan} enter={enter} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  controller.onSelect = null;
  create.mockResolvedValue(controller as unknown as SceneController);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('the scene on a locked plan', () => {
  it('shows the groups with their counts once the scene is up, and builds it from the roster', async () => {
    show(true);
    await waitFor(() => expect(screen.getByRole('button', { name: /Ngồi bàn/ })).not.toBeNull());
    const config = create.mock.calls[0]?.[1] as { roster: Array<{ name: string; group: string; say: string | null }>; enter: boolean; interactive: boolean; signage: { placeName: string } };
    expect(config.enter).toBe(true);
    expect(config.interactive).toBe(true);
    expect(config.signage.placeName).toBe('Quán cà phê A');
    expect(config.roster.map((entry) => [entry.name, entry.group])).toEqual([['An', 'sit'], ['Bình', 'sit'], ['Chi', 'time'], ['Dũng', 'place'], ['Em', 'none']]);
    expect(screen.getByRole('button', { name: /Ngồi bàn/ }).textContent).toContain('2');
    expect(screen.getByRole('button', { name: /Lệch giờ/ }).textContent).toContain('1');
  });

  it('highlights one group at a time through the controller', async () => {
    show();
    const chip = await screen.findByRole('button', { name: /Lệch quán/ });
    fireEvent.click(chip);
    expect(controller.setHighlight).toHaveBeenLastCalledWith('place');
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(controller.setHighlight).toHaveBeenLastCalledWith(null);
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('zooms with the two buttons', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Phóng to cảnh' }));
    expect(controller.zoomBy).toHaveBeenLastCalledWith(expect.any(Number));
    const inward = controller.zoomBy.mock.calls.at(-1)?.[0] as number;
    fireEvent.click(screen.getByRole('button', { name: 'Thu nhỏ cảnh' }));
    expect(inward).toBeLessThan(0);
    expect(controller.zoomBy.mock.calls.at(-1)?.[0] as number).toBeGreaterThan(0);
  });

  it('says what the tapped person voted, and why they stand outside', async () => {
    show();
    await screen.findByRole('button', { name: /Ngồi bàn/ });
    expect(screen.getByText('Chạm vào một nhân vật để xem họ vote gì.')).not.toBeNull();
    act(() => controller.onSelect?.('c'));
    expect(await screen.findByText(/Chi · Lệch giờ/)).not.toBeNull();
    expect(screen.getAllByText(/Mình chọn Chủ Nhật/).length).toBeGreaterThan(0);
  });

  it('lists everyone with their group for screen readers', async () => {
    show();
    await screen.findByRole('button', { name: /Ngồi bàn/ });
    const list = document.querySelector('.sr-only');
    expect(list?.textContent).toContain('Em: Chưa vote');
    expect(list?.textContent).toContain('Dũng: Lệch quán');
  });

  it('frees the scene when it goes away', async () => {
    show();
    await screen.findByRole('button', { name: /Ngồi bàn/ });
    cleanup();
    expect(controller.dispose).toHaveBeenCalled();
  });

  it('shows nothing at all when the scene cannot be created (no WebGL)', async () => {
    create.mockRejectedValue(new Error('no webgl'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    show();
    await waitFor(() => expect(document.querySelector('[data-id=scene]')).toBeNull());
    expect(error).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Ngồi bàn/ })).toBeNull();
  });
});

describe('when the 3D code cannot load', () => {
  it('says so and offers a reload, leaving the rest of the ticket alone', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    create.mockRejectedValue(new Error('Failed to fetch dynamically imported module'));
    show();
    await waitFor(() => expect(screen.getByText('Chưa dựng được cảnh quán. Kiểm tra mạng rồi thử lại.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Tải lại' })).toBeTruthy();
    expect(document.querySelector('canvas')).toBeNull();
    error.mockRestore();
  });
});
