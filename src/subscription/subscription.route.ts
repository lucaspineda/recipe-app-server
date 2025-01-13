import express from "express"
import { SubscriptionController } from "./subscription.controller.ts"

const router = express.Router()

router.post('/subscribe', SubscriptionController.createSubscription)

router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const event = stripe.webhooks.constructEvent(
    req.body,
    req.headers['stripe-signature'],
    'your-webhook-secret'
  );

  // Handle subscription events
  if (event.type === 'invoice.payment_succeeded') {
    console.log('Payment succeeded:', event.data.object);
  }
  res.status(200).send();
});

export default router