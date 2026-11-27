import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { RESET_JOB_AUDIENCE, RESET_JOB_INVOKER, createJobsRouter } from "../src/jobs/jobs.route";
import type { CreditsResetStore } from "../src/credits/monthlyReset";
import type { IdTokenClaims } from "../src/jobs/schedulerAuth";

// Stands in for Google's token check: "good" is a valid token from the scheduler's service account.
const tokens: Record<string, IdTokenClaims> = {
  good: { email: RESET_JOB_INVOKER, email_verified: true },
  other: { email: "someone@example.com", email_verified: true },
  unverified: { email: RESET_JOB_INVOKER, email_verified: false },
};

describe("POST /jobs/reset-free-credits", () => {
  let server: Server;
  let base: string;
  const audiences: string[] = [];
  const runs: { dryRun: boolean }[] = [];

  const store = (): CreditsResetStore => ({
    async *users() {
      yield { uid: "u1", plan: { planId: 1, recipeCount: 0, updatedAt: new Date("2026-01-01T00:00:00Z") }, version: 1 };
    },
    async reset() {
      runs.push({ dryRun: false });
      return true;
    },
    async close() {},
  });

  before(async () => {
    const app = express();
    app.use(
      "/jobs",
      createJobsRouter({
        store,
        now: () => new Date("2026-12-01T09:00:00Z"),
        verify: async (token, audience) => {
          audiences.push(audience);
          if (!(token in tokens)) throw new Error("Invalid token signature");
          return tokens[token];
        },
      }),
    );
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jobs/reset-free-credits`;
  });

  after(() => server.close());

  const post = (query = "", authorization?: string) =>
    fetch(base + query, { method: "POST", headers: authorization ? { authorization } : {} });

  it("rejects a call without a token", async () => {
    const res = await post();
    assert.equal(res.status, 401);
  });

  it("rejects tokens that aren't the scheduler's", async () => {
    for (const authorization of ["Bearer forged", "Bearer other", "Bearer unverified", "good", "Basic good"]) {
      const res = await post("", authorization);
      assert.equal(res.status, 403, authorization);
    }
    assert.equal(runs.length, 0);
  });

  it("checks the token against the job's audience", async () => {
    await post("", "Bearer good");
    assert.ok(audiences.length > 0);
    assert.ok(audiences.every((audience) => audience === RESET_JOB_AUDIENCE));
  });

  it("runs the reset for the scheduler and returns the summary", async () => {
    runs.length = 0;
    const res = await post("", "Bearer good");
    assert.equal(res.status, 200);
    const summary = await res.json();
    assert.equal(summary.dryRun, false);
    assert.equal(summary.due, 1);
    assert.equal(summary.written, 1);
    assert.equal(runs.length, 1);
  });

  it("writes nothing on ?dryRun=1", async () => {
    runs.length = 0;
    const res = await post("?dryRun=1", "Bearer good");
    assert.equal(res.status, 200);
    const summary = await res.json();
    assert.equal(summary.dryRun, true);
    assert.equal(summary.due, 1);
    assert.equal(summary.written, 0);
    assert.equal(runs.length, 0);
  });
});
