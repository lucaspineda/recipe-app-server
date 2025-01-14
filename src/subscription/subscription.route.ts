import express from "express";
import { SubscriptionController } from "./subscription.controller";
import Stripe from "stripe";
import bodyParser from "body-parser";

const router = express();

const stripe = new Stripe('sk_test_51QVBgTHwruaG3UqlcoDEoKmGlLu6zJwLGiA2b9Km56F8CDV4pWMJBo97P9mBjvzeFvQudZcleSNxB5sEU4Ry3hux00wIbIQOgU');


// Middleware to parse the raw body for Stripe webhook
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), (req, res) => {
  let event = req.body;

  // console.log(req.headers['stripe-signature'], 'signn')
  // const str = req.headers['stripe-signature']
  // const sign = Buffer.from(str, 'utf8');
  // console.log(req.body, 'reqq')

  // try {
  //   event = stripe.webhooks.constructEvent(
  //     req.body,
  //     str,
  //     'your-webhook-secret'
  //   );
  // } catch (err) {
  //   console.log(`⚠️  Webhook signature verification failed.`, err.message);
  //   return res.sendStatus(400);
  // }

  // Handle subscription events
  console.log('Received event:', event.type);
  if (event.type === 'invoice.payment_succeeded') {
    console.log('Payment succeeded:', event.data.object);
  }

  res.status(200).send();
});

// router.use(express.json())

router.post('/subscribe', SubscriptionController.createSubscription);

export default router;