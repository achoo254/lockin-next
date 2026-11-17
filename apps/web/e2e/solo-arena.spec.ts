import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

// The arena is drawn with WebGL: software rendering lets a headless browser draw it.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } });

interface Guest {
  name: string;
  rsvp: 'going' | 'maybe' | 'no';
  /** What it votes: the locked time and place, another time at the same place, or nothing. */
  picks: 'locked' | 'other' | 'none';
}

/** A guest of the plan, over the API like the web app does (its own cookies, so its own person). */
async function joinGuest(request: APIRequestContext, token: string, origin: string, guest: Guest, options: { time: string[]; place: string[] }): Promise<void> {
  const headers = { origin, 'content-type': 'application/json' };
  const post = async (path: string, data: unknown): Promise<void> => {
    const res = await request.post(`/api/k/${token}${path}`, { headers, data });
    expect(res.status(), `${path} of ${guest.name}`).toBe(200);
  };
  await post('/join', { displayName: guest.name });
  const [timeLocked, timeOther] = options.time;
  const [placeLocked] = options.place;
  const optionIds = guest.picks === 'locked' ? [timeLocked, placeLocked] : guest.picks === 'other' ? [timeOther, placeLocked] : [];
  if (optionIds.length > 0) await post('/votes', { optionIds });
  await post('/rsvp', { rsvp: guest.rsvp });
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.click('[data-id=public-sign-in]');
  await page.waitForURL((url) => url.pathname === '/' && !url.search.includes('login='));
}

test('a solo game plan: the rules form, the rules card, and the arena of a locked plan with two teams and the stands', async ({ page, playwright, baseURL }, testInfo) => {
  if (!baseURL) throw new Error('no base URL');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page);

  // The form: choosing the solo kind brings the rules and takes the budget and group size away.
  await page.goto('/new');
  await expect(page.locator('[data-id=duel-fields]')).toHaveCount(0);
  await page.click('[data-id=activity-solo_game]');
  await expect(page.locator('[data-id=form-title]')).toHaveValue('Kèo solo game');
  await expect(page.locator('[data-id=duel-fields]')).toBeVisible();
  await expect(page.locator('[data-id=form-budget]')).toHaveCount(0);
  await expect(page.locator('[data-id=form-group-size]')).toHaveCount(0);
  for (const rule of ['basic_attacks_only', 'no_bush', 'no_minion_farm', 'no_heal']) await expect(page.locator(`[data-id=duel-rule-${rule}]`)).toHaveAttribute('aria-pressed', 'true');
  await page.click('[data-id=duel-game-lmht]');
  await page.click('[data-id=duel-best-of-3]');
  await page.click('[data-id=duel-win-first_tower]');
  await page.fill('[data-id=duel-custom-input]', 'Không mua đồ trong 3 phút đầu');
  await page.click('[data-id=duel-custom-add]');
  await page.fill('[data-id=duel-stake-input]', 'Thua bao ly trà sữa');
  await page.fill('[data-id=place-0]', 'Phòng custom Tốc Chiến');
  await page.fill('[data-id=form-area]', 'Online');
  await page.fill('[data-id=member-input]', 'Khán giả');
  await page.screenshot({ path: testInfo.outputPath('01-form.png'), fullPage: true });
  await page.click('[data-id=form-submit]');
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);

  const planPath = await page.locator('[data-id=share-open]').getAttribute('href');
  if (!planPath) throw new Error('no plan link');
  const token = planPath.replace('/k/', '');

  // A guest sees the rules card and the "going means you accept" line.
  const peek = await playwright.request.newContext({ baseURL });
  const view = (await (await peek.get(`/api/k/${token}`)).json()) as { plan: { options: Array<{ id: string; kind: string }> } };
  const ids = (kind: string): string[] => view.plan.options.filter((option) => option.kind === kind).map((option) => option.id);
  const options = { time: ids('time'), place: ids('place') };
  expect(options.time.length).toBeGreaterThanOrEqual(2);
  const guestContext = await playwright.request.newContext({ baseURL });
  await page.goto(planPath);
  await expect(page.locator('[data-id=duel-card]')).toContainText('Không mua đồ trong 3 phút đầu');
  await expect(page.locator('[data-id=duel-card]')).toContainText('Cược: Thua bao ly trà sữa');
  await page.screenshot({ path: testInfo.outputPath('02-plan-with-rules.png'), fullPage: true });

  // Nine more people going make five against five with the creator; four more come to watch (or not).
  const guests: Guest[] = [
    ...['Bình', 'Chi', 'Dũng', 'Em', 'Phúc', 'Giang', 'Hà', 'Khoa', 'Lan'].map((name): Guest => ({ name, rsvp: 'going', picks: 'locked' })),
    { name: 'Mai', rsvp: 'going', picks: 'locked' },
    { name: 'Nam', rsvp: 'going', picks: 'locked' },
    { name: 'Oanh', rsvp: 'going', picks: 'other' },
    { name: 'Quang', rsvp: 'no', picks: 'none' },
  ];
  for (const guest of guests) {
    const request = await playwright.request.newContext({ baseURL });
    await joinGuest(request, token, baseURL, guest, options);
    await request.dispose();
  }
  await guestContext.dispose();
  await peek.dispose();

  // The creator locks the plan with the leaders picked already.
  await page.goto(planPath);
  await page.click('[data-id=lock-submit]');
  await expect(page.locator('[data-id=ticket]')).toContainText('Luật kèo');
  // Software WebGL is not always there in a headless browser: then the scene says so and only the page around it is checked.
  const sceneState = page.locator('[data-id=scene-groups], [data-id=scene-failed]').first();
  await expect(sceneState).toBeVisible({ timeout: 30_000 });
  if ((await page.locator('[data-id=scene-failed]').count()) > 0) {
    test.info().annotations.push({ type: 'skipped', description: 'no WebGL in this browser run: the arena was not drawn' });
    await page.screenshot({ path: testInfo.outputPath('04-ticket.png'), fullPage: true });
    expect(errors).toEqual([]);
    return;
  }
  await expect(page.locator('[data-id=scene-group-duel]')).toContainText('10');
  await expect(page.locator('[data-id=scene-group-sit]')).toContainText('2');
  await expect(page.locator('[data-id=scene-group-time]')).toContainText('1');
  await expect(page.locator('[data-id=scene-group-no]')).toContainText('1');
  // The walk-in of the spectators is over.
  await page.waitForTimeout(4000);
  await page.locator('[data-id=scene]').screenshot({ path: testInfo.outputPath('03-arena.png') });
  await page.screenshot({ path: testInfo.outputPath('04-ticket.png'), fullPage: true });
  // The story image draws the arena once, off screen (the live canvas cannot be captured headless).
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-id=ticket-story]')]);
  await download.saveAs(testInfo.outputPath('05-story.png'));
  expect(errors).toEqual([]);
});
