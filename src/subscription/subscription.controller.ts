import { Request, Response } from "express";
import { getStripe } from "../utils/stripeClient";
import { firestoreStore } from "../billing/firestoreStore";
import { BillingDeps } from "../billing/types";
import { GENERIC_PAYMENT_ERROR, HttpError, declineMessage } from "../billing/errors";
import {
  cancelSubscription,
  completeSubscription,
  confirmSubscription,
  createCheckoutSession,
  createPortalSession,
  createSetupIntent,
} from "../billing/checkout";

export interface AuthGuardRequest extends Request {
  uid: string;
}

type Action = (uid: string, req: AuthGuardRequest, deps: BillingDeps) => Promise<unknown>;

// Wraps a billing action: waits for the Stripe client, then turns errors into JSON the checkout page shows.
function handle(action: Action) {
  return async (req: Request, res: Response): Promise<void> => {
    const authRequest = req as AuthGuardRequest;
    try {
      const deps: BillingDeps = { stripe: await getStripe(), store: firestoreStore };
      res.json(await action(authRequest.uid, authRequest, deps));
    } catch (error: any) {
      if (error instanceof HttpError) {
        res.status(error.status).json(error.body);
        return;
      }
      if (error?.type === "StripeCardError") {
        const code = error.decline_code ?? error.code ?? null;
        res.status(402).json({ code: code ?? "card_declined", status: "declined", message: declineMessage(code) });
        return;
      }
      console.error(`${req.method} ${req.originalUrl} failed:`, error);
      res.status(500).json({ code: "server_error", message: GENERIC_PAYMENT_ERROR });
    }
  };
}

export const SubscriptionController = {
  createSetupIntent: handle((uid, _req, deps) => createSetupIntent(uid, deps)),
  confirmSubscription: handle((uid, req, deps) => confirmSubscription(uid, req.body, deps)),
  completeSubscription: handle((uid, req, deps) => completeSubscription(uid, req.body, deps)),
  cancelSubscription: handle((uid, _req, deps) => cancelSubscription(uid, deps)),
  createPortalSession: handle((uid, req, deps) => createPortalSession(uid, req.body, deps)),
  createSubscription: handle((uid, req, deps) =>
    createCheckoutSession(uid, req.body, req.get("origin") || undefined, deps),
  ),
};
