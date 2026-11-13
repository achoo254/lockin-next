/**
 * Everything Lockin keeps for an account deleted at the IdP (auth-next ADR 0018), removed in one transaction:
 *
 * - the account row (name, email, picture) and, by cascade, its sessions;
 * - the plans it owns (`creator_sub`): a plan nobody else joined is deleted with its options, votes and log; a plan
 *   others joined is handed to the guest who joined first (guests are the only other role, so the earliest joiner
 *   wins), so the group keeps its plan, its votes and its link.
 *
 * On a handed-over plan the deleted creator's own row goes with its votes and RSVP: a plan counts who is coming, and a
 * deleted account is not, so keeping its ballots anonymously would skew the group's choice. The heir's guest row becomes
 * the creator row and its guest token becomes the plan's creator token: its browser already holds that token in the
 * plan's guest cookie, and guest-routes.ts turns it into the creator cookie on its next visit (sealHandedOverToken
 * then keeps the manage link of that token, so the heir sees it like any creator). The old manage link and every
 * creator cookie of the old token stop working.
 *
 * Guests are browser tokens, never accounts, so the account has no guest rows in other people's plans to find.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { participants, plans, users } from '../db/schema';
import type { PlanRow } from './plan-store';
import { manageSealContext } from './share-link';
import type { ShareTokenBox } from './share-token-box';
import { hashToken } from './tokens';

export interface DeletedAccountData {
  /** The account's internal id; null when only plans were left (no account row). */
  userId: string | null;
  deletedPlans: number;
  handedOverPlans: number;
}

/** Deletes the data of `sub`; null when Lockin holds nothing for it (never signed in here, or already deleted). */
export async function deleteAccountData(db: Db, sub: string, now: Date): Promise<DeletedAccountData | null> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.sub, sub)).for('update');
    const owned = await tx.select({ id: plans.id }).from(plans).where(eq(plans.creatorSub, sub)).for('update');
    if (!user && owned.length === 0) return null;

    let deletedPlans = 0;
    let handedOverPlans = 0;
    for (const { id: planId } of owned) {
      const [heir] = await tx
        .select({ id: participants.id, guestTokenHash: participants.guestTokenHash })
        .from(participants)
        .where(and(eq(participants.planId, planId), eq(participants.isCreator, false)))
        .orderBy(asc(participants.joinedAt), asc(participants.id))
        .limit(1);
      if (!heir?.guestTokenHash) {
        await tx.delete(plans).where(eq(plans.id, planId));
        deletedPlans++;
        continue;
      }
      // The old creator row first: one creator per plan, and a guest row turning creator must drop its guest token.
      await tx.delete(participants).where(and(eq(participants.planId, planId), eq(participants.isCreator, true)));
      await tx.update(participants).set({ isCreator: true, guestTokenHash: null, creatorSub: null }).where(eq(participants.id, heir.id));
      await tx
        .update(plans)
        .set({ creatorSub: null, creatorTokenHash: heir.guestTokenHash, manageTokenEnc: null, updatedAt: now })
        .where(eq(plans.id, planId));
      handedOverPlans++;
    }
    if (user) await tx.delete(users).where(eq(users.id, user.id));
    return { userId: user?.id ?? null, deletedPlans, handedOverPlans };
  });
}

/**
 * The heir of a handed-over plan is back with its token (now the plan's creator token): its sealed copy is kept, as
 * for any plan made signed out, so the creator sees the manage link and can change it. Returns the plan as stored.
 */
export async function sealHandedOverToken(db: Db, plan: PlanRow, creatorToken: string, box: ShareTokenBox): Promise<PlanRow> {
  if (plan.manageTokenEnc !== null) return plan;
  const [row] = await db
    .update(plans)
    .set({ manageTokenEnc: box.seal(creatorToken, manageSealContext(plan.id)) })
    .where(and(eq(plans.id, plan.id), eq(plans.creatorTokenHash, hashToken(creatorToken)), isNull(plans.manageTokenEnc)))
    .returning();
  return row ?? plan;
}
