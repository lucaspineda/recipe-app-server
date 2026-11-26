import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@google/genai";
import { generateRecipeImage } from "../src/services/geminiService";
import { isQuotaError } from "../src/services/quotaRetry";

const PHOTO = Buffer.from("jpeg bytes");

// What @google/genai throws for the 429 Vertex sent on 2026-11-26.
const quotaError = () =>
  new ApiError({
    status: 429,
    message: JSON.stringify({
      error: { code: 429, message: "Resource exhausted. Please try again later.", status: "RESOURCE_EXHAUSTED" },
    }),
  });

const photoResponse = () => ({
  candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: PHOTO.toString("base64") } }] } }],
});

type Outcome = "photo" | Error;

// A Vertex client that answers each generateContent call with the next outcome.
function fakeVertex(outcomes: Outcome[]) {
  const requests: any[] = [];
  const ai = {
    models: {
      async generateContent(params: any) {
        requests.push(params);
        const outcome = outcomes[requests.length - 1];
        if (!outcome) throw new Error("unexpected extra call");
        if (outcome instanceof Error) throw outcome;
        return photoResponse() as any;
      },
    },
  };
  return { ai, requests };
}

function run(outcomes: Outcome[], random = () => 0) {
  const vertex = fakeVertex(outcomes);
  const waits: number[] = [];
  const logs: string[] = [];
  const photo = generateRecipeImage(
    { recipeTitle: "Bolo de cenoura", ingredients: [{ nome: "cenoura" }, "farinha"] },
    {
      ai: vertex.ai,
      retry: { sleep: async (ms) => void waits.push(ms), random, log: (line) => void logs.push(line) },
    },
  );
  return { photo, requests: vertex.requests, waits, logs };
}

describe("recipe photo on Vertex 429 RESOURCE_EXHAUSTED", () => {
  it("makes one call when the first one works", async () => {
    const { photo, requests, waits, logs } = run(["photo"]);
    assert.deepEqual(await photo, PHOTO);
    assert.equal(requests.length, 1);
    assert.deepEqual(waits, []);
    assert.deepEqual(logs, []);
  });

  it("waits about 10 s after a 429 and returns the photo from the retry", async () => {
    const { photo, requests, waits, logs } = run([quotaError(), "photo"]);
    assert.deepEqual(await photo, PHOTO);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1], requests[0], "the retry sends the same request");
    assert.equal(requests[0].model, "gemini-3.1-flash-image");
    assert.deepEqual(waits, [10_000]);
    assert.deepEqual(logs, [
      "Recipe photo: 429 RESOURCE_EXHAUSTED, retry 1/2 in 10.0s",
      "Recipe photo: succeeded on retry 1/2",
    ]);
  });

  it("after a second 429 waits about 30 s more, past the 30 s that cleared the quota in testing", async () => {
    const { photo, requests, waits, logs } = run([quotaError(), quotaError(), "photo"]);
    assert.deepEqual(await photo, PHOTO);
    assert.equal(requests.length, 3);
    assert.deepEqual(waits, [10_000, 30_000]);
    assert.equal(logs.length, 3);
    assert.match(logs[1], /retry 2\/2 in 30\.0s/);
  });

  it("adds up to 20% random wait so photos that hit the limit together don't retry together", async () => {
    const { photo, waits, logs } = run([quotaError(), quotaError(), "photo"], () => 1);
    await photo;
    assert.deepEqual(waits, [12_000, 36_000]);
    assert.match(logs[0], /in 12\.0s/);
  });

  it("gives up after 2 retries and throws the 429 the route already turns into a 500", async () => {
    const third = quotaError();
    const { photo, requests, waits, logs } = run([quotaError(), quotaError(), third]);
    await assert.rejects(photo, (error) => error === third);
    assert.equal(requests.length, 3);
    assert.deepEqual(waits, [10_000, 30_000]);
    assert.equal(logs[logs.length - 1],"Recipe photo: 429 RESOURCE_EXHAUSTED, giving up after 2 retries");
  });

  it("does not retry other errors", async () => {
    const badRequest = new ApiError({ status: 400, message: '{"error":{"code":400,"status":"INVALID_ARGUMENT"}}' });
    const serverError = new ApiError({ status: 500, message: '{"error":{"code":500,"status":"INTERNAL"}}' });
    for (const error of [badRequest, serverError, new Error("fetch failed")]) {
      const { photo, requests, waits } = run([error]);
      await assert.rejects(photo, (thrown) => thrown === error);
      assert.equal(requests.length, 1);
      assert.deepEqual(waits, []);
    }
  });

  it("does not retry a response that came back without a photo", async () => {
    const vertex = fakeVertex([]);
    vertex.ai.models.generateContent = async (params: any) => {
      vertex.requests.push(params);
      return { candidates: [{ content: { parts: [{ text: "no photo" }] } }] } as any;
    };
    const waits: number[] = [];
    const photo = generateRecipeImage({ recipeTitle: "Pudim" }, { ai: vertex.ai, retry: { sleep: async (ms) => void waits.push(ms) } });
    await assert.rejects(photo, /No image generated/);
    assert.equal(vertex.requests.length, 1);
    assert.deepEqual(waits, []);
  });
});

describe("isQuotaError", () => {
  it("knows a 429 by its HTTP status or by RESOURCE_EXHAUSTED in the body", () => {
    assert.equal(isQuotaError(quotaError()), true);
    assert.equal(isQuotaError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')), true);
    assert.equal(isQuotaError({ status: 429 }), true);
  });

  it("is false for everything else", () => {
    assert.equal(isQuotaError(new ApiError({ status: 503, message: "UNAVAILABLE" })), false);
    assert.equal(isQuotaError(new Error("No image generated")), false);
    assert.equal(isQuotaError(undefined), false);
    assert.equal(isQuotaError("RESOURCE_EXHAUSTED"), false);
  });
});
