import type Stripe from "stripe";
import { Request, Response } from "express";
import { getStripe, getWebhookSecret } from "../utils/stripeClient";
import { firestoreStore } from "../billing/firestoreStore";
import { handleStripeEvent } from "../billing/webhookEvents";
import { BillingStore } from "../billing/types";

// POST /webhook. Must receive the raw body (see app.ts): Stripe signs the exact bytes it sent.
export function createWebhookHandler(store: BillingStore = firestoreStore) {
  return async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || !Buffer.isBuffer(req.body)) {
      res.status(400).send("Missing Stripe signature or raw body");
      return;
    }

    let stripe: Stripe;
    let secret: string;
    try {
      [stripe, secret] = await Promise.all([getStripe(), getWebhookSecret()]);
    } catch (error) {
      // 500 makes Stripe retry later (for up to 3 days), so no event is lost while the secret is missing.
      console.error("Stripe webhook: secrets unavailable:", error);
      res.status(500).send();
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, secret);
    } catch {
      console.warn("Stripe webhook: rejected a request with an invalid signature");
      res.status(400).send("Invalid signature");
      return;
    }

    try {
      const outcome = await handleStripeEvent(event, { stripe, store });
      console.log(`Stripe ${event.type} ${event.id}: ${outcome}`);
      res.status(200).send();
    } catch (error) {
      console.error(`Stripe ${event.type} ${event.id} failed:`, error);
      res.status(500).send();
    }
  };
}
