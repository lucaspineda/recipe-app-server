import express from "express";
import { SubscriptionController } from "./subscription.controller";
import bodyParser from "body-parser";

const router = express();

router.post('/subscribe', SubscriptionController.createSubscription);

export default router;