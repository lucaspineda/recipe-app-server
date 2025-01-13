import { Stripe } from "stripe";

const stripe = new Stripe('sk_test_51QVBgTHwruaG3UqlcoDEoKmGlLu6zJwLGiA2b9Km56F8CDV4pWMJBo97P9mBjvzeFvQudZcleSNxB5sEU4Ry3hux00wIbIQOgU');

export class SubscriptionController {
  static async createSubscription(req, res) {
    console.log('foi')
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: 'price_1QeZhzHwruaG3UqlZJ2kRpA1', // Replace with your price ID
          quantity: 1,
        },
      ],
      success_url: 'https://your-site.com/success',
      cancel_url: 'https://your-site.com/cancel',
    });
    res.json({ url: session.url });
  }
}