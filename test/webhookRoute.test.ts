import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import Stripe from "stripe";

// The real Express app, with keys from the environment instead of Secret Manager.
process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_signature_checks";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

describe("POST /webhook on the real app", () => {
  let server: Server;
  let url: string;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  // An event type the handler ignores, so the test never reaches Firestore.
  const payload = JSON.stringify({ id: "evt_test", object: "event", type: "charge.succeeded", data: { object: {} } });

  before(async () => {
    const { default: app } = await import("../src/app");
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;
  });

  after(() => server.close());

  const post = (body: string, headers: Record<string, string>) =>
    fetch(url, { method: "POST", body, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

  it("accepts an event signed with the endpoint secret", async () => {
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    const res = await post(payload, { "stripe-signature": signature });
    assert.equal(res.status, 200);
  });

  it("rejects an event signed with another secret", async () => {
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" });
    const res = await post(payload, { "stripe-signature": signature });
    assert.equal(res.status, 400);
  });

  it("rejects an unsigned request, like the fake events the old webhook accepted", async () => {
    const res = await post(payload, {});
    assert.equal(res.status, 400);
  });

  it("rejects a signed event whose body was changed", async () => {
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
    const res = await post(payload.replace("charge.succeeded", "invoice.paid"), { "stripe-signature": signature });
    assert.equal(res.status, 400);
  });
});
