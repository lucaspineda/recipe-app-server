import { Stripe } from "stripe";
import { Request, Response } from "express";
import { accessSecret } from "../utils/secretManager";

const secretName = 'projects/315650529779/secrets/stripe-secret-key/versions/latest';

let stripe: Stripe;

(async () => {
  const stripeSecret = await accessSecret(secretName);
  stripe = new Stripe(stripeSecret as string);
})();

export interface AuthGuardRequest extends Request {
  uid: string
}

export class SubscriptionController {
  static async createSetupIntent(req: AuthGuardRequest, res: Response): Promise<void> {
    const customer = await stripe.customers.create({
      metadata: { uid: req.uid },
    });

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      usage: 'off_session',
    });

    res.json({ clientSecret: setupIntent.client_secret, customerId: customer.id });
  }

  static async confirmSubscription(req: AuthGuardRequest, res: Response): Promise<void> {
    const { customerId, paymentMethodId, plan } = req.body;

    if (!customerId || !paymentMethodId || !plan) {
      res.status(400).json({ error: 'customerId, paymentMethodId and plan are required' });
      return;
    }

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: plan.priceId }],
      default_payment_method: paymentMethodId,
      metadata: {
        plan: JSON.stringify(plan),
        uid: req.uid,
      },
    });

    res.json({ subscriptionId: subscription.id, status: subscription.status });
  }

  static async createSubscription(req: AuthGuardRequest, res: Response): Promise<void> {
    const origin = req.get("origin") || req.get("referer");
    const successUrl = `${origin}/plans/thank-you`;
    const cancelUrl = `${origin}/plans`;
    const { plan } = req.body;
    console.log(plan, 'plan')
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: plan.priceId,
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          plan: JSON.stringify(plan),
          uid: req.uid
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    res.json({ url: session.url });
  }
}
