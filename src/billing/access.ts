import type Stripe from "stripe";
import { BillingStore, CatalogPlan } from "./types";
import { subscriptionPriceId } from "./stripeObjects";

const FREE_PLAN_ID = 1;

// A Firestore Timestamp, a Date, or a serialized { seconds } value, in milliseconds.
export function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const v = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof v.toMillis === "function") return v.toMillis();
  const seconds = v.seconds ?? v._seconds;
  return typeof seconds === "number" ? seconds * 1000 : null;
}

function sameInstant(a: unknown, b: Date | null): boolean {
  const ms = toMillis(a);
  return ms !== null && b !== null && Math.abs(ms - b.getTime()) < 1000;
}

// The plan a subscription pays for. The Stripe price decides; metadata is only a fallback.
export async function resolvePlan(store: BillingStore, subscription: Stripe.Subscription): Promise<CatalogPlan | null> {
  const priceId = subscriptionPriceId(subscription);
  if (priceId) {
    const byPrice = await store.getPlanByPriceId(priceId);
    if (byPrice) return byPrice;
  }
  const metadataId = Number(subscription.metadata?.planId);
  if (Number.isFinite(metadataId) && metadataId > 0) {
    const byId = await store.getPlanById(metadataId);
    if (byId) return byId;
  }
  // Subscriptions created before this change carry the browser's plan object; only its id is used.
  try {
    const legacyId = Number(JSON.parse(subscription.metadata?.plan ?? "null")?.id);
    if (Number.isFinite(legacyId) && legacyId > 0) return await store.getPlanById(legacyId);
  } catch {
    // not JSON
  }
  return null;
}

// Gives the user a paid plan until periodEnd. Credits are refilled when a new billing period starts,
// so a repeated webhook for the same period doesn't hand out credits twice.
export async function grantPaidPlan(
  store: BillingStore,
  uid: string,
  plan: CatalogPlan,
  options: { subscriptionId: string; periodEnd: Date | null; now: Date },
): Promise<void> {
  const user = await store.getUser(uid);
  const current = user?.plan;
  const sameSubscription = user?.billing?.subscriptionId === options.subscriptionId && Number(current?.planId) === plan.id;
  const samePeriod = sameSubscription && sameInstant(current?.expiresAt, options.periodEnd);
  const currentCount = current?.recipeCount;

  await store.setPlan(uid, {
    planId: plan.id,
    name: plan.name,
    cost: plan.cost,
    recipeCount: samePeriod && currentCount !== undefined ? currentCount : plan.recipeCount,
    startedAt: sameSubscription && current?.startedAt ? current.startedAt : options.now,
    updatedAt: options.now,
    expiresAt: options.periodEnd,
    toBeCanceled: sameSubscription ? current?.toBeCanceled === true : false,
  });
  await store.patchBilling(uid, {
    subscriptionId: options.subscriptionId,
    status: "active",
    paymentFailedAt: null,
    nextPaymentAttemptAt: null,
  });
}

// Back to Básico, with the same shape the web app writes at signup.
export async function downgradeToFree(store: BillingStore, uid: string, now: Date): Promise<void> {
  const free = await store.getPlanById(FREE_PLAN_ID);
  await store.setPlan(uid, {
    planId: FREE_PLAN_ID,
    name: free?.name || "Básico",
    cost: 0,
    recipeCount: free?.recipeCount ?? 3,
    startedAt: now,
    updatedAt: now,
  });
  await store.patchBilling(uid, {
    subscriptionId: null,
    status: "canceled",
    endedAt: now,
    cancelAt: null,
    paymentFailedAt: null,
    nextPaymentAttemptAt: null,
  });
}

export function isPaidPlan(planId: unknown): boolean {
  return Number(planId) >= 2;
}
