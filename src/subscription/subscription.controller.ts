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
