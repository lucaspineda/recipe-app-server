// Runs the monthly reset against the Firestore emulator: npm run test:emulator
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { firestoreCreditsStore } from "../src/credits/firestoreCreditsStore";
import { ResetCandidate, resetFreeCredits } from "../src/credits/monthlyReset";

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Run with npm run test:emulator (needs the Firestore emulator)");

const app = initializeApp({ projectId: "demo-credits-reset" }, "credits-reset-test");
const db = getFirestore(app);

const NOW = new Date("2026-12-01T09:00:00Z");
const daysAgo = (days: number) => Timestamp.fromMillis(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const DUE_FREE = 1100;

async function clearUsers() {
  const writer = db.bulkWriter();
  for (const doc of (await db.collection("users").get()).docs) writer.delete(doc.ref);
  await writer.close();
}

async function seed() {
  await clearUsers();
  const writer = db.bulkWriter();
  // More than two pages of 500, so paging is exercised.
  for (let i = 0; i < DUE_FREE; i++) {
    writer.set(db.doc(`users/due-${String(i).padStart(4, "0")}`), {
      email: `due${i}@example.test`,
      plan: { planId: 1, name: "Básico", cost: 0, recipeCount: i % 4, startedAt: daysAgo(400), updatedAt: daysAgo(31 + (i % 200)) },
    });
  }
  writer.set(db.doc("users/bonus"), { plan: { planId: 1, recipeCount: 7, updatedAt: daysAgo(40) } });
  writer.set(db.doc("users/recent"), { plan: { planId: 1, recipeCount: 0, updatedAt: daysAgo(3) } });
  writer.set(db.doc("users/no-updated-at"), { plan: { planId: 1, recipeCount: 1, startedAt: daysAgo(90) } });
  writer.set(db.doc("users/premium"), { plan: { planId: 2, recipeCount: 0, updatedAt: daysAgo(90) } });
  writer.set(db.doc("users/no-plan"), { email: "x@example.test" });
  await writer.close();
}

const plan = async (uid: string) => (await db.doc(`users/${uid}`).get()).get("plan");

describe("firestoreCreditsStore on the emulator", () => {
  before(seed);
  after(async () => {
    await clearUsers();
    await deleteApp(app);
  });

  it("dry run reads every user and writes nothing", async () => {
    const summary = await resetFreeCredits(firestoreCreditsStore(db), { now: NOW, dryRun: true });
    assert.equal(summary.scanned, DUE_FREE + 5);
    assert.equal(summary.free, DUE_FREE + 3);
    assert.equal(summary.due, DUE_FREE + 2);
    assert.equal(summary.written, 0);
    assert.equal((await plan("due-0000")).recipeCount, 0);
  });

  it("resets due free accounts, keeps the rest, and only touches the plan fields it owns", async () => {
    const summary = await resetFreeCredits(firestoreCreditsStore(db), { now: NOW, dryRun: false });
    assert.equal(summary.due, DUE_FREE + 2);
    assert.equal(summary.written, DUE_FREE + 2);
    assert.equal(summary.changed, 0);
    assert.equal(summary.failed, 0);

    const first = (await db.doc("users/due-0000").get()).data()!;
    assert.equal(first.email, "due0@example.test");
    assert.equal(first.plan.recipeCount, 3);
    assert.equal(first.plan.name, "Básico");
    assert.equal(first.plan.updatedAt.toMillis(), NOW.getTime());
    assert.equal(first.plan.startedAt.toMillis(), daysAgo(400).toMillis());
    assert.equal((await plan("due-1099")).recipeCount, 3);
    assert.equal((await plan("bonus")).recipeCount, 7);
    assert.equal((await plan("no-updated-at")).recipeCount, 3);
    assert.equal((await plan("recent")).recipeCount, 0);
    assert.equal((await plan("premium")).recipeCount, 0);
    assert.equal((await db.doc("users/no-plan").get()).get("plan"), undefined);
  });

  it("finds nothing due on a second run", async () => {
    const summary = await resetFreeCredits(firestoreCreditsStore(db), { now: new Date(NOW.getTime() + 60_000), dryRun: false });
    assert.equal(summary.due, 0);
    assert.equal(summary.written, 0);
  });

  it("refuses the write when the user made a recipe after the read", async () => {
    await db.doc("users/race").set({ plan: { planId: 1, recipeCount: 2, updatedAt: daysAgo(35) } });
    const store = firestoreCreditsStore(db);
    let candidate: ResetCandidate | undefined;
    for await (const c of store.users()) if (c.uid === "race") candidate = c;
    assert.ok(candidate);

    await db.doc("users/race").update({ "plan.recipeCount": 1 });
    // The bulk writer sends queued writes on close, so close before waiting (as resetFreeCredits does).
    const pending = store.reset(candidate, { recipeCount: 3, updatedAt: NOW });
    await store.close();
    assert.equal(await pending, false);
    assert.equal((await plan("race")).recipeCount, 1);
  });
});
