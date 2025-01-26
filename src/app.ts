import { initializeApp, cert } from "firebase-admin/app";
import routes from "./routes";
import cors from "cors";

const express = require("express");

const app = express();

app.use(cors());
app.options("*", cors());

app.use(express.json());

initializeApp({
  projectId: "recipe-app-1bbdc",
});

routes(app);

export default app;
