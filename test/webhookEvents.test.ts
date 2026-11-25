import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { FREE_PLAN, setup } from "./fakes";
import { handleStripeEvent } from "../src/billing/webhookEvents";

const DAY = 86400;

function event(type: string, object: unknown): Stripe.Event {
  return { id: `evt_${type}`, type, data: { object } } as unknown as Stripe.Event;
}

function invoice(fields: Record<string, unknown>) {
  return { object: "invoice", amount_paid: 999, lines: { data: [] }, ...fields };
}

// A Premium user whose subscription sub_1 was created at checkout.
function premiumUser(periodEndSeconds: number, recipeCount = 40) {
  return {
    u1: {
      plan: { planId: 2, name: "Premium", cost: 9.99, recipeCount, expiresAt: new Date(periodEndSeconds * 1000), startedAt: new Date("2026-10-25T00:00:00Z") },
      billing: { customerId: "cus_1", subscriptionId: "sub_1", status: "active" },
    },
  };
}

describe("Stripe webhook events", () => {
  it("a renewal extends the plan and refills credits, once", async () => {
    const { store, fake, deps } = setup(premiumUser(1_780_000_000, 7));
    fake.addSubscription({ id: "sub_1", customer: "cus_1", price: "price_premium", metadata: { uid: "u1", planId: "2" } });
    const nextEnd = 1_780_000_000 + 30 * DAY;
    const renewal = event(
      "invoice.paid",
      invoice({ subscription: "sub_1", billing_reason: "subscription_cycle", lines: { data: [{ period: { end: nextEnd } }] } }),
    );

    await handleStripeEvent(renewal, deps);
    assert.equal(store.doc("u1").plan?.recipeCount, 40);
    assert.equal((store.doc("u1").plan?.expiresAt as Date).getTime(), nextEnd * 1000);

    // The user cooks, then Stripe delivers the same event again.
    await store.patchPlan("u1", { recipeCount: 39 });
    await handleStripeEvent(renewal, deps);
    assert.equal(store.doc("u1").plan?.recipeCount, 39);
  });

  it("the first invoice after checkout doesn't reset credits already used", async () => {
    const periodEnd = 1_780_000_000 + 30 * DAY;
    const { store, fake, deps } = setup(premiumUser(periodEnd, 38));
    fake.addSubscription({ id: "sub_1", customer: "cus_1", price: "price_premium", metadata: { uid: "u1", planId: "2" } });

    await handleStripeEvent(
      event("invoice.paid", invoice({ subscription: "sub_1", billing_reason: "subscription_create", lines: { data: [{ period: { end: periodEnd } }] } })),
      deps,
    );
    assert.equal(store.doc("u1").plan?.recipeCount, 38);
  });

  it("reads the subscription from newer API payloads too", async () => {
    const { store, fake, deps } = setup(premiumUser(1_780_000_000, 5));
    fake.addSubscription({ id: "sub_1", customer: "cus_1", price: "price_premium", metadata: { uid: "u1" } });
    const nextEnd = 1_780_000_000 + 30 * DAY;

    await handleStripeEvent(
      event(
        "invoice.paid",
        invoice({ parent: { subscription_details: { subscription: "sub_1" } }, billing_reason: "subscription_cycle", lines: { data: [{ period: { end: nextEnd } }] } }),
      ),
      deps,
    );
    assert.equal(store.doc("u1").plan?.recipeCount, 40);
  });

  it("the Stripe price decides the plan, not the metadata", async () => {
    const { store, fake, deps } = setup({ u1: { plan: { ...FREE_PLAN }, billing: { customerId: "cus_1" } } });
    // Subscriptions from the old backend carry the browser's plan object in metadata.
    fake.addSubscription({ id: "sub_1", customer: "cus_1", price: "price_premium", metadata: { uid: "u1", plan: '{"id":3,"recipeCount":null}' } });

    await handleStripeEvent(event("invoice.paid", invoice({ subscription: "sub_1", billing_reason: "subscription_create" })), deps);
    assert.equal(store.doc("u1").plan?.planId, 2);
    assert.equal(store.doc("u1").plan?.recipeCount, 40);
  });

  it("a failed renewal marks the payment problem and keeps the plan", async () => {
    const { store, fake, deps, now } = setup(premiumUser(1_780_000_000));
    fake.addSubscription({ id: "sub_1", customer: "cus_1", price: "price_premium", metadata: { uid: "u1" } });
    const retryAt = 1_780_000_000 + 3 * DAY;

    await handleStripeEvent(
      event("invoice.payment_failed", invoice({ subscription: "sub_1", billing_reason: "subscription_cycle", next_payment_attempt: retryAt })),
      deps,
    );

    const user = store.doc("u1");
    assert.equal(user.billing?.status, "past_due");
    assert.equal(user.billing?.paymentFailedAt?.getTime(), now.getTime());
    assert.equal(user.billing?.nextPaymentAttemptAt?.getTime(), retryAt * 1000);
    assert.equal(user.plan?.planId, 2);

    // When a retry succeeds, the problem is cleared.
    await handleStripeEvent(
      event("invoice.paid", invoice({ subscription: "sub_1", billing_reason: "subscription_cycle", lines: { data: [{ period: { end: retryAt + 30 * DAY } }] } })),
      deps,
    );
    assert.equal(store.doc("u1").billing?.status, "active");
    assert.equal(store.doc("u1").billing?.paymentFailedAt, null);
  });

  it("a failed first payment is left to the checkout", async () => {
    const { store, fake, deps } = setup(premiumUser(1_780_000_000));
    fake.addSubscription({ id: "sub_1", customer: "cus_1", price: "price_premium", metadata: { uid: "u1" } });
    const outcome = await handleStripeEvent(
      event("invoice.payment_failed", invoice({ subscription: "sub_1", billing_reason: "subscription_create" })),
      deps,
    );
    assert.match(outcome, /^ignored/);
    assert.equal(store.doc("u1").billing?.status, "active");
  });

  it("cancel at period end, set in the app or the Stripe dashboard, shows in the app", async () => {
    const { store, fake, deps } = setup(premiumUser(1_780_000_000));
    const sub = fake.addSubscription({ id: "sub_1", customer: "cus_1", price: "price_premium", metadata: { uid: "u1" } });

    await handleStripeEvent(event("customer.subscription.updated", { ...sub, cancel_at_period_end: true, cancel_at: sub.current_period_end }), deps);

    assert.equal(store.doc("u1").plan?.toBeCanceled, true);
    assert.equal(store.doc("u1").billing?.cancelAt?.getTime(), sub.current_period_end * 1000);
  });

  it("when the subscription ends, the user goes back to Básico", async () => {
    const { store, fake, deps } = setup(premiumUser(1_780_000_000));
    const sub = fake.addSubscription({ id: "sub_1", customer: "cus_1", price: "price_premium", metadata: { uid: "u1" } });
    sub.status = "canceled";

    await handleStripeEvent(event("customer.subscription.deleted", sub), deps);

    const user = store.doc("u1");
    assert.equal(user.plan?.planId, 1);
    assert.equal(user.plan?.name, "Básico");
    assert.equal(user.plan?.recipeCount, 3);
    assert.equal(user.billing?.status, "canceled");
    assert.equal(user.billing?.subscriptionId, null);
  });

  it("an old subscription ending doesn't touch the current one", async () => {
    const { store, fake, deps } = setup(premiumUser(1_780_000_000));
    const old = fake.addSubscription({ id: "sub_old", customer: "cus_1", price: "price_premium", metadata: { uid: "u1" }, status: "canceled" });
    await handleStripeEvent(event("customer.subscription.deleted", old), deps);
    assert.equal(store.doc("u1").plan?.planId, 2);
  });

  it("an older account keeps its plan if another subscription is still active", async () => {
    const { store, fake, deps } = setup({ u1: { plan: { planId: 2, name: "Premium", recipeCount: 10 } } });
    fake.addSubscription({ id: "sub_a", customer: "cus_1", price: "price_premium", metadata: { uid: "u1" } });
    const ended = fake.addSubscription({ id: "sub_b", customer: "cus_1", price: "price_premium", metadata: { uid: "u1" }, status: "canceled" });

    const outcome = await handleStripeEvent(event("customer.subscription.deleted", ended), deps);
    assert.match(outcome, /another active subscription/);
    assert.equal(store.doc("u1").plan?.planId, 2);
  });

  it("a declined checkout's canceled subscription doesn't reset a free user's credits", async () => {
    const { store, fake, deps } = setup({ u1: { plan: { ...FREE_PLAN, recipeCount: 0 }, billing: { customerId: "cus_1", subscriptionId: "sub_1", status: "canceled" } } });
    const sub = fake.addSubscription({ id: "sub_1", customer: "cus_1", price: "price_premium", metadata: { uid: "u1" }, status: "canceled" });
    await handleStripeEvent(event("customer.subscription.deleted", sub), deps);
    assert.equal(store.doc("u1").plan?.recipeCount, 0);
  });

  it("ignores events it doesn't handle, and subscriptions without a uid", async () => {
    const { fake, deps } = setup();
    assert.equal(await handleStripeEvent(event("charge.succeeded", {}), deps), "ignored charge.succeeded");
    const sub = fake.addSubscription({ id: "sub_x", customer: "cus_x", price: "price_premium", metadata: {} });
    assert.match(await handleStripeEvent(event("customer.subscription.deleted", sub), deps), /without a uid/);
  });
});
