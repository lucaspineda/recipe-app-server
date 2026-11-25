import type Stripe from "stripe";
import { BillingDeps } from "./types";
import { downgradeToFree, grantPaidPlan, isPaidPlan, resolvePlan } from "./access";
import { idOf, invoicePeriodEnd, invoiceSubscriptionId, subscriptionPeriodEnd, toDate } from "./stripeObjects";

// Applies one verified Stripe event to Firestore and returns a short outcome for the logs.
// Every branch can run twice for the same event without changing the result.
export async function handleStripeEvent(event: Stripe.Event, deps: BillingDeps): Promise<string> {
  switch (event.type) {
    case "invoice.paid":
      return onInvoicePaid(event.data.object as Stripe.Invoice, deps);
    case "invoice.payment_failed":
      return onInvoicePaymentFailed(event.data.object as Stripe.Invoice, deps);
    case "customer.subscription.updated":
      return onSubscriptionUpdated(event.data.object as Stripe.Subscription, deps);
    case "customer.subscription.deleted":
      return onSubscriptionDeleted(event.data.object as Stripe.Subscription, deps);
    default:
      return `ignored ${event.type}`;
  }
}

const clock = (deps: BillingDeps) => (deps.now ? deps.now() : new Date());

// First payment and every renewal: extend the plan to the end of the paid period, refill credits.
async function onInvoicePaid(invoice: Stripe.Invoice, deps: BillingDeps): Promise<string> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return "ignored: invoice without a subscription";

  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
  const uid = subscription.metadata?.uid;
  if (!uid) return "ignored: subscription without a uid";
  if (!(await deps.store.getUser(uid))) return `ignored: no user ${uid}`;

  const plan = await resolvePlan(deps.store, subscription);
  if (!plan) {
    console.error(`invoice.paid: no plan matches subscription ${subscriptionId}`);
    return "ignored: unknown plan";
  }

  await grantPaidPlan(deps.store, uid, plan, {
    subscriptionId,
    periodEnd: invoicePeriodEnd(invoice) ?? subscriptionPeriodEnd(subscription),
    now: clock(deps),
  });
  return `granted plan ${plan.id} to ${uid}`;
}

// A renewal failed. Stripe keeps retrying for about two weeks; the user keeps the plan meanwhile and the
// app shows a banner. The first payment is handled at checkout, so it's skipped here.
async function onInvoicePaymentFailed(invoice: Stripe.Invoice, deps: BillingDeps): Promise<string> {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return "ignored: invoice without a subscription";
  if (invoice.billing_reason === "subscription_create") return "ignored: first payment (handled at checkout)";

  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
  const uid = subscription.metadata?.uid;
  if (!uid) return "ignored: subscription without a uid";
  const user = await deps.store.getUser(uid);
  if (!user) return `ignored: no user ${uid}`;
  const current = user.billing?.subscriptionId;
  if (current && current !== subscriptionId) return "ignored: not the user's current subscription";

  await deps.store.patchBilling(uid, {
    subscriptionId,
    status: "past_due",
    paymentFailedAt: clock(deps),
    nextPaymentAttemptAt: toDate(invoice.next_payment_attempt),
  });
  return `marked ${uid} past_due`;
}

// Keeps "cancel at period end" and the status in sync, including changes made in the Stripe dashboard.
async function onSubscriptionUpdated(subscription: Stripe.Subscription, deps: BillingDeps): Promise<string> {
  const uid = subscription.metadata?.uid;
  if (!uid) return "ignored: subscription without a uid";
  const user = await deps.store.getUser(uid);
  if (!user) return `ignored: no user ${uid}`;
  if (user.billing?.subscriptionId !== subscription.id) return "ignored: not the user's current subscription";

  const cancelAtPeriodEnd = subscription.cancel_at_period_end === true;
  if (isPaidPlan(user.plan?.planId)) await deps.store.patchPlan(uid, { toBeCanceled: cancelAtPeriodEnd });
  await deps.store.patchBilling(uid, {
    status: subscription.status,
    cancelAt: cancelAtPeriodEnd ? (toDate(subscription.cancel_at) ?? subscriptionPeriodEnd(subscription)) : null,
  });
  return `synced ${uid}: ${subscription.status}${cancelAtPeriodEnd ? ", cancels at period end" : ""}`;
}

// The subscription is over (canceled, or Stripe gave up after the retries): back to Básico.
async function onSubscriptionDeleted(subscription: Stripe.Subscription, deps: BillingDeps): Promise<string> {
  const uid = subscription.metadata?.uid;
  if (!uid) return "ignored: subscription without a uid";
  const user = await deps.store.getUser(uid);
  if (!user) return `ignored: no user ${uid}`;

  // Also covers declined checkouts, whose incomplete subscription is canceled right away.
  if (!isPaidPlan(user.plan?.planId)) return "ignored: already on the free plan";
  const current = user.billing?.subscriptionId;
  if (current && current !== subscription.id) return "ignored: not the user's current subscription";

  // Accounts from before this change have no billing.subscriptionId: make sure nothing else is still paid.
  const customerId = idOf(subscription.customer);
  if (customerId) {
    const others = await deps.stripe.subscriptions.list({ customer: customerId, status: "active", limit: 1 });
    if (others.data.some((s) => s.id !== subscription.id)) return "ignored: the customer has another active subscription";
  }

  await downgradeToFree(deps.store, uid, clock(deps));
  return `downgraded ${uid} to the free plan`;
}
