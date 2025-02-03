import express from "express";
import { WebhookController } from "./webhook.controller";
import bodyParser from "body-parser";

const router = express();

// Middleware to parse the raw body for Stripe webhook
router.post('/webhook', bodyParser.raw({ type: 'application/json' }), WebhookController.listenToWebhook);

export default router;