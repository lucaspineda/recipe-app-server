import { initializeApp } from "firebase-admin/app";
import routes from "./routes";
import cors from "cors";
import { createWebhookHandler } from "./webhook/webhook.controller";
import { getStripe } from "./utils/stripeClient";

const express = require("express");

const app = express();

app.use(cors());
app.options("*", cors());

// Stripe signs the raw request body, so the webhook must be registered before express.json() parses it.
app.post("/webhook", express.raw({ type: "application/json" }), createWebhookHandler());

app.use(express.json());

initializeApp({
  projectId: "recipe-app-1bbdc",
});

// Start loading the Stripe key now; requests still wait for it (see utils/stripeClient.ts).
getStripe().catch((error) => console.error("Stripe key not loaded at startup:", error));

routes(app);

export default app;
