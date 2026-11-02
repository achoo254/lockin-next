/** The API's stable error codes (docs/plans-api.md) as friendly sentences; anything else is a generic one. */
import { ApiError } from '../api/api-client';
import type { Translate } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';

const KNOWN: Record<string, MessageKey> = {
  'sign-in-required': 'error.sign-in-required',
  'invalid-body': 'error.invalid-body',
  'invalid-deadline': 'error.invalid-deadline',
  'rate-limited': 'error.rate-limited',
  'not-creator': 'error.not-creator',
  'not-found': 'error.not-found',
  'invalid-option': 'error.invalid-option',
  'plan-not-open': 'error.plan-not-open',
  'plan-expired': 'error.plan-expired',
  'lock-choice-required': 'error.lock-choice-required',
  'plan-closed': 'error.plan-closed',
  'plan-not-locked': 'error.plan-not-locked',
  'guest-conflict': 'error.guest-conflict',
  'not-joined': 'error.not-joined',
  'deadline-passed': 'error.deadline-passed',
  'forbidden-origin': 'error.forbidden-origin',
  'name-required': 'error.name-required',
  'plan-owned': 'error.plan-owned',
  network: 'error.network',
};

/** The error code of anything a call threw (`internal` for what is not an ApiError). */
export function errorCode(error: unknown): string {
  return error instanceof ApiError ? error.code : 'internal';
}

export function errorMessage(error: unknown, t: Translate): string {
  return t(KNOWN[errorCode(error)] ?? 'error.generic');
}
