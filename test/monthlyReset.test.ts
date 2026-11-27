import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UserPlanDoc } from "../src/billing/types";
import { CreditsResetStore, ResetCandidate, decideReset, resetFreeCredits } from "../src/credits/monthlyReset";

const NOW = new Date("2026-12-01T09:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const free = (fields: Partial<UserPlanDoc>): UserPlanDoc => ({ planId: 1, name: "Básico", cost: 0, ...fields });

describe("decideReset", () => {
  it("resets a free account 30 days after its last reset", () => {
    assert.deepEqual(decideReset(free({ recipeCount: 0, updatedAt: daysAgo(30) }), NOW), { due: true, recipeCount: 3 });
    assert.deepEqual(decideReset(free({ recipeCount: 2, updatedAt: daysAgo(200) }), NOW), { due: true, recipeCount: 3 });
  });

  it("waits until the 30 days are up", () => {
    assert.deepEqual(decideReset(free({ recipeCount: 0, updatedAt: daysAgo(29) }), NOW), { due: false });
    assert.deepEqual(decideReset(free({ recipeCount: 0, updatedAt: daysAgo(1) }), NOW), { due: false });
  });

  it("allows an hour of slack so the daily run doesn't slip a day", () => {
    const almost = new Date(daysAgo(30).getTime() + 59 * 60 * 1000);
    assert.deepEqual(decideReset(free({ recipeCount: 1, updatedAt: almost }), NOW), { due: true, recipeCount: 3 });
    const tooEarly = new Date(daysAgo(30).getTime() + 61 * 60 * 1000);
    assert.deepEqual(decideReset(free({ recipeCount: 1, updatedAt: tooEarly }), NOW), { due: false });
  });

  it("keeps recipes above 3, such as the survey bonus", () => {
    assert.deepEqual(decideReset(free({ recipeCount: 7, updatedAt: daysAgo(40) }), NOW), { due: true, recipeCount: 7 });
    assert.deepEqual(decideReset(free({ recipeCount: 3, updatedAt: daysAgo(40) }), NOW), { due: true, recipeCount: 3 });
  });

  it("repairs counts below zero or missing", () => {
    assert.deepEqual(decideReset(free({ recipeCount: -1, updatedAt: daysAgo(40) }), NOW), { due: true, recipeCount: 3 });
    assert.deepEqual(decideReset(free({ recipeCount: null, updatedAt: daysAgo(40) }), NOW), { due: true, recipeCount: 3 });
    assert.deepEqual(decideReset(free({ updatedAt: daysAgo(40) }), NOW), { due: true, recipeCount: 3 });
  });

  it("falls back to startedAt, and treats an account with no dates as due", () => {
    assert.deepEqual(decideReset(free({ recipeCount: 0, startedAt: daysAgo(31) }), NOW), { due: true, recipeCount: 3 });
    assert.deepEqual(decideReset(free({ recipeCount: 0, startedAt: daysAgo(3) }), NOW), { due: false });
    assert.deepEqual(decideReset(free({ recipeCount: 0 }), NOW), { due: true, recipeCount: 3 });
  });

  it("reads Firestore timestamps and a plan id stored as text", () => {
    const timestamp = { toMillis: () => daysAgo(45).getTime() };
    assert.deepEqual(decideReset(free({ planId: "1", recipeCount: 0, updatedAt: timestamp }), NOW), {
      due: true,
      recipeCount: 3,
    });
    assert.deepEqual(decideReset(free({ recipeCount: 0, updatedAt: { _seconds: daysAgo(45).getTime() / 1000 } }), NOW), {
      due: true,
      recipeCount: 3,
    });
  });

  it("leaves paid plans and accounts without a plan to the billing code", () => {
    assert.deepEqual(decideReset({ planId: 2, recipeCount: 0, updatedAt: daysAgo(90) }, NOW), { due: false });
    assert.deepEqual(decideReset({ planId: 3, recipeCount: null, updatedAt: daysAgo(90) }, NOW), { due: false });
    assert.deepEqual(decideReset({ recipeCount: 0, updatedAt: daysAgo(90) }, NOW), { due: false });
    assert.deepEqual(decideReset(undefined, NOW), { due: false });
  });
});

// In-memory users/{uid} plans. `version` counts writes, like Firestore's update time.
class FakeCreditsStore implements CreditsResetStore {
  docs = new Map<string, { plan?: UserPlanDoc; version: number }>();
  closed = 0;
  /** Called after a user is read and before its write, to simulate a recipe made meanwhile */
  beforeWrite?: (uid: string) => void;
  failFor = new Set<string>();

  constructor(plans: Record<string, UserPlanDoc | undefined>) {
    for (const [uid, plan] of Object.entries(plans)) this.docs.set(uid, { plan: structuredClone(plan), version: 1 });
  }

  async *users(): AsyncIterable<ResetCandidate> {
    for (const [uid, doc] of this.docs) yield { uid, plan: structuredClone(doc.plan), version: doc.version };
  }

  async reset(candidate: ResetCandidate, fields: { recipeCount: number; updatedAt: Date }) {
    this.beforeWrite?.(candidate.uid);
    if (this.failFor.has(candidate.uid)) throw new Error("UNAVAILABLE");
    const doc = this.docs.get(candidate.uid)!;
    if (doc.version !== candidate.version) return false;
    doc.plan = { ...doc.plan, recipeCount: fields.recipeCount, updatedAt: fields.updatedAt };
    doc.version++;
    return true;
  }

  async close() {
    this.closed++;
  }

  plan(uid: string) {
    return this.docs.get(uid)!.plan!;
  }
}

const seed = () => ({
  empty: free({ recipeCount: 0, updatedAt: daysAgo(250) }),
  two: free({ recipeCount: 2, updatedAt: daysAgo(31) }),
  full: free({ recipeCount: 3, updatedAt: daysAgo(60) }),
  bonus: free({ recipeCount: 6, updatedAt: daysAgo(45) }),
  recent: free({ recipeCount: 0, updatedAt: daysAgo(5) }),
  premium: { planId: 2, name: "Premium", cost: 9.99, recipeCount: 0, updatedAt: daysAgo(90) },
  noPlan: undefined,
});

describe("resetFreeCredits", () => {
  it("resets every due free account and leaves the rest alone", async () => {
    const store = new FakeCreditsStore(seed());
    const summary = await resetFreeCredits(store, { now: NOW, dryRun: false });

    assert.deepEqual(summary, {
      dryRun: false,
      scanned: 7,
      free: 5,
      due: 4,
      raised: 2,
      kept: 2,
      written: 4,
      changed: 0,
      failed: 0,
    });
    assert.equal(store.plan("empty").recipeCount, 3);
    assert.equal(store.plan("two").recipeCount, 3);
    assert.equal(store.plan("full").recipeCount, 3);
    assert.equal(store.plan("bonus").recipeCount, 6);
    for (const uid of ["empty", "two", "full", "bonus"]) assert.equal(store.plan(uid).updatedAt, NOW);
    assert.equal(store.plan("recent").recipeCount, 0);
    assert.equal(store.plan("premium").recipeCount, 0);
    assert.equal(store.closed, 1);
  });

  it("does nothing on a second run the same day", async () => {
    const store = new FakeCreditsStore(seed());
    await resetFreeCredits(store, { now: NOW, dryRun: false });
    const again = await resetFreeCredits(store, { now: new Date(NOW.getTime() + 60_000), dryRun: false });
    assert.equal(again.due, 0);
    assert.equal(again.written, 0);
  });

  it("counts without writing on a dry run", async () => {
    const store = new FakeCreditsStore(seed());
    const before = structuredClone([...store.docs]);
    const summary = await resetFreeCredits(store, { now: NOW, dryRun: true });
    assert.equal(summary.due, 4);
    assert.equal(summary.raised, 2);
    assert.equal(summary.written, 0);
    assert.deepEqual([...store.docs], before);
  });

  it("skips an account that changed after it was read", async () => {
    const store = new FakeCreditsStore(seed());
    store.beforeWrite = (uid) => {
      if (uid !== "two") return;
      const doc = store.docs.get(uid)!;
      doc.plan = { ...doc.plan, recipeCount: 1 };
      doc.version++;
    };
    const summary = await resetFreeCredits(store, { now: NOW, dryRun: false });
    assert.equal(summary.changed, 1);
    assert.equal(summary.written, 3);
    assert.equal(store.plan("two").recipeCount, 1);
  });

  it("keeps going when one write fails", async () => {
    const store = new FakeCreditsStore(seed());
    store.failFor.add("empty");
    const summary = await resetFreeCredits(store, { now: NOW, dryRun: false });
    assert.equal(summary.failed, 1);
    assert.equal(summary.written, 3);
    assert.equal(store.plan("empty").recipeCount, 0);
  });
});
