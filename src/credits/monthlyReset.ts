import { toMillis } from "../billing/access";
import type { UserPlanDoc } from "../billing/types";

// Free accounts get 3 recipes every 30 days, counted per user from their last reset.
// plan.updatedAt marks the last reset (signup and every plan change set it too); plan.startedAt is the
// fallback. Paid plans are refilled by the Stripe invoice.paid webhook instead.
export const FREE_PLAN_ID = 1;
export const FREE_MONTHLY_RECIPES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
export const RESET_INTERVAL_MS = 30 * DAY_MS;
// The job runs once a day at about the same time, so a reset written at 06:00:04 is checked again at
// 06:00:01 thirty days later. Without this slack each reset would slip a day.
export const RESET_SLACK_MS = 60 * 60 * 1000;

export type ResetDecision = { due: false } | { due: true; recipeCount: number };

export function decideReset(plan: UserPlanDoc | undefined, now: Date): ResetDecision {
  if (!plan || Number(plan.planId) !== FREE_PLAN_ID) return { due: false };

  const lastReset = toMillis(plan.updatedAt) ?? toMillis(plan.startedAt);
  if (lastReset !== null && now.getTime() - lastReset < RESET_INTERVAL_MS - RESET_SLACK_MS) return { due: false };

  const current = typeof plan.recipeCount === "number" && Number.isFinite(plan.recipeCount) ? plan.recipeCount : 0;
  // Recipes above the monthly amount (the survey bonus) are kept.
  return { due: true, recipeCount: Math.max(current, FREE_MONTHLY_RECIPES) };
}

export interface ResetCandidate {
  uid: string;
  plan: UserPlanDoc | undefined;
  /** The document's version when it was read; the write is skipped if it changed since. */
  version?: unknown;
}

export interface CreditsResetStore {
  /** Every users/{uid} document's plan. */
  users(): AsyncIterable<ResetCandidate>;
  /** Writes the reset. Resolves false, writing nothing, if the document changed after it was read. */
  reset(candidate: ResetCandidate, fields: { recipeCount: number; updatedAt: Date }): Promise<boolean>;
  /** Sends any queued writes and waits for them. */
  close(): Promise<void>;
}

export interface ResetSummary {
  dryRun: boolean;
  scanned: number;
  free: number;
  /** Free accounts whose last reset was 30 or more days ago */
  due: number;
  /** Due accounts that had fewer than 3 recipes */
  raised: number;
  /** Due accounts that already had 3 or more: only the reset date moves */
  kept: number;
  written: number;
  /** Skipped because the user changed the document meanwhile; the next run picks them up */
  changed: number;
  failed: number;
}

export async function resetFreeCredits(
  store: CreditsResetStore,
  options: { now: Date; dryRun: boolean },
): Promise<ResetSummary> {
  const summary: ResetSummary = {
    dryRun: options.dryRun,
    scanned: 0,
    free: 0,
    due: 0,
    raised: 0,
    kept: 0,
    written: 0,
    changed: 0,
    failed: 0,
  };
  const writes: Promise<void>[] = [];

  for await (const candidate of store.users()) {
    summary.scanned++;
    if (Number(candidate.plan?.planId) === FREE_PLAN_ID) summary.free++;

    const decision = decideReset(candidate.plan, options.now);
    if (!decision.due) continue;
    summary.due++;
    const before = candidate.plan?.recipeCount;
    if (typeof before === "number" && before >= decision.recipeCount) summary.kept++;
    else summary.raised++;
    if (options.dryRun) continue;

    writes.push(
      store.reset(candidate, { recipeCount: decision.recipeCount, updatedAt: options.now }).then(
        (written) => {
          if (written) summary.written++;
          else summary.changed++;
        },
        (error) => {
          summary.failed++;
          console.error(`[credits-reset] write failed for ${candidate.uid}:`, error);
        },
      ),
    );
  }

  // Queued writes may only be sent on close, so close before waiting for them.
  await store.close();
  await Promise.all(writes);
  return summary;
}
