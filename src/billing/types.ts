import type Stripe from "stripe";

// A plan from the Firestore `plans` collection. The browser's copy is never trusted.
export interface CatalogPlan {
  id: number;
  name: string;
  cost: number;
  priceId: string;
  /** null means unlimited */
  recipeCount: number | null;
}

// users/{uid}.plan, as the web app reads it.
export interface UserPlanDoc {
  planId?: number | string;
  name?: string;
  cost?: number;
  recipeCount?: number | null;
  startedAt?: unknown;
  updatedAt?: unknown;
  expiresAt?: unknown;
  toBeCanceled?: boolean;
}

// users/{uid}.billing. Only the server writes it (firestore.rules doesn't let the browser change it).
export interface BillingDoc {
  customerId?: string | null;
  subscriptionId?: string | null;
  /** The Stripe subscription status, e.g. active, past_due, canceled */
  status?: string | null;
  paymentFailedAt?: Date | null;
  nextPaymentAttemptAt?: Date | null;
  cancelAt?: Date | null;
  endedAt?: Date | null;
}

export interface UserDoc {
  email?: string | null;
  plan?: UserPlanDoc;
  billing?: BillingDoc;
}

export interface BillingStore {
  getPlanById(id: number): Promise<CatalogPlan | null>;
  getPlanByPriceId(priceId: string): Promise<CatalogPlan | null>;
  getUser(uid: string): Promise<UserDoc | null>;
  /** Replaces users/{uid}.plan */
  setPlan(uid: string, plan: Record<string, unknown>): Promise<void>;
  /** Merges fields into users/{uid}.plan */
  patchPlan(uid: string, fields: Record<string, unknown>): Promise<void>;
  /** Merges fields into users/{uid}.billing */
  patchBilling(uid: string, fields: BillingDoc): Promise<void>;
}

export interface BillingDeps {
  stripe: Stripe;
  store: BillingStore;
  now?: () => Date;
}
