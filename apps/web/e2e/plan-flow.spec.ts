import { readFile } from 'node:fs/promises';
import { type Page, type TestInfo, expect, test } from '@playwright/test';

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Full-page shots at a phone and a desktop width, then back to the phone. The sticky header and action bar are made
 * static while shooting (a full-page shot would draw them in the middle of the page).
 */
async function shoot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const unstick = await page.addStyleTag({ content: '.topbar, .action-bar { position: static !important; }' });
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    // Nothing may scroll sideways at a phone width.
    if (width === 375) expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true });
  }
  await unstick.evaluate((element) => (element as Element).remove());
  await page.setViewportSize({ width: 375, height: 900 });
}

/** Console errors of a page (the run fails on any). */
function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Saves the story image and checks it is a 1080 × 1920 PNG. */
async function storyImage(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-id=ticket-story]')]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const file = testInfo.outputPath(`${name}.png`);
  await download.saveAs(file);
  expect(pngSize(await readFile(file))).toEqual({ width: 1080, height: 1920 });
}

test('a creator makes a plan, a guest votes without an account, the creator locks it, the guest sees the ticket', async ({ page, browser, baseURL }, testInfo) => {
  const creatorErrors = consoleErrors(page);
  await page.setViewportSize({ width: 375, height: 900 });

  // Home, signed out.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hết cảnh “để mai tính”.');
  await shoot(page, testInfo, '01-home');

  // Sign in through the fake IdP on the way to making a plan.
  await page.click('[data-id=create-plan]');
  await page.waitForURL('**/new');
  await expect(page.locator('[data-id=form-name]')).toHaveValue('Người Thử E2E');

  // "Kèo của tôi" before any plan: its empty state.
  await page.goto('/plans');
  await expect(page.locator('[data-id=state-empty]')).toBeVisible();
  await shoot(page, testInfo, '08-my-plans-empty');

  // Make the plan: this weekend's evenings are picked already; two places; a group of three.
  await page.goto('/new');
  await expect(page.locator('[data-id=quick-sat]')).toHaveAttribute('aria-pressed', 'true');
  await page.fill('[data-id=form-title]', 'Cà phê thứ Bảy');
  await page.fill('[data-id=form-area]', 'Quận 3');
  await page.fill('[data-id=place-0]', 'Quán A');
  await page.click('[data-id=add-place]');
  await page.fill('[data-id=place-1]', 'Quán B');
  await page.fill('[data-id=form-group-size]', '3');
  await shoot(page, testInfo, '02-create');
  await page.click('[data-id=form-submit]');
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);

  // The share screen: the link, the share button, the preview.
  await expect(page.locator('[data-id=share-url]')).toContainText('/k/');
  const planPath = await page.locator('[data-id=share-open]').getAttribute('href');
  if (!planPath) throw new Error('no plan link');
  await shoot(page, testInfo, '03-share');

  // The link preview the server renders for the group chat.
  const og = await (await page.request.get(planPath)).text();
  expect(og).toContain('<meta property="og:title" content="Cà phê thứ Bảy · vote trên Lockin" />');
  expect(og).not.toContain('Người Thử E2E');

  // A guest in another browser: no sign-in anywhere, a name, picks, "Có", send.
  const guestContext = await browser.newContext({ baseURL, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', viewport: { width: 375, height: 900 } });
  const guest = await guestContext.newPage();
  const guestErrors = consoleErrors(guest);
  await guest.goto(planPath);
  await expect(guest.locator('[data-id=plan-head]')).toContainText('Người Thử E2E mời bạn tham gia kèo');
  await expect(guest.locator('[data-id=public-sign-in]')).toHaveCount(0);
  await guest.fill('[data-id=guest-name]', 'Linh');
  await guest.locator('[data-id=vote-board] [data-id^=option-]').first().click();
  await guest.locator('[data-id=vote-board] [data-id^=option-]', { hasText: 'Quán B' }).click();
  await guest.click('[data-id=rsvp-going]');
  await guest.click('[data-id=vote-submit]');
  await expect(guest.locator('[data-id=vote-sent]')).toBeVisible();
  await expect(guest.locator('[data-id=nudge]')).toContainText('Còn 2 người chưa vote 👀');
  await expect(guest.locator('[data-id=invite-card]')).toBeVisible();
  await shoot(guest, testInfo, '04-guest-vote');

  // The creator locks it in: the leaders are picked already.
  await page.goto(planPath);
  await expect(page.locator('[data-id=lock-panel]')).toContainText('1/3 người đã vote');
  await shoot(page, testInfo, '05-creator-lock');
  await page.click('[data-id=lock-submit]');
  await expect(page.locator('[data-id=ticket]')).toContainText('Quán B');
  await expect(page.locator('[data-id=stamp]')).toHaveClass(/is-new/);
  await expect(page.locator('[data-id=ticket-going]')).toContainText('Linh');
  await storyImage(page, testInfo, '07-story-cafe');

  // The guest sees the ticket after a refresh; the stamp lands once in this browser.
  await guest.click('[data-id=plan-refresh]');
  await expect(guest.locator('[data-id=ticket]')).toBeVisible();
  await expect(guest.locator('[data-id=stamp]')).toHaveClass(/is-new/);
  await expect(guest.locator('[data-id=vote-board]')).toBeVisible();
  await guest.waitForTimeout(700);
  await shoot(guest, testInfo, '06-locked-ticket');
  await guest.reload();
  await expect(guest.locator('[data-id=stamp]')).not.toHaveClass(/is-new/);

  // "Kèo của tôi" lists it.
  await page.goto('/plans');
  await expect(page.locator('[data-id=plan-list]')).toContainText('Cà phê thứ Bảy');
  await shoot(page, testInfo, '09-my-plans');

  // A link that names no plan.
  await guest.goto(`/k/${'x'.repeat(43)}`);
  await expect(guest.locator('[data-id=state-missing]')).toContainText('Link này không dùng được nữa');
  await shoot(guest, testInfo, '10-link-missing');

  expect(creatorErrors).toEqual([]);
  expect(guestErrors.filter((text) => !text.includes('404'))).toEqual([]);
  await guestContext.close();
});

test('the story image of another template (a party, dark) is a 1080 × 1920 PNG too', async ({ page, baseURL }, testInfo) => {
  await page.goto('/');
  await page.click('[data-id=create-plan]');
  await page.waitForURL('**/new');
  const hour = 60 * 60 * 1000;
  const headers = { origin: baseURL ?? '' };
  const made = await page.request.post('/api/plans', {
    headers,
    data: {
      title: 'Liên hoan cuối tháng với cả phòng kinh doanh',
      activity: 'party',
      voteDeadline: new Date(Date.now() + 24 * hour).toISOString(),
      options: [
        { kind: 'time', startsAt: new Date(Date.now() + 48 * hour).toISOString() },
        { kind: 'place', label: 'Nhà hàng Sông Sài Gòn' },
      ],
      creatorDisplayName: 'Trưởng phòng',
    },
  });
  expect(made.status()).toBe(201);
  const { plan, share } = (await made.json()) as { plan: { id: string; options: Array<{ id: string; kind: string }> }; share: { url: string } };
  const ids = Object.fromEntries(plan.options.map((option) => [option.kind, option.id]));
  const locked = await page.request.post(`/api/plans/${plan.id}/lock`, { headers, data: { timeOptionId: ids.time, placeOptionId: ids.place } });
  expect(locked.status()).toBe(200);
  await page.goto(new URL(share.url).pathname);
  await expect(page.locator('[data-id=ticket]')).toBeVisible();
  await storyImage(page, testInfo, '07-story-party');
});
