import express from "express";
import { SubscriptionController } from "./subscription.controller";

// Mounted at /subscription. Every route needs a Firebase ID token (see middleware/verifyToken.ts).
const router = express.Router();

router.post("/setup-intent", SubscriptionController.createSetupIntent);
router.post("/confirm-subscription", SubscriptionController.confirmSubscription);
router.post("/complete-subscription", SubscriptionController.completeSubscription);
router.post("/cancel", SubscriptionController.cancelSubscription);
router.post("/portal", SubscriptionController.createPortalSession);
router.post("/subscribe", SubscriptionController.createSubscription);

export default router;
