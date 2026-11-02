import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from '../api/api-client';
import { translator } from '../i18n/i18n';
import { errorCode, errorMessage } from './error-message';

const vi_ = translator('vi');
const en = translator('en');

afterEach(() => vi.restoreAllMocks());

describe('error messages', () => {
  it('turns every documented API code into a friendly sentence, in both languages', () => {
    const codes = [
      'sign-in-required',
      'invalid-body',
      'invalid-deadline',
      'rate-limited',
      'not-creator',
      'not-found',
      'invalid-option',
      'plan-not-open',
      'plan-expired',
      'lock-choice-required',
      'plan-closed',
      'plan-not-locked',
      'guest-conflict',
      'not-joined',
      'deadline-passed',
      'forbidden-origin',
      'network',
    ];
    const generic = vi_('error.generic');
    for (const code of codes) {
      const message = errorMessage(new ApiError(409, code), vi_);
      expect(message).not.toBe(generic);
      expect(message).not.toContain(code);
      expect(errorMessage(new ApiError(409, code), en)).not.toBe(en('error.generic'));
    }
    expect(errorMessage(new ApiError(404, 'not-found'), vi_)).toBe('Link này không dùng được nữa 😵 Bạn hỏi người gửi link mới nhé.');
    expect(errorMessage(new ApiError(409, 'deadline-passed'), vi_)).toBe('Đã hết giờ vote, chờ người tạo chốt kèo nhé.');
  });

  it('says something generic for an unknown code, a bad answer or a thrown bug', () => {
    expect(errorMessage(new ApiError(500, 'internal'), vi_)).toBe(vi_('error.generic'));
    expect(errorMessage(new ApiError(200, 'bad-response'), vi_)).toBe(vi_('error.generic'));
    expect(errorMessage(new TypeError('x is undefined'), vi_)).toBe(vi_('error.generic'));
    expect(errorCode(new Error('boom'))).toBe('internal');
  });

  it('reports a request that never got an answer as a network error, and reads the code of a refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(apiFetch('/api/plans')).rejects.toMatchObject({ status: 0, code: 'network' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'rate-limited' }, { status: 429 }));
    await expect(apiFetch('/api/plans')).rejects.toMatchObject({ status: 429, code: 'rate-limited' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(apiFetch('/api/plans')).rejects.toMatchObject({ code: 'http-502' });
  });
});
