/**
 * The links of a plan: the share link the creator sends to the group (PUBLIC_URL/k/<token>), and the private manage
 * link that hands the creator's rights to whichever browser opens it (PUBLIC_URL/m/<plan id>.<creator token>).
 */
import type { ShareTokenBox } from './share-token-box';

export interface ShareLink {
  token: string;
  url: string;
}

export interface ManageLink {
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

/** The sealing context of a manage token: unlike a share token's (the bare plan id), so neither opens as the other. */
export const manageSealContext = (planId: string): string => `manage:${planId}`;

export function manageLink(publicOrigin: string, planId: string, creatorToken: string): ManageLink {
  return { url: `${publicOrigin}/m/${planId}.${creatorToken}` };
}

/** The plan's manage link from its sealed creator token; null for a plan made before creator tokens. */
export function storedManageLink(box: ShareTokenBox, publicOrigin: string, plan: { id: string; manageTokenEnc: string | null }): ManageLink | null {
  const token = box.open(plan.manageTokenEnc, manageSealContext(plan.id));
  return token === null ? null : manageLink(publicOrigin, plan.id, token);
}
