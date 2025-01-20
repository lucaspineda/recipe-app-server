import { Stripe } from "stripe";
import { firestore } from "firebase-admin";


const stripe = new Stripe(
  "sk_test_51QVBgTHwruaG3UqlcoDEoKmGlLu6zJwLGiA2b9Km56F8CDV4pWMJBo97P9mBjvzeFvQudZcleSNxB5sEU4Ry3hux00wIbIQOgU"
);

export class SubscriptionController {
  // private static firestore = admin.firestore();
  static async createSubscription(req, res) {
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
        plan: plan,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    res.json({ url: session.url });
  }

  static async listenToWebhook(req, res) {
    let event = req.body;

    console.log("Received event:", event.type);
    let plan: { planId: string; cost: number; name: string; recipesCount?: number } | null = null;
    let uid = null

    try {
      if (event.type === "customer.subscription.updated") {
        const metadata = event.data.object.metadata
        const planString = metadata.plan
        uid = metadata.uid
        plan = JSON.parse(planString)

        console.log(plan, 'Plan selected')

        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        const doc = firestore().doc("users/" + uid);

        if (plan) {
          await doc.update({
            plan: {
              planId: plan.planId,
              startedAt: firestore.Timestamp.now(),
              expiresAt: expiresAt,
              cost: plan.cost,
              name: plan.name,
              recipesCount: plan.recipesCount ?? null,
            },
          });
  
          console.log("Plan changed successfully");

        }
      }

      res.status(200).send();
    } catch (error) {
      console.log("Error: ", error);
      res.status(500).send();
    }
  }
}
