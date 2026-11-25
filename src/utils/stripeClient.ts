import Stripe from "stripe";
import { accessSecret } from "./secretManager";

// Secrets live in the recipe-app-1bbdc project (project number 315650529779).
const SECRET_PREFIX = "projects/315650529779/secrets";

const secretReads = new Map<string, Promise<string>>();

// Reads a secret once per instance. An environment variable wins, for local runs and tests.
// A failed read isn't cached, so the next request tries again.
function readSecret(envName: string, secretId: string): Promise<string> {
  const fromEnv = process.env[envName];
  if (fromEnv) return Promise.resolve(fromEnv);

  let pending = secretReads.get(secretId);
  if (!pending) {
    pending = accessSecret(`${SECRET_PREFIX}/${secretId}/versions/latest`).then((value) => {
      if (!value) throw new Error(`Secret "${secretId}" is missing or unreadable`);
      return value.trim();
    });
    pending.catch(() => secretReads.delete(secretId));
    secretReads.set(secretId, pending);
  }
  return pending;
}

let stripePromise: Promise<Stripe> | null = null;

// Every handler awaits this. Before, the client was created in the background at startup, so a request
// that reached a cold instance first used an undefined client and failed with a 500.
export function getStripe(): Promise<Stripe> {
  if (!stripePromise) {
    const pending = readSecret("STRIPE_SECRET_KEY", "stripe-secret-key").then((key) => new Stripe(key));
    pending.catch(() => {
      if (stripePromise === pending) stripePromise = null;
    });
    stripePromise = pending;
  }
  return stripePromise;
}

// The signing secret of the Stripe webhook endpoint (whsec_…), stored as "stripe-webhook-secret".
export function getWebhookSecret(): Promise<string> {
  return readSecret("STRIPE_WEBHOOK_SECRET", "stripe-webhook-secret");
}
