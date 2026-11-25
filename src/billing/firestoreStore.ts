import { getFirestore } from "firebase-admin/firestore";
import { BillingDoc, BillingStore, CatalogPlan, UserDoc } from "./types";

function toCatalogPlan(data: FirebaseFirestore.DocumentData): CatalogPlan | null {
  const id = Number(data.id);
  if (!Number.isFinite(id)) return null;
  const recipeCount = data.recipeCount;
  return {
    id,
    name: String(data.name ?? ""),
    cost: Number(data.cost ?? 0),
    priceId: String(data.priceId ?? ""),
    recipeCount: recipeCount === undefined || recipeCount === null || recipeCount === "" ? null : Number(recipeCount),
  };
}

// Firestore rejects undefined values; billing fields are written as null instead.
function prefixed(prefix: string, fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) out[`${prefix}.${key}`] = value === undefined ? null : value;
  return out;
}

async function findPlan(field: "id" | "priceId", value: unknown): Promise<CatalogPlan | null> {
  const snap = await getFirestore().collection("plans").where(field, "==", value).limit(1).get();
  return snap.empty ? null : toCatalogPlan(snap.docs[0].data());
}

export const firestoreStore: BillingStore = {
  async getPlanById(id) {
    // Plan ids are stored as numbers; also accept a string id in case a document was edited by hand.
    return (await findPlan("id", id)) ?? (await findPlan("id", String(id)));
  },

  async getPlanByPriceId(priceId) {
    return priceId ? findPlan("priceId", priceId) : null;
  },

  async getUser(uid) {
    const snap = await getFirestore().doc(`users/${uid}`).get();
    return snap.exists ? (snap.data() as UserDoc) : null;
  },

  async setPlan(uid, plan) {
    await getFirestore().doc(`users/${uid}`).update({ plan });
  },

  async patchPlan(uid, fields) {
    await getFirestore().doc(`users/${uid}`).update(prefixed("plan", fields));
  },

  async patchBilling(uid, fields: BillingDoc) {
    await getFirestore().doc(`users/${uid}`).update(prefixed("billing", fields as Record<string, unknown>));
  },
};
