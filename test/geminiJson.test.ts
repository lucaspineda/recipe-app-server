import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWithRetry } from "../src/services/geminiService";

function replies(...texts: Array<string | undefined>) {
  let calls = 0;
  const generate = async () => texts[calls++];
  return { generate, calls: () => calls };
}

describe("parseWithRetry", () => {
  it("returns the first reply when it parses, without a second call", async () => {
    const r = replies('{"titulo":"Omelete"}');
    assert.deepEqual(await parseWithRetry("single", r.generate), { titulo: "Omelete" });
    assert.equal(r.calls(), 1);
  });

  it("accepts JSON wrapped in a markdown fence", async () => {
    const r = replies('```json\n{"receitas":[]}\n```');
    assert.deepEqual(await parseWithRetry("options", r.generate), { receitas: [] });
    assert.equal(r.calls(), 1);
  });

  it("asks once more when the first reply is not valid JSON", async () => {
    const r = replies('{"receitas":[{"titulo":"Bolo"', '{"receitas":[{"titulo":"Bolo"}]}');
    assert.deepEqual(await parseWithRetry("options", r.generate), { receitas: [{ titulo: "Bolo" }] });
    assert.equal(r.calls(), 2);
  });

  it("gives up after the second invalid reply", async () => {
    const r = replies("not json", undefined);
    await assert.rejects(parseWithRetry("refine", r.generate), /Empty response from AI/);
    assert.equal(r.calls(), 2);
  });

  it("does not retry when the model call itself fails", async () => {
    let calls = 0;
    const generate = async (): Promise<string> => {
      calls++;
      throw new Error("429 RESOURCE_EXHAUSTED");
    };
    await assert.rejects(parseWithRetry("single", generate), /429/);
    assert.equal(calls, 1);
  });
});
