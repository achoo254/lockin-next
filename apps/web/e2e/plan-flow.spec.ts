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

/** Pastes text into a box the way a browser does (a cancelable paste event carrying the clipboard). */
async function paste(page: Page, selector: string, text: string): Promise<void> {
  await page.locator(selector).evaluate((box, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** Every "Mở bản đồ" label fits on one line, and nothing scrolls sideways at the narrowest phone. */
async function placeOptionsFit(page: Page): Promise<void> {
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const lines = await page.locator('.map-link span').evaluateAll((labels) => labels.map((label) => label.getClientRects().length));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.every((n) => n === 1)).toBe(true);
    const box = await page.locator('.map-link').first().boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    if (width === 360) expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
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

// The manage link is copied with the page's copy button and read back from the clipboard.
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test('a signed-in creator makes a plan, a guest votes without an account, the creator locks it, the guest sees the ticket', async ({ page, browser, baseURL }, testInfo) => {
  const creatorErrors = consoleErrors(page);
  await page.setViewportSize({ width: 375, height: 900 });

  // Home, signed out.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hết cảnh “để mai tính”.');
  await shoot(page, testInfo, '01-home');

  // Sign in through the fake IdP from the header, back home; the form then has the account's name.
  await page.click('[data-id=public-sign-in]');
  await page.waitForURL((url) => url.pathname === '/' && !url.search.includes('login='));
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
  // A maps link typed key by key stays text until the box is left; a pasted one is attached at once.
  const typedLink = 'https://www.google.com/maps/place/The+Workshop+Coffee/@10.77,106.70,17z';
  await page.click('[data-id=add-place]');
  await page.locator('[data-id=place-2]').pressSequentially(typedLink);
  await expect(page.locator('[data-id=place-2]')).toHaveValue(typedLink);
  await expect(page.locator('[data-id=place-map-2]')).toHaveCount(0);
  await page.locator('[data-id=place-2]').blur();
  await expect(page.locator('[data-id=place-2]')).toHaveValue('The Workshop Coffee');
  await page.click('[data-id=add-place]');
  await paste(page, '[data-id=place-3]', 'https://www.google.com/maps/place/C%C3%A0+Ph%C3%AA+V%E1%BB%A3t/@10.78,106.70,17z');
  await expect(page.locator('[data-id=place-3]')).toHaveValue('Cà Phê Vợt');
  await expect(page.locator('[data-id=place-map-3]')).toContainText('Đã gắn link bản đồ');
  // The remove button stays on the line of the box, the attached link goes below both.
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const input = await page.locator('[data-id=place-3]').boundingBox();
    const remove = await page.getByRole('button', { name: 'Xoá chỗ 4' }).boundingBox();
    const attached = await page.locator('[data-id=place-map-3]').boundingBox();
    if (!input || !remove || !attached) throw new Error('place row not laid out');
    expect(Math.abs(remove.y + remove.height / 2 - (input.y + input.height / 2))).toBeLessThan(2);
    expect(attached.y).toBeGreaterThanOrEqual(input.y + input.height - 1);
  }
  await page.setViewportSize({ width: 375, height: 900 });
  // Two friends on the list (saved in this browser for the next plan): the creator makes three.
  await page.fill('[data-id=member-input]', 'Linh, Vy');
  await page.click('[data-id=member-add]');
  await expect(page.locator('[data-id=members]')).toContainText('2 người');
  await shoot(page, testInfo, '02-create');
  await page.click('[data-id=form-submit]');
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);

  // The share screen: the link, the share button, the preview.
  await expect(page.locator('[data-id=share-url]')).toContainText('/k/');
  // Made signed in: the plan is the account's already, no card to keep it.
  await expect(page.locator('[data-id=save-card]')).toHaveCount(0);
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
  await expect(guest.locator('[data-id=nudge]')).toContainText('Còn 1 người chưa vote 👀');
  await expect(guest.locator('[data-id=nudge-names]')).toHaveText('Vy');
  await expect(guest.locator('[data-id=invite-card]')).toBeVisible();
  await placeOptionsFit(guest);
  await shoot(guest, testInfo, '04-guest-vote');

  // The creator locks it in: the leaders are picked already.
  await page.goto(planPath);
  await expect(page.locator('[data-id=lock-panel]')).toContainText('1/3 người đã vote');
  // The creator votes too, like a guest, above the lock panel; the lock choices are radios.
  await page.locator('[data-id=creator-vote] [data-id^=option-]', { hasText: 'Quán B' }).click();
  await page.click('[data-id=creator-vote] [data-id=vote-submit]');
  await expect(page.locator('[data-id=lock-panel]')).toContainText('2/3 người đã vote');
  await expect(page.locator('[data-id=lock-panel] [role=radio]', { hasText: 'Quán B' })).toHaveAttribute('aria-checked', 'true');
  await placeOptionsFit(page);
  await shoot(page, testInfo, '05-creator-lock');
  await page.click('[data-id=lock-submit]');
  await expect(page.locator('[data-id=ticket]')).toContainText('Quán B');
  await expect(page.locator('[data-id=stamp]')).toHaveClass(/is-new/);
  // The creator is going from the start (no RSVP tapped), listed first.
  await expect(page.locator('[data-id=ticket-going] li')).toHaveText([/Người Thử E2E$/, /Linh$/]);
  // Vy was on the list and never opened the link: the ticket says so.
  await expect(page.locator('[data-id=ticket-waiting] li')).toHaveText([/Vy$/]);
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
  await page.goto('/auth/login?return=/new');
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

/** Fills the create form with a plan of two places; the name only when given. */
async function fillPlan(page: Page, title: string, name: string | null): Promise<void> {
  await page.fill('[data-id=form-title]', title);
  await page.fill('[data-id=place-0]', 'Quán A');
  await page.click('[data-id=add-place]');
  await page.fill('[data-id=place-1]', 'Quán B');
  if (name !== null) await page.fill('[data-id=form-name]', name);
}

test('a creator signed out makes a plan, keeps the manage link, a guest votes, the creator locks it, the guest sees the ticket', async ({ page, browser, baseURL }, testInfo) => {
  const creatorErrors = consoleErrors(page);
  await page.setViewportSize({ width: 375, height: 900 });
  const newContext = (): ReturnType<typeof browser.newContext> =>
    browser.newContext({ baseURL, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', viewport: { width: 375, height: 900 } });

  // "Lên kèo" goes straight to the form, no sign-in; the header still offers it.
  await page.goto('/');
  await expect(page.locator('[data-id=public-sign-in]')).toHaveText('Đăng nhập');
  await page.click('[data-id=create-plan]');
  await page.waitForURL('**/new');
  await expect(page.locator('[data-id=form-name]')).toHaveValue('');
  await fillPlan(page, 'Ăn tối thứ Sáu', null);
  // Signed out, the name is a must.
  await page.click('[data-id=form-submit]');
  await expect(page.locator('[data-id=form-error]')).toContainText('nhập tên của bạn trong kèo');
  await page.fill('[data-id=form-name]', 'Chủ Kèo');
  await page.click('[data-id=form-submit]');
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);

  // The share screen, with the card to keep managing the plan.
  const card = page.locator('[data-id=save-card]');
  await expect(card).toContainText('Giữ quyền quản lý kèo');
  await expect(card.locator('[data-id=manage-warn]')).toHaveText('Ai có link này là quản lý được kèo, đừng gửi vào nhóm nhé.');
  await expect(card.locator('[data-id=save-account]')).toHaveText(/Lưu kèo vào tài khoản hoandat\.com \(miễn phí\)/);
  await shoot(page, testInfo, '11-share-signed-out');
  await card.locator('[data-id=manage-copy]').click();
  await expect(card.locator('[data-id=manage-copy]')).toHaveText(/Đã chép link quản lý/);
  const manageUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(manageUrl).toMatch(/\/m\/[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  const planPath = await page.locator('[data-id=share-open]').getAttribute('href');
  if (!planPath) throw new Error('no plan link');

  // A guest votes in another browser.
  const guestContext = await newContext();
  const guest = await guestContext.newPage();
  await guest.goto(planPath);
  await expect(guest.locator('[data-id=plan-head]')).toContainText('Chủ Kèo mời bạn tham gia kèo');
  await guest.fill('[data-id=guest-name]', 'Linh');
  await guest.locator('[data-id=vote-board] [data-id^=option-]').first().click();
  await guest.locator('[data-id=vote-board] [data-id^=option-]', { hasText: 'Quán B' }).click();
  await guest.click('[data-id=rsvp-going]');
  await guest.click('[data-id=vote-submit]');
  await expect(guest.locator('[data-id=vote-sent]')).toBeVisible();
  // The guest has no say over the plan.
  await expect(guest.locator('[data-id=lock-panel]')).toHaveCount(0);

  // The manage link on a new device: creator rights there, and the token gone from the address.
  const phoneContext = await newContext();
  const phone = await phoneContext.newPage();
  await phone.goto(new URL(manageUrl).pathname);
  await phone.waitForURL(`**${planPath}`);
  expect(phone.url()).not.toContain(new URL(manageUrl).pathname.split('.')[1] ?? 'missing');
  await expect(phone.locator('[data-id=lock-panel]')).toContainText('1 người đã vote');
  await phoneContext.close();

  // The creator locks it in from the browser that made it.
  await page.goto(planPath);
  await page.click('[data-id=lock-submit]');
  await expect(page.locator('[data-id=ticket]')).toContainText('Quán B');
  await expect(page.locator('[data-id=save-card-locked]')).toContainText('Chốt xong rồi!');
  await page.waitForTimeout(700);
  await shoot(page, testInfo, '12-locked-signed-out');
  // Offered once: not again on the next visit.
  await page.reload();
  await expect(page.locator('[data-id=ticket]')).toBeVisible();
  await expect(page.locator('[data-id=save-card-locked]')).toHaveCount(0);

  await guest.click('[data-id=plan-refresh]');
  await expect(guest.locator('[data-id=ticket]')).toBeVisible();
  await expect(guest.locator('[data-id=ticket-going] li')).toHaveText([/Chủ Kèo$/, /Linh$/]);

  // A wrong manage link lands home with a notice.
  await guest.goto(`/m/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}.${'x'.repeat(43)}`);
  await expect(guest.locator('[data-id=login-notice]')).toContainText('Link quản lý này không dùng được nữa');

  expect(creatorErrors).toEqual([]);
  await guestContext.close();
});

test('a creator signed out saves the plan to an account, and finds it in “Kèo của tôi” on another device', async ({ page, browser, baseURL }) => {
  const errors = consoleErrors(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('/new');
  await fillPlan(page, 'Họp nhóm cuối tuần', 'Trưởng nhóm');
  await page.click('[data-id=form-submit]');
  await page.waitForURL(/\/plans\/[0-9a-f-]{36}$/);
  const sharePage = new URL(page.url()).pathname;

  // Signed out, "Kèo của tôi" lists it as kept in this browser only.
  await page.goto('/plans');
  await expect(page.locator('[data-id=plan-list]')).toContainText('Họp nhóm cuối tuần');
  await expect(page.locator('[data-id=plan-browser-only]')).toHaveText('Chỉ trên trình duyệt này');
  await expect(page.locator('[data-id=list-sign-in-hint]')).toBeVisible();

  // Save it: through the fake IdP's sign-up and back, where the plan is saved and the address cleaned.
  await page.goto(sharePage);
  await page.click('[data-id=save-account]');
  await page.waitForURL((url) => url.pathname === sharePage && url.search === '');
  await expect(page.locator('[data-id=share-panel]')).toBeVisible();
  await expect(page.locator('[data-id=save-card]')).toHaveCount(0);
  await expect(page.locator('[data-id=claim-error]')).toHaveCount(0);

  // Saved: the account is the key. The owner sees the new manage link and can change it again.
  const manageCard = page.locator('[data-id=manage-card]');
  await expect(manageCard).toContainText('chỉ tài khoản này quản lý được kèo');
  const savedLink = await manageCard.locator('[data-id=manage-url]').textContent();
  await manageCard.locator('[data-id=manage-rotate]').click();
  await expect(manageCard.locator('[data-id=manage-rotated]')).toHaveText('Đã đổi link quản lý. Link cũ không dùng được nữa, nhớ chép link mới.');
  await expect(manageCard.locator('[data-id=manage-url]')).not.toHaveText(savedLink ?? '');

  // Another device, signed in to the same account: no cookie of the plan, yet it is listed and opens.
  const laptopContext = await browser.newContext({ baseURL, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const laptop = await laptopContext.newPage();
  await laptop.goto('/auth/login?return=/plans');
  await laptop.waitForURL('**/plans');
  const item = laptop.locator('[data-id^=plan-item-]', { hasText: 'Họp nhóm cuối tuần' });
  await expect(item).toBeVisible();
  await expect(item.locator('[data-id=plan-browser-only]')).toHaveCount(0);
  await laptop.goto(sharePage);
  await expect(laptop.locator('[data-id=share-panel]')).toBeVisible();
  await laptopContext.close();
  expect(errors).toEqual([]);
});
