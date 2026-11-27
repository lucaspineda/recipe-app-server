import { BulkWriter, FieldPath, Firestore, QueryDocumentSnapshot, Timestamp, getFirestore } from "firebase-admin/firestore";
import type { UserPlanDoc } from "../billing/types";
import type { CreditsResetStore } from "./monthlyReset";

const PAGE_SIZE = 500;
const FAILED_PRECONDITION = 9;

export function firestoreCreditsStore(db: Firestore = getFirestore()): CreditsResetStore {
  let writer: BulkWriter | null = null;

  return {
    // Reads only the plan field, a page at a time.
    async *users() {
      let last: QueryDocumentSnapshot | undefined;
      for (;;) {
        let query = db.collection("users").select("plan").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
        if (last) query = query.startAfter(last);
        const page = await query.get();
        for (const doc of page.docs) {
          yield { uid: doc.id, plan: doc.get("plan") as UserPlanDoc | undefined, version: doc.updateTime };
        }
        if (page.size < PAGE_SIZE) return;
        last = page.docs[page.docs.length - 1];
      }
    },

    // A recipe made between the read and this write changes the document, so the write is refused
    // rather than overwriting the new count.
    async reset(candidate, fields) {
      writer ??= db.bulkWriter();
      try {
        await writer.update(
          db.collection("users").doc(candidate.uid),
          { "plan.recipeCount": fields.recipeCount, "plan.updatedAt": Timestamp.fromDate(fields.updatedAt) },
          { lastUpdateTime: candidate.version as Timestamp },
        );
        return true;
      } catch (error) {
        if ((error as { code?: number }).code === FAILED_PRECONDITION) return false;
        throw error;
      }
    },

    async close() {
      if (!writer) return;
      const closing = writer;
      writer = null;
      await closing.close();
    },
  };
}
