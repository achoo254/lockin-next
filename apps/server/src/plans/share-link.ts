/** The link a creator sends to the group: PUBLIC_URL/k/<token>. */
import type { ShareTokenBox } from './share-token-box';

export interface ShareLink {
  token: string;
  url: string;
}

export function shareLink(publicOrigin: string, token: string): ShareLink {
  return { token, url: `${publicOrigin}/k/${token}` };
}

/** The plan's current link from its sealed token; null when it was made before tokens were kept or cannot be opened. */
export function storedShareLink(box: ShareTokenBox, publicOrigin: string, plan: { id: string; shareTokenEnc: string | null }): ShareLink | null {
  const token = box.open(plan.shareTokenEnc, plan.id);
  return token === null ? null : shareLink(publicOrigin, token);
}
