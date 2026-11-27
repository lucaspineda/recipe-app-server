// Side-by-side of recipe-text models, using the backend's own prompt builder.
// Run: npx tsx scripts/compare-models.ts <outDir>
// Auth: Application Default Credentials, or set GCLOUD_ACCESS_TOKEN="$(gcloud auth print-access-token)"
// to use the gcloud account instead.
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
// The genai SDK bundles its own google-auth-library (v10); the top-level copy is v9 and its client is rejected.
import { OAuth2Client } from '../node_modules/@google/genai/node_modules/google-auth-library';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildMultipleRecipePrompt, buildSingleRecipePrompt } from '../src/services/promptBuilder';
import { RecipePreferences } from '../src/types/recipe';

const PROJECT = 'recipe-app-1bbdc';

type Candidate = {
  id: string;
  model: string;
  location: string;
  thinking: Record<string, unknown>;
  usdPerMInput: number;
  usdPerMOutput: number;
};

// Prices: Standard PayGo, <=200K input, from cloud.google.com/model-garden/pricing on 2026-11-26.
// 2.5 Flash in us-central1 is billed at the global row ($0.30 / $2.50).
const CANDIDATES: Candidate[] = [
  {
    id: '2.5-flash (today)',
    model: 'gemini-2.5-flash',
    location: 'us-central1',
    thinking: { thinkingBudget: 0 },
    usdPerMInput: 0.3,
    usdPerMOutput: 2.5,
  },
  {
    id: '3.8-flash LOW',
    model: 'gemini-3.8-flash',
    location: 'global',
    thinking: { thinkingLevel: ThinkingLevel.LOW },
    usdPerMInput: 0.75, // doubles to 1.50 on 2027-01-01
    usdPerMOutput: 3.75, // doubles to 7.50 on 2027-01-01
  },
  {
    // Not documented for 3.x, but the API accepts it; checks whether it is faster than LOW.
    id: '3.8-flash budget0',
    model: 'gemini-3.8-flash',
    location: 'global',
    thinking: { thinkingBudget: 0 },
    usdPerMInput: 0.75,
    usdPerMOutput: 3.75,
  },
  {
    id: '3.5-flash-lite MINIMAL',
    model: 'gemini-3.5-flash-lite',
    location: 'global',
    thinking: { thinkingLevel: ThinkingLevel.MINIMAL },
    usdPerMInput: 0.3,
    usdPerMOutput: 2.5,
  },
];

type Case = { id: string; kind: 'single' | 'multi'; prefs: RecipePreferences };

// Realistic requests written for this test (no user data). The frontend sends
// ingredientMode 'strict' or 'suggest'; anything but 'strict' takes the flexible branch.
const CASES: Case[] = [
  { id: 'almoco-frango', kind: 'single', prefs: { optionMeal: 'almoco', ingredients: 'frango, arroz, cebola, alho, tomate', ingredientMode: 'suggest' as any, prepTime: 40, cookingLevel: 'intermediario' } },
  { id: 'janta-ovos-strict', kind: 'single', prefs: { optionMeal: 'janta', ingredients: 'ovos, batata, queijo mussarela, cebola', ingredientMode: 'strict', prepTime: 30, cookingLevel: 'iniciante' } },
  { id: 'cafe-banana', kind: 'single', prefs: { optionMeal: 'cafe', ingredients: 'banana, aveia, ovo, canela, mel', ingredientMode: 'suggest' as any, prepTime: 15, cookingLevel: 'iniciante' } },
  { id: 'sobremesa-leite-cond', kind: 'single', prefs: { optionMeal: 'sobremesa', ingredients: 'leite condensado, creme de leite, chocolate em pó, biscoito maisena', ingredientMode: 'strict', prepTime: 0, cookingLevel: 'intermediario' } },
  { id: 'lanche-pao-presunto', kind: 'single', prefs: { optionMeal: 'lanche', ingredients: 'pão francês, presunto, queijo prato, tomate, orégano', ingredientMode: 'suggest' as any, prepTime: 20, cookingLevel: 'iniciante' } },
  { id: 'almoco-carne-moida', kind: 'single', prefs: { optionMeal: 'almoco', ingredients: 'carne moída, abobrinha, cenoura, cebola, alho, extrato de tomate', ingredientMode: 'strict', prepTime: 45, cookingLevel: 'intermediario' } },
  { id: 'janta-peixe-avancado', kind: 'single', prefs: { optionMeal: 'janta', ingredients: 'filé de tilápia, limão, leite de coco, pimentão, coentro, dendê', ingredientMode: 'suggest' as any, prepTime: 60, cookingLevel: 'avancado' } },
  { id: 'almoco-feijao-linguica', kind: 'single', prefs: { optionMeal: 'almoco', ingredients: 'feijão carioca cozido, linguiça calabresa, bacon, couve, farinha de mandioca', ingredientMode: 'suggest' as any, prepTime: 0, cookingLevel: 'intermediario' } },
  { id: 'lanche-mandioca', kind: 'single', prefs: { optionMeal: 'lanche', ingredients: 'mandioca, queijo coalho, manteiga', ingredientMode: 'strict', prepTime: 50, cookingLevel: 'avancado' } },
  { id: 'janta-macarrao-sobras', kind: 'single', prefs: { optionMeal: 'janta', ingredients: 'macarrão espaguete, sobra de frango desfiado, requeijão, milho, ervilha', ingredientMode: 'suggest' as any, prepTime: 25, cookingLevel: 'iniciante' } },
  { id: 'opcoes-almoco-legumes', kind: 'multi', prefs: { optionMeal: 'almoco', ingredients: 'batata doce, brócolis, grão de bico, cebola roxa, iogurte natural', ingredientMode: 'suggest' as any, prepTime: 40, cookingLevel: 'intermediario' } },
  { id: 'opcoes-sobremesa-strict', kind: 'multi', prefs: { optionMeal: 'sobremesa', ingredients: 'maçã, açúcar, ovos, farinha de trigo, manteiga, canela', ingredientMode: 'strict', prepTime: 60, cookingLevel: 'iniciante' } },
];

// Same parse as src/services/geminiService.ts parseJsonResponse.
function parseJsonResponse(text: string | undefined): any {
  if (!text) throw new Error('Empty response from AI');
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  }
}

// Fields the frontend reads (app/recipe/[id]/page.tsx and friends).
function schemaProblems(r: any): string[] {
  const p: string[] = [];
  if (typeof r?.titulo !== 'string' || !r.titulo) p.push('titulo');
  if (typeof r?.introducao !== 'string' || !r.introducao) p.push('introducao');
  if (!Array.isArray(r?.ingredientes) || r.ingredientes.length === 0) p.push('ingredientes');
  else if (r.ingredientes.some((i: any) => typeof i?.nome !== 'string' || typeof i?.quantidade !== 'string')) p.push('ingredientes.nome/quantidade');
  if (!Array.isArray(r?.modoDePreparo) || r.modoDePreparo.length === 0 || r.modoDePreparo.some((s: any) => typeof s !== 'string')) p.push('modoDePreparo');
  if (!Array.isArray(r?.observacoes)) p.push('observacoes');
  const n = r?.informacoesNutricionais;
  for (const k of ['calorias', 'proteinas', 'carboidratos', 'gorduras', 'fibras']) {
    if (n?.[k] === undefined || n?.[k] === null || n?.[k] === '') p.push(`nutri.${k}`);
  }
  if (r?.tempoPreparo === undefined) p.push('tempoPreparo');
  return p;
}

function minutes(t: any): number | null {
  const m = String(t ?? '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function client(location: string): GoogleGenAI {
  const token = process.env.GCLOUD_ACCESS_TOKEN;
  if (!token) return new GoogleGenAI({ vertexai: true, project: PROJECT, location });
  const authClient = new OAuth2Client();
  authClient.setCredentials({ access_token: token });
  return new GoogleGenAI({ vertexai: true, project: PROJECT, location, googleAuthOptions: { authClient } as any });
}

async function runOne(c: Candidate, tc: Case) {
  const ai = client(c.location);
  const single = tc.kind === 'single';
  const prompt = single ? buildSingleRecipePrompt(tc.prefs) : buildMultipleRecipePrompt(tc.prefs);
  const started = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: c.model,
      contents: prompt,
      config: {
        temperature: single ? 0.7 : 0.9,
        maxOutputTokens: single ? 4096 : 16384,
        responseMimeType: 'application/json',
        thinkingConfig: c.thinking as any,
      },
    });
    const ms = Date.now() - started;
    const u = res.usageMetadata ?? {};
    const inTok = u.promptTokenCount ?? 0;
    const outTok = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    const usd = (inTok * c.usdPerMInput + outTok * c.usdPerMOutput) / 1e6;
    let parsed: any = null;
    let parseOk = false;
    let problems: string[] = [];
    try {
      parsed = parseJsonResponse(res.text);
      parseOk = true;
      const recipes = single ? [parsed] : parsed?.receitas;
      if (!single && (!Array.isArray(recipes) || recipes.length !== 4)) problems.push(`receitas=${Array.isArray(recipes) ? recipes.length : 'missing'}`);
      (Array.isArray(recipes) ? recipes : []).forEach((r: any, i: number) => schemaProblems(r).forEach((x) => problems.push(single ? x : `#${i + 1}.${x}`)));
    } catch (e: any) {
      problems.push(`parse: ${e.message}`);
    }
    const recipes = single ? [parsed] : parsed?.receitas ?? [];
    const overTime = tc.prefs.prepTime
      ? (recipes as any[]).filter((r) => (minutes(r?.tempoPreparo) ?? 0) > (tc.prefs.prepTime as number)).length
      : 0;
    return {
      candidate: c.id, model: c.model, case: tc.id, kind: tc.kind, ok: true, ms,
      inTok, outTok, thoughts: u.thoughtsTokenCount ?? 0, usd, finish: res.candidates?.[0]?.finishReason,
      parseOk, problems, overTime, titles: (recipes as any[]).map((r) => r?.titulo), recipe: parsed, raw: parseOk ? undefined : res.text,
    };
  } catch (e: any) {
    return { candidate: c.id, model: c.model, case: tc.id, kind: tc.kind, ok: false, ms: Date.now() - started, error: String(e?.message ?? e).slice(0, 400) };
  }
}

async function main() {
  const outDir = process.argv[2];
  if (!outDir) throw new Error('usage: compare-models.ts <outDir>');
  mkdirSync(outDir, { recursive: true });
  const only = process.env.ONLY_CASES ? process.env.ONLY_CASES.split(',') : null;
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  const results: any[] = [];
  // Cases run one after another; the candidates for a case run at the same time,
  // so all models see the same moment of Vertex load.
  for (const tc of cases) {
    const row = await Promise.all(CANDIDATES.map((c) => runOne(c, tc)));
    for (const r of row) {
      results.push(r);
      console.log(`${tc.id.padEnd(26)} ${r.candidate.padEnd(24)} ${r.ok ? `${(r.ms / 1000).toFixed(1)}s in=${r.inTok} out=${r.outTok} parse=${r.parseOk} problems=${r.problems!.length} over=${r.overTime}` : `ERROR ${r.error}`}`);
    }
    writeFileSync(join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
