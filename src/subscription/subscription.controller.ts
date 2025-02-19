import {Stripe} from "stripe";
import { Request, Response } from "express";

const stripe = new Stripe(
  "sk_test_51QVBgTHwruaG3UqlcoDEoKmGlLu6zJwLGiA2b9Km56F8CDV4pWMJBo97P9mBjvzeFvQudZcleSNxB5sEU4Ry3hux00wIbIQOgU"
);

export interface AuthGuardRequest extends Request {
  uid: string
}

export class SubscriptionController {
  // private static firestore = admin.firestore();
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
          price: "price_1QeZhzHwruaG3UqlZJ2kRpA1", // Replace with your price ID
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
