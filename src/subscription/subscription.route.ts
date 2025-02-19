import express from "express";
import { AuthGuardRequest, SubscriptionController } from "./subscription.controller";
import { Request, Response } from 'express';

const router = express.Router();
router.post('/subscribe', async (req: Request, res: Response) => {
  try {
    const authGuardRequest = req as AuthGuardRequest;
    await SubscriptionController.createSubscription(authGuardRequest, res);
  } catch (error) {
    res.status(500).send({ error: 'An error occurred while creating the subscription.' });
  }
});

export default router;