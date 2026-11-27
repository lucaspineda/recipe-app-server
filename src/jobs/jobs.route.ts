import { Request, Response, Router } from "express";
import { CreditsResetStore, resetFreeCredits } from "../credits/monthlyReset";
import { firestoreCreditsStore } from "../credits/firestoreCreditsStore";
import { VerifyIdToken, isFromScheduler, verifyGoogleIdToken } from "./schedulerAuth";

// The Cloud Scheduler job "reset-free-credits" sends these (see docs/monthly-credit-reset.md).
export const RESET_JOB_AUDIENCE =
  process.env.RESET_JOB_AUDIENCE || "https://server-my-recipe-app-315650529779.us-central1.run.app/jobs/reset-free-credits";
export const RESET_JOB_INVOKER =
  process.env.RESET_JOB_INVOKER || "credits-reset@recipe-app-1bbdc.iam.gserviceaccount.com";

interface JobsDeps {
  store?: () => CreditsResetStore;
  verify?: VerifyIdToken;
  now?: () => Date;
}

// Mounted before the Firebase sign-in check: these calls come from Cloud Scheduler, not from users.
export function createJobsRouter(deps: JobsDeps = {}): Router {
  const router = Router();

  // POST /jobs/reset-free-credits[?dryRun=1]: gives free accounts their 3 recipes back, 30 days after
  // the last reset. Safe to run more than once a day: accounts already reset aren't due again.
  router.post("/reset-free-credits", async (req: Request, res: Response) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
      res.status(401).json({ error: "Missing authorization header" });
      return;
    }
    const allowed = await isFromScheduler(
      authorization,
      { audience: RESET_JOB_AUDIENCE, email: RESET_JOB_INVOKER },
      deps.verify ?? verifyGoogleIdToken,
    );
    if (!allowed) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
    try {
      const summary = await resetFreeCredits((deps.store ?? firestoreCreditsStore)(), {
        now: deps.now ? deps.now() : new Date(),
        dryRun,
      });
      console.log(`[credits-reset] ${JSON.stringify(summary)}`);
      res.json(summary);
    } catch (error) {
      console.error("[credits-reset] failed:", error);
      res.status(500).json({ error: "Reset failed" });
    }
  });

  return router;
}
