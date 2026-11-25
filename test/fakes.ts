import type Stripe from "stripe";
import { BillingDoc, BillingStore, CatalogPlan, UserDoc } from "../src/billing/types";

export const PLANS: CatalogPlan[] = [
  { id: 1, name: "Básico", cost: 0, priceId: "", recipeCount: 3 },
  { id: 2, name: "Premium", cost: 9.99, priceId: "price_premium", recipeCount: 40 },
  { id: 3, name: "Premium Plus", cost: 49.99, priceId: "price_plus", recipeCount: null },
];

export const FREE_PLAN = { planId: 1, name: "Básico", cost: 0, recipeCount: 3 };

// In-memory users/{uid} documents and the plans catalog.
export class FakeStore implements BillingStore {
  users = new Map<string, UserDoc>();

  constructor(users: Record<string, UserDoc> = {}) {
    for (const [uid, doc] of Object.entries(users)) this.users.set(uid, structuredClone(doc));
  }

  async getPlanById(id: number) {
    return PLANS.find((p) => p.id === id) ?? null;
  }
  async getPlanByPriceId(priceId: string) {
    return PLANS.find((p) => p.priceId && p.priceId === priceId) ?? null;
  }
  async getUser(uid: string) {
    const user = this.users.get(uid);
    return user ? structuredClone(user) : null;
  }
  async setPlan(uid: string, plan: Record<string, unknown>) {
    this.doc(uid).plan = structuredClone(plan);
  }
  async patchPlan(uid: string, fields: Record<string, unknown>) {
    const user = this.doc(uid);
    user.plan = { ...(user.plan ?? {}), ...fields };
  }
  async patchBilling(uid: string, fields: BillingDoc) {
    const user = this.doc(uid);
    user.billing = { ...(user.billing ?? {}), ...fields };
  }

  doc(uid: string): UserDoc {
    const user = this.users.get(uid);
    if (!user) throw new Error(`NOT_FOUND users/${uid}`);
    return user;
  }
}

type Outcome = "succeeds" | "requires_action" | `declined:${string}`;

function missing(what: string) {
  return Object.assign(new Error(`No such ${what}`), { code: "resource_missing" });
}

// Just enough of the Stripe API for the billing code, with in-memory objects.
export class FakeStripe {
  calls: string[] = [];
  customers = new Map<string, any>();
  subscriptions = new Map<string, any>();
  paymentMethods = new Map<string, any>();
  /** What happens to the first payment of the next subscription */
  nextPayment: Outcome = "succeeds";
  nowSeconds = 1_780_000_000;
  private seq = 0;
  private idempotent = new Map<string, any>();

  newId(prefix: string) {
    return `${prefix}_${++this.seq}`;
  }

  addSubscription(fields: Partial<any> & { metadata: Record<string, string>; customer: string; price: string }) {
    const id = fields.id ?? this.newId("sub");
    const sub = {
      id,
      status: "active",
      cancel_at_period_end: false,
      cancel_at: null,
      current_period_end: this.nowSeconds + 30 * 86400,
      items: { data: [{ price: { id: fields.price } }] },
      latest_invoice: null,
      ...fields,
    };
    this.subscriptions.set(id, sub);
    return sub;
  }

  // The bank confirmed 3-D Secure.
  completeAction(subscriptionId: string) {
    const sub = this.subscriptions.get(subscriptionId);
    sub.status = "active";
    sub.latest_invoice.payment_intent.status = "succeeded";
  }

  api(): Stripe {
    const self = this;
    return {
      customers: {
        async create(params: any) {
          self.calls.push("customers.create");
          const customer = { id: self.newId("cus"), metadata: params.metadata ?? {}, email: params.email ?? null, preferred_locales: params.preferred_locales };
          self.customers.set(customer.id, customer);
          return customer;
        },
        async retrieve(id: string) {
          const customer = self.customers.get(id);
          if (!customer) throw missing("customer");
          return customer;
        },
        async update(id: string, params: any) {
          self.calls.push("customers.update");
          Object.assign(self.customers.get(id), params);
          return self.customers.get(id);
        },
      },
      setupIntents: {
        async create(params: any) {
          self.calls.push("setupIntents.create");
          return { id: self.newId("seti"), client_secret: "seti_secret", customer: params.customer };
        },
      },
      paymentMethods: {
        async retrieve(id: string) {
          return self.paymentMethods.get(id) ?? { id, customer: null };
        },
        async attach(id: string, params: any) {
          self.calls.push("paymentMethods.attach");
          const pm = { id, customer: params.customer };
          self.paymentMethods.set(id, pm);
          return pm;
        },
      },
      subscriptions: {
        async create(params: any, options?: { idempotencyKey?: string }) {
          const key = options?.idempotencyKey;
          if (key && self.idempotent.has(key)) return self.idempotent.get(key);
          self.calls.push("subscriptions.create");
          const outcome = self.nextPayment;
          const paymentIntent =
            outcome === "succeeds"
              ? { status: "succeeded", client_secret: "pi_secret" }
              : outcome === "requires_action"
                ? { status: "requires_action", client_secret: "pi_secret_3ds" }
                : {
                    status: "requires_payment_method",
                    client_secret: "pi_secret",
                    last_payment_error: { code: "card_declined", decline_code: outcome.split(":")[1] },
                  };
          const sub = self.addSubscription({
            customer: params.customer,
            price: params.items[0].price,
            metadata: params.metadata ?? {},
            status: outcome === "succeeds" ? "active" : "incomplete",
            latest_invoice: { id: self.newId("in"), payment_intent: paymentIntent },
          });
          if (key) self.idempotent.set(key, sub);
          return sub;
        },
        async retrieve(id: string) {
          const sub = self.subscriptions.get(id);
          if (!sub) throw missing("subscription");
          return sub;
        },
        async cancel(id: string) {
          self.calls.push(`subscriptions.cancel ${id}`);
          const sub = self.subscriptions.get(id);
          sub.status = "canceled";
          return sub;
        },
        async update(id: string, params: any) {
          self.calls.push(`subscriptions.update ${id}`);
          const sub = self.subscriptions.get(id);
          Object.assign(sub, params);
          if (params.cancel_at_period_end) sub.cancel_at = sub.current_period_end;
          return sub;
        },
        async list(params: any) {
          return { data: [...self.subscriptions.values()].filter((s) => s.customer === params.customer && (!params.status || s.status === params.status)) };
        },
        async search(params: any) {
          const uid = /metadata\['uid'\]:'([^']+)'/.exec(params.query)?.[1];
          return { data: [...self.subscriptions.values()].filter((s) => s.metadata.uid === uid && s.status === "active") };
        },
      },
      billingPortal: {
        sessions: {
          async create(params: any) {
            self.calls.push(`billingPortal.sessions.create ${params.return_url}`);
            return { url: "https://billing.stripe.test/session" };
          },
        },
      },
      checkout: {
        sessions: {
          async create() {
            return { url: "https://checkout.stripe.test/session" };
          },
        },
      },
    } as unknown as Stripe;
  }
}

export function setup(users: Record<string, UserDoc> = {}) {
  const store = new FakeStore(users);
  const fake = new FakeStripe();
  const now = new Date("2026-11-25T12:00:00Z");
  return { store, fake, deps: { stripe: fake.api(), store, now: () => now }, now };
}
