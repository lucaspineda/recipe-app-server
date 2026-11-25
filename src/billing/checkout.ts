import type Stripe from "stripe";
import { BillingDeps, CatalogPlan, UserDoc } from "./types";
import { HttpError, declineMessage } from "./errors";
import { grantPaidPlan, resolvePlan } from "./access";
import { LIVE_STATUSES, idOf, subscriptionPeriodEnd, toDate } from "./stripeObjects";

const clock = (deps: BillingDeps) => (deps.now ? deps.now() : new Date());

const ALLOWED_RETURN_ORIGINS = ["https://chefinhoia.com.br", "https://www.chefinhoia.com.br"];

// Only send people back to our own site (or a local dev server).
export function safeReturnUrl(candidate: unknown, fallbackPath: string): string {
  if (typeof candidate === "string") {
    try {
      const url = new URL(candidate);
      if (ALLOWED_RETURN_ORIGINS.includes(url.origin) || url.hostname === "localhost") return url.toString();
    } catch {
      // not a URL
    }
  }
  return `${ALLOWED_RETURN_ORIGINS[0]}${fallbackPath}`;
}

async function paidPlanFrom(body: any, deps: BillingDeps): Promise<CatalogPlan> {
  // The web app used to send the whole plan object; only its id is read now.
  const planId = Number(body?.planId ?? body?.plan?.id);
  const plan = Number.isFinite(planId) && planId > 0 ? await deps.store.getPlanById(planId) : null;
  if (!plan || !plan.priceId || !(plan.cost > 0)) {
    throw new HttpError(400, { code: "invalid_plan", message: "Plano inválido." });
  }
  return plan;
}

// Reuses the user's Stripe customer, so retries don't create a new customer each time.
async function ensureCustomer(uid: string, user: UserDoc | null, deps: BillingDeps): Promise<string> {
  const existing = user?.billing?.customerId;
  if (existing) {
    try {
      const customer = await deps.stripe.customers.retrieve(existing);
      if (!("deleted" in customer && customer.deleted) && customer.metadata?.uid === uid) return existing;
    } catch (error: any) {
      if (error?.code !== "resource_missing") throw error;
    }
  }
  const customer = await deps.stripe.customers.create({
    metadata: { uid },
    // Stripe sends receipts and failed-payment e-mails to this address, in Portuguese.
    ...(user?.email ? { email: user.email } : {}),
    preferred_locales: ["pt-BR"],
  });
  await deps.store.patchBilling(uid, { customerId: customer.id });
  return customer.id;
}

// An earlier attempt that is still waiting for the bank's confirmation is replaced; a live one blocks.
async function assertNoLiveSubscription(uid: string, user: UserDoc | null, deps: BillingDeps): Promise<void> {
  const subscriptionId = await findSubscriptionId(uid, user, deps);
  if (!subscriptionId) return;
  let subscription: Stripe.Subscription;
  try {
    subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
  } catch (error: any) {
    if (error?.code === "resource_missing") return;
    throw error;
  }
  if (LIVE_STATUSES.includes(subscription.status)) {
    throw new HttpError(409, { code: "already_subscribed", message: "Você já tem uma assinatura ativa." });
  }
  if (subscription.status === "incomplete") await deps.stripe.subscriptions.cancel(subscriptionId);
}

type SettleResult =
  | { status: "active"; subscriptionId: string }
  | { status: "requires_action"; subscriptionId: string; clientSecret: string };

// Premium is granted here only when Stripe says the subscription is active, i.e. the first payment went through.
async function settle(uid: string, plan: CatalogPlan, subscription: Stripe.Subscription, deps: BillingDeps): Promise<SettleResult> {
  await deps.store.patchBilling(uid, { subscriptionId: subscription.id, status: subscription.status });

  if (subscription.status === "active" || subscription.status === "trialing") {
    await grantPaidPlan(deps.store, uid, plan, {
      subscriptionId: subscription.id,
      periodEnd: subscriptionPeriodEnd(subscription),
      now: clock(deps),
    });
    return { status: "active", subscriptionId: subscription.id };
  }

  const invoice = subscription.latest_invoice && typeof subscription.latest_invoice === "object" ? subscription.latest_invoice : null;
  const paymentIntent = invoice && invoice.payment_intent && typeof invoice.payment_intent === "object" ? invoice.payment_intent : null;

  if (
    subscription.status === "incomplete" &&
    paymentIntent?.client_secret &&
    (paymentIntent.status === "requires_action" || paymentIntent.status === "requires_confirmation")
  ) {
    // The bank wants 3-D Secure; the browser finishes it with stripe.confirmCardPayment.
    return { status: "requires_action", subscriptionId: subscription.id, clientSecret: paymentIntent.client_secret };
  }

  // Declined. Don't leave an unpaid subscription behind.
  const code = paymentIntent?.last_payment_error?.decline_code ?? paymentIntent?.last_payment_error?.code ?? null;
  if (subscription.status === "incomplete") await deps.stripe.subscriptions.cancel(subscription.id);
  // Keeping the canceled id also changes the idempotency key, so a retry with the same card makes a new attempt.
  await deps.store.patchBilling(uid, { subscriptionId: subscription.id, status: "canceled" });
  throw new HttpError(402, { code: code ?? "card_declined", status: "declined", message: declineMessage(code) });
}

export async function createSetupIntent(uid: string, deps: BillingDeps) {
  const user = await deps.store.getUser(uid);
  const customerId = await ensureCustomer(uid, user, deps);
  const setupIntent = await deps.stripe.setupIntents.create({
    customer: customerId,
    usage: "off_session",
    payment_method_types: ["card"],
  });
  return { clientSecret: setupIntent.client_secret, customerId };
}

export async function confirmSubscription(uid: string, body: any, deps: BillingDeps): Promise<SettleResult> {
  const paymentMethodId = typeof body?.paymentMethodId === "string" ? body.paymentMethodId : null;
  if (!paymentMethodId) throw new HttpError(400, { code: "invalid_request", message: "Cartão não informado." });
  const plan = await paidPlanFrom(body, deps);

  const user = await deps.store.getUser(uid);
  const customerId = user?.billing?.customerId;
  if (!customerId || (body?.customerId && body.customerId !== customerId)) {
    throw new HttpError(400, { code: "invalid_customer", message: "Comece o pagamento de novo." });
  }
  await assertNoLiveSubscription(uid, user, deps);

  // confirmCardSetup already attached the card to this customer; attach only if it isn't.
  const paymentMethod = await deps.stripe.paymentMethods.retrieve(paymentMethodId);
  const owner = idOf(paymentMethod.customer as string | Stripe.Customer | null);
  if (owner && owner !== customerId) throw new HttpError(400, { code: "invalid_payment_method", message: "Cartão inválido." });
  if (!owner) await deps.stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  await deps.stripe.customers.update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } });

  const subscription = await deps.stripe.subscriptions.create(
    {
      customer: customerId,
      items: [{ price: plan.priceId }],
      default_payment_method: paymentMethodId,
      payment_behavior: "allow_incomplete",
      metadata: { uid, planId: String(plan.id) },
      expand: ["latest_invoice.payment_intent"],
    },
    // A double click or a network retry returns the same subscription instead of creating a second one.
    // The previous subscription id is part of the key, so a new attempt after a replaced one isn't blocked.
    { idempotencyKey: `subscribe:${uid}:${paymentMethodId}:${plan.id}:${user?.billing?.subscriptionId ?? "none"}` },
  );
  return settle(uid, plan, subscription, deps);
}

// Called by the browser after stripe.confirmCardPayment finishes 3-D Secure.
export async function completeSubscription(uid: string, body: any, deps: BillingDeps): Promise<SettleResult> {
  const subscriptionId = typeof body?.subscriptionId === "string" ? body.subscriptionId : null;
  if (!subscriptionId) throw new HttpError(400, { code: "invalid_request", message: "Assinatura não informada." });

  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice.payment_intent"] });
  if (subscription.metadata?.uid !== uid) throw new HttpError(404, { code: "not_found", message: "Assinatura não encontrada." });
  const plan = await resolvePlan(deps.store, subscription);
  if (!plan) throw new Error(`No plan matches subscription ${subscriptionId}`);
  return settle(uid, plan, subscription, deps);
}

// Accounts from before this change have no billing.subscriptionId; find their subscription by uid.
async function findSubscriptionId(uid: string, user: UserDoc | null, deps: BillingDeps): Promise<string | null> {
  if (user?.billing?.subscriptionId) return user.billing.subscriptionId;
  if (!/^[A-Za-z0-9_-]+$/.test(uid)) return null;
  const found = await deps.stripe.subscriptions.search({ query: `metadata['uid']:'${uid}' AND status:'active'`, limit: 1 });
  return found.data[0]?.id ?? null;
}

// "Cancelar meu plano": the plan stays until the end of the paid period, then Stripe ends the subscription
// and the customer.subscription.deleted webhook moves the user to Básico.
export async function cancelSubscription(uid: string, deps: BillingDeps) {
  const user = await deps.store.getUser(uid);
  const subscriptionId = await findSubscriptionId(uid, user, deps);
  if (!subscriptionId) throw new HttpError(404, { code: "no_subscription", message: "Não encontramos uma assinatura ativa." });

  const subscription = await deps.stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.metadata?.uid !== uid) throw new HttpError(404, { code: "no_subscription", message: "Não encontramos uma assinatura ativa." });
  if (!LIVE_STATUSES.includes(subscription.status)) {
    throw new HttpError(409, { code: "not_active", message: "Esta assinatura já foi encerrada." });
  }

  const updated = subscription.cancel_at_period_end
    ? subscription
    : await deps.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  const cancelAt = toDate(updated.cancel_at) ?? subscriptionPeriodEnd(updated);

  await deps.store.patchPlan(uid, { toBeCanceled: true });
  await deps.store.patchBilling(uid, { subscriptionId, status: updated.status, cancelAt });
  return { cancelAt: cancelAt ? cancelAt.toISOString() : null };
}

// Stripe's customer portal, to update the card after a failed payment.
export async function createPortalSession(uid: string, body: any, deps: BillingDeps) {
  const user = await deps.store.getUser(uid);
  let customerId = user?.billing?.customerId ?? null;
  if (!customerId) {
    const subscriptionId = await findSubscriptionId(uid, user, deps);
    if (subscriptionId) customerId = idOf((await deps.stripe.subscriptions.retrieve(subscriptionId)).customer);
  }
  if (!customerId) throw new HttpError(404, { code: "no_customer", message: "Não encontramos seus dados de pagamento." });

  const session = await deps.stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: safeReturnUrl(body?.returnUrl, "/plans"),
    locale: "pt-BR",
  });
  return { url: session.url };
}

// Older Stripe Checkout flow (POST /subscription/subscribe). The web app doesn't call it today.
export async function createCheckoutSession(uid: string, body: any, origin: string | undefined, deps: BillingDeps) {
  const plan = await paidPlanFrom(body, deps);
  const user = await deps.store.getUser(uid);
  const customerId = await ensureCustomer(uid, user, deps);
  const session = await deps.stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: plan.priceId, quantity: 1 }],
    subscription_data: { metadata: { uid, planId: String(plan.id) } },
    success_url: safeReturnUrl(origin ? `${origin}/plans/thank-you` : null, "/plans/thank-you"),
    cancel_url: safeReturnUrl(origin ? `${origin}/plans` : null, "/plans"),
  });
  return { url: session.url };
}
