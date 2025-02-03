import { Stripe } from "stripe";
import { firestore } from "firebase-admin";
import { Request, Response } from "express";

const stripe = new Stripe(
  "sk_test_51QVBgTHwruaG3UqlcoDEoKmGlLu6zJwLGiA2b9Km56F8CDV4pWMJBo97P9mBjvzeFvQudZcleSNxB5sEU4Ry3hux00wIbIQOgU"
);

export class SubscriptionController {
  // private static firestore = admin.firestore();
  static async createSubscription(req: Request, res: Response) {
    const origin = req.get("origin") || req.get("referer");
    const successUrl = `${origin}/plans/thank-you`;
    const cancelUrl = `${origin}/plans`;
    const { plan } = req.body;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: "price_1QeZhzHwruaG3UqlZJ2kRpA1", // Replace with your price ID
          quantity: 1,
        },
      ],
      metadata: {
        plan: JSON.stringify(plan),
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    res.json({ url: session.url });
  }
}
