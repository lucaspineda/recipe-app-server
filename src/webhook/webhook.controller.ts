import { firestore } from "firebase-admin";
import { Request, Response } from "express";

export class WebhookController {
  static async listenToWebhook(req: Request, res: Response) {
    let event = req.body;

    console.log("Received event:", event.type);
    let plan: {
      id: string;
      cost: number;
      name: string;
      recipeCount?: number;
    } | null = null;
    let uid = null;

    try {
      if (event.type === "customer.subscription.created") {
        const metadata = event.data.object.metadata;
        const planString = metadata.plan;
        uid = metadata.uid;
        plan = JSON.parse(planString);

        console.log(plan, "Plan selected");

        const expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + 1);
        const doc = firestore().doc("users/" + uid);
        console.log(doc.get(), 'socc')

        if (plan) {
          await doc.update({
            plan: {
              planId: plan.id,
              startedAt: firestore.Timestamp.now(),
              expiresAt: expiresAt,
              cost: plan.cost,
              name: plan.name,
              recipeCount: plan.recipeCount ?? null,
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
