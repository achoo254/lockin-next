import { describe, expect, it } from 'vitest';
import { dailyOpenDedupe } from './daily-open-dedupe';

describe('daily open dedupe', () => {
  const day = new Date('2026-11-02T08:00:00Z');
  const later = new Date('2026-11-02T23:59:00Z');
  const nextDay = new Date('2026-11-03T00:00:00Z');

  it('counts a visitor once per plan per UTC day', () => {
    const firstOpen = dailyOpenDedupe();
    expect(firstOpen('plan-a', '203.0.113.1', 'Safari', day)).toBe(true);
    expect(firstOpen('plan-a', '203.0.113.1', 'Safari', later)).toBe(false);
    // Another plan, address or browser is another visitor.
    expect(firstOpen('plan-b', '203.0.113.1', 'Safari', day)).toBe(true);
    expect(firstOpen('plan-a', '203.0.113.2', 'Safari', day)).toBe(true);
    expect(firstOpen('plan-a', '203.0.113.1', 'Chrome', day)).toBe(true);
    // A new day starts over.
    expect(firstOpen('plan-a', '203.0.113.1', 'Safari', nextDay)).toBe(true);
    expect(firstOpen('plan-a', '203.0.113.1', 'Safari', nextDay)).toBe(false);
  });
});
