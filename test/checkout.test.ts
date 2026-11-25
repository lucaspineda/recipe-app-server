import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FREE_PLAN, setup } from "./fakes";
import { HttpError } from "../src/billing/errors";
import {
  cancelSubscription,
  completeSubscription,
  confirmSubscription,
  createPortalSession,
  createSetupIntent,
} from "../src/billing/checkout";

const newUser = () => ({ u1: { email: "cook@example.com", plan: { ...FREE_PLAN } } });

async function rejectsWith(promise: Promise<unknown>, status: number): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError, `expected HttpError, got ${error}`);
    assert.equal(error.status, status);
    return error;
  }
  assert.fail(`expected an HttpError ${status}`);
}

describe("checkout", () => {
  it("creates one Stripe customer per user, with e-mail and Portuguese, and reuses it", async () => {
    const { store, fake, deps } = setup(newUser());
    const first = await createSetupIntent("u1", deps);
    const second = await createSetupIntent("u1", deps);

    assert.equal(first.customerId, second.customerId);
    assert.equal(fake.calls.filter((c) => c === "customers.create").length, 1);
    const customer = fake.customers.get(first.customerId);
    assert.equal(customer.email, "cook@example.com");
    assert.deepEqual(customer.preferred_locales, ["pt-BR"]);
    assert.equal(customer.metadata.uid, "u1");
    assert.equal(store.doc("u1").billing?.customerId, first.customerId);
  });

  it("charges the catalog price and grants the catalog plan, whatever plan the browser sends", async () => {
    const { store, fake, deps } = setup(newUser());
    const { customerId } = await createSetupIntent("u1", deps);
    // The old web app sends the whole plan object; a tampered one must not matter.
    const tampered = { id: 2, name: "Premium Plus", priceId: "price_plus", recipeCount: null, cost: 0.01 };

    const result = await confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", plan: tampered }, deps);

    assert.equal(result.status, "active");
    const sub = fake.subscriptions.get(result.subscriptionId);
    assert.equal(sub.items.data[0].price.id, "price_premium");
    assert.deepEqual(sub.metadata, { uid: "u1", planId: "2" });
    const user = store.doc("u1");
    assert.equal(user.plan?.planId, 2);
    assert.equal(user.plan?.name, "Premium");
    assert.equal(user.plan?.recipeCount, 40);
    assert.equal(user.plan?.toBeCanceled, false);
    assert.equal((user.plan?.expiresAt as Date).getTime(), sub.current_period_end * 1000);
    assert.equal(user.billing?.subscriptionId, sub.id);
    assert.equal(user.billing?.status, "active");
  });

  it("refuses the free plan and unknown plans", async () => {
    const { deps } = setup(newUser());
    const { customerId } = await createSetupIntent("u1", deps);
    await rejectsWith(confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 1 }, deps), 400);
    await rejectsWith(confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 99 }, deps), 400);
  });

  it("a declined card: clear message, no Premium, no subscription left behind", async () => {
    const { store, fake, deps } = setup(newUser());
    const { customerId } = await createSetupIntent("u1", deps);
    fake.nextPayment = "declined:insufficient_funds";

    const error = await rejectsWith(confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 2 }, deps), 402);

    assert.equal(error.body.code, "insufficient_funds");
    assert.match(String(error.body.message), /saldo insuficiente/);
    const [sub] = [...fake.subscriptions.values()];
    assert.equal(sub.status, "canceled");
    assert.equal(store.doc("u1").plan?.planId, 1);
    assert.equal(store.doc("u1").plan?.recipeCount, 3);
  });

  it("after a decline, a new attempt with the same card is tried again", async () => {
    const { store, fake, deps } = setup(newUser());
    const { customerId } = await createSetupIntent("u1", deps);
    fake.nextPayment = "declined:insufficient_funds";
    await rejectsWith(confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 2 }, deps), 402);

    fake.nextPayment = "succeeds";
    const result = await confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 2 }, deps);

    assert.equal(result.status, "active");
    assert.equal(fake.calls.filter((c) => c === "subscriptions.create").length, 2);
    assert.equal(store.doc("u1").plan?.planId, 2);
  });

  it("3-D Secure: Premium only once the bank confirms", async () => {
    const { store, fake, deps } = setup(newUser());
    const { customerId } = await createSetupIntent("u1", deps);
    fake.nextPayment = "requires_action";

    const pending = await confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 2 }, deps);
    assert.equal(pending.status, "requires_action");
    assert.equal(pending.status === "requires_action" && pending.clientSecret, "pi_secret_3ds");
    assert.equal(store.doc("u1").plan?.planId, 1);

    fake.completeAction(pending.subscriptionId);
    const done = await completeSubscription("u1", { subscriptionId: pending.subscriptionId }, deps);
    assert.equal(done.status, "active");
    assert.equal(store.doc("u1").plan?.planId, 2);
  });

  it("someone else's subscription can't be completed", async () => {
    const { fake, deps } = setup({ ...newUser(), u2: { plan: { ...FREE_PLAN } } });
    const { customerId } = await createSetupIntent("u1", deps);
    fake.nextPayment = "requires_action";
    const pending = await confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 2 }, deps);
    await rejectsWith(completeSubscription("u2", { subscriptionId: pending.subscriptionId }, deps), 404);
  });

  it("a double click creates one subscription", async () => {
    const { fake, deps } = setup(newUser());
    const { customerId } = await createSetupIntent("u1", deps);
    const body = { customerId, paymentMethodId: "pm_1", planId: 2 };

    const [a, b] = await Promise.all([confirmSubscription("u1", body, deps), confirmSubscription("u1", body, deps)]);

    assert.equal(a.subscriptionId, b.subscriptionId);
    assert.equal(fake.calls.filter((c) => c === "subscriptions.create").length, 1);
  });

  it("a second checkout while subscribed is refused", async () => {
    const { deps } = setup(newUser());
    const { customerId } = await createSetupIntent("u1", deps);
    await confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 2 }, deps);
    const error = await rejectsWith(confirmSubscription("u1", { customerId, paymentMethodId: "pm_2", planId: 3 }, deps), 409);
    assert.equal(error.body.code, "already_subscribed");
  });

  it("an abandoned 3-D Secure attempt is replaced by the next one", async () => {
    const { fake, deps } = setup(newUser());
    const { customerId } = await createSetupIntent("u1", deps);
    fake.nextPayment = "requires_action";
    const abandoned = await confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 2 }, deps);

    fake.nextPayment = "succeeds";
    const result = await confirmSubscription("u1", { customerId, paymentMethodId: "pm_2", planId: 2 }, deps);

    assert.equal(result.status, "active");
    assert.equal(fake.subscriptions.get(abandoned.subscriptionId).status, "canceled");
  });

  it("an older account that is already paying can't subscribe twice", async () => {
    const { fake, deps } = setup(newUser());
    const { customerId } = await createSetupIntent("u1", deps);
    // Created by the old backend, so billing.subscriptionId was never written.
    fake.addSubscription({ customer: customerId, price: "price_premium", metadata: { uid: "u1", plan: '{"id":2}' } });
    await rejectsWith(confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 2 }, deps), 409);
  });

  it("rejects a customer id that isn't the user's", async () => {
    const { deps } = setup(newUser());
    await createSetupIntent("u1", deps);
    await rejectsWith(confirmSubscription("u1", { customerId: "cus_other", paymentMethodId: "pm_1", planId: 2 }, deps), 400);
  });
});

describe("cancel", () => {
  it("cancels at the end of the paid period and keeps the plan until then", async () => {
    const { store, fake, deps } = setup(newUser());
    const { customerId } = await createSetupIntent("u1", deps);
    const { subscriptionId } = await confirmSubscription("u1", { customerId, paymentMethodId: "pm_1", planId: 2 }, deps);

    const result = await cancelSubscription("u1", deps);

    const sub = fake.subscriptions.get(subscriptionId);
    assert.equal(sub.cancel_at_period_end, true);
    assert.equal(sub.status, "active");
    assert.equal(result.cancelAt, new Date(sub.current_period_end * 1000).toISOString());
    assert.equal(store.doc("u1").plan?.planId, 2);
    assert.equal(store.doc("u1").plan?.toBeCanceled, true);
  });

  it("finds the subscription of an account created before billing.subscriptionId existed", async () => {
    const { store, fake, deps } = setup({ old: { plan: { planId: 2, name: "Premium", cost: 9.99, recipeCount: 12 } } });
    const sub = fake.addSubscription({ customer: "cus_old", price: "price_premium", metadata: { uid: "old", plan: '{"id":2}' } });

    await cancelSubscription("old", deps);

    assert.equal(fake.subscriptions.get(sub.id).cancel_at_period_end, true);
    assert.equal(store.doc("old").billing?.subscriptionId, sub.id);
  });

  it("says so when there is nothing to cancel", async () => {
    const { deps } = setup(newUser());
    const error = await rejectsWith(cancelSubscription("u1", deps), 404);
    assert.equal(error.body.code, "no_subscription");
  });

  it("can't cancel another user's subscription", async () => {
    const { fake, deps } = setup({ u1: { plan: { planId: 2 }, billing: { subscriptionId: "sub_x" } } });
    fake.addSubscription({ id: "sub_x", customer: "cus_2", price: "price_premium", metadata: { uid: "u2" } });
    await rejectsWith(cancelSubscription("u1", deps), 404);
    assert.equal(fake.subscriptions.get("sub_x").cancel_at_period_end, false);
  });
});

describe("customer portal", () => {
  it("only returns to our own site", async () => {
    const { fake, deps } = setup({ u1: { billing: { customerId: "cus_1" } } });
    await createPortalSession("u1", { returnUrl: "https://evil.example/phish" }, deps);
    await createPortalSession("u1", { returnUrl: "https://chefinhoia.com.br/dashboard" }, deps);
    assert.deepEqual(
      fake.calls.filter((c) => c.startsWith("billingPortal")),
      [
        "billingPortal.sessions.create https://chefinhoia.com.br/plans",
        "billingPortal.sessions.create https://chefinhoia.com.br/dashboard",
      ],
    );
  });
});
