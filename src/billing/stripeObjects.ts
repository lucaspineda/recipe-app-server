import type Stripe from "stripe";

type Ref = string | { id: string } | null | undefined;

export function idOf(ref: Ref): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

export function toDate(unixSeconds?: number | null): Date | null {
  return unixSeconds ? new Date(unixSeconds * 1000) : null;
}

// Webhook payloads use the endpoint's API version, which may be newer than the one this library pins.
// Newer versions moved invoice.subscription to invoice.parent.subscription_details.subscription.
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const anyInvoice = invoice as unknown as {
    subscription?: Ref;
    parent?: { subscription_details?: { subscription?: Ref } };
  };
  return idOf(anyInvoice.subscription) ?? idOf(anyInvoice.parent?.subscription_details?.subscription);
}

export function invoicePeriodEnd(invoice: Stripe.Invoice): Date | null {
  return toDate(invoice.lines?.data?.[0]?.period?.end);
}

// Newer API versions moved current_period_end from the subscription to its items.
export function subscriptionPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const anySub = subscription as unknown as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  return toDate(anySub.current_period_end ?? anySub.items?.data?.[0]?.current_period_end);
}

export function subscriptionPriceId(subscription: Stripe.Subscription): string | null {
  return subscription.items?.data?.[0]?.price?.id ?? null;
}

export const LIVE_STATUSES: ReadonlyArray<Stripe.Subscription.Status> = ["active", "trialing", "past_due"];
