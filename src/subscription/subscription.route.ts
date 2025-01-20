import express from "express";
import { SubscriptionController } from "./subscription.controller";
import bodyParser from "body-parser";

const router = express();

// Middleware to parse the raw body for Stripe webhook
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), SubscriptionController.listenToWebhook);

router.post('/subscribe', SubscriptionController.createSubscription);

export default router;