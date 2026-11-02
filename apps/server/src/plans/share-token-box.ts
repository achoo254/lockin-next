/**
 * The share token kept encrypted (AES-256-GCM, key SHARE_TOKEN_KEY) next to its sha256, so the creator can see and
 * send the link again. Lookups still go by the hash; the sealed copy is only ever opened for the plan's creator.
 * The plan id is the additional authenticated data: a sealed token copied onto another plan does not open.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isTokenShape } from './tokens';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface ShareTokenBox {
  /** `v1.<iv>.<ciphertext>.<tag>`, base64url parts. */
  seal(token: string, planId: string): string;
  /** The token, or null when there is none, or it does not open with this key for this plan. */
  open(sealed: string | null, planId: string): string | null;
}

const aad = (planId: string): Buffer => Buffer.from(`lockin-share:${planId}`, 'utf8');

export function shareTokenBox(key: Buffer): ShareTokenBox {
  if (key.length !== 32) throw new Error('share token key must be 32 bytes');
  return {
    seal(token, planId) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(planId));
      const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
      return [VERSION, iv.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
    },
    open(sealed, planId) {
      if (sealed === null) return null;
      const [version, ivText, ciphertextText, tagText, ...rest] = sealed.split('.');
      if (version !== VERSION || ivText === undefined || ciphertextText === undefined || tagText === undefined || rest.length > 0) return null;
      const iv = Buffer.from(ivText, 'base64url');
      const tag = Buffer.from(tagText, 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
      try {
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(aad(planId));
        decipher.setAuthTag(tag);
        const token = Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
        return isTokenShape(token) ? token : null;
      } catch {
        // Another key (a dev restart without SHARE_TOKEN_KEY) or a changed value: the link cannot be shown again.
        return null;
      }
    },
  };
}
