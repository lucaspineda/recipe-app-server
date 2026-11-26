# Recipe text model: moving off gemini-2.5-flash (2026-11-26)

## Why

Google's Vertex lifecycle page (checked 2026-11-26, last updated 2026-11-24) lists `gemini-2.5-flash` with a
retirement date of **2026-10-20**. It still answers, but Google can switch it off at any time, and then every
`/gemini/*` recipe route returns 500. Google names `gemini-3.8-flash` or `gemini-3.5-flash-lite` as the replacements.

The photo model, `gemini-3.1-flash-image`, is GA until **2027-05-28 or later**, so it stays as it is.

## What changes besides the model name

- **Region.** Neither new model is served in `us-central1` (404 "Publisher model … not found"). They run on
  `global` (or the `us` / `eu` multi-regions). The image model already uses `global`.
- **Sampling.** Gemini 3.x ignores `temperature`, `top_p` and `top_k`.
- **Thinking.** 3.x uses `thinkingLevel` instead of `thinkingBudget`. 3.5 Flash-Lite supports `MINIMAL` (its default);
  3.8 Flash's lowest documented level is `LOW`.

## Candidates and prices (Standard PayGo, global, per 1M tokens)

| Model | Input | Output | Lifecycle |
|---|---|---|---|
| gemini-2.5-flash (today) | $0.30 | $2.50 | retirement date passed |
| gemini-3.5-flash-lite | $0.30 | $2.50 | GA, until 2027-07-21 or later |
| gemini-3.8-flash | $0.75 → **$1.50 from 2027-01-01** | $3.75 → **$7.50 from 2027-01-01** | GA, until 2027-09-02 or later |

## Test

`scripts/compare-models.ts` builds the prompts with the backend's own `promptBuilder.ts`, sends them with the same
settings as `geminiService.ts` (JSON mime type, 4096 / 16384 max tokens), and parses them with the same fallback as
`parseJsonResponse`. It checks every field the frontend reads (`titulo`, `introducao`, `ingredientes[].nome/quantidade`,
`modoDePreparo`, `observacoes`, the five `informacoesNutricionais` values, `tempoPreparo`) and the prep-time limit.

There were 12 requests written for the test, in Portuguese, covering all five meals, all three levels, strict and suggest modes, and prep
times of 15 min, 60 min and no limit. Ten use `/gemini/` and two use `/gemini/recipe-options` (4 recipes each). The 10 single-recipe cases ran
twice. Calls for one request went to all models at the same moment. Latency was measured from the owner's Mac, not from Cloud Run, so
compare models with each other, not with production. For reference, production `/gemini/` is p50 6.6 s and p90 8.1 s over the last 30 days.

## Results (R$ at US$1 = R$5,75)

| Model | Calls | JSON parses | All fields present | Over time limit | p50 | p90 | Slowest | R$ / recipe | R$ / 4 options |
|---|---|---|---|---|---|---|---|---|---|
| 2.5-flash (today) | 22 | 22 | 22 | 0 | 7.8 s | 10.2 s | 24.5 s* | 0,016 | 0,054 |
| **3.5-flash-lite, MINIMAL** | 22 | 22 | 22 | 0 | **3.4 s** | **4.1 s** | 7.8 s* | **0,012** | **0,036** |
| 3.8-flash, LOW | 22 | 22 | 22 | 0 | 8.3 s | 63.0 s | **148.9 s*** | 0,024 (0,048 in 2027) | 0,070 |
| 3.8-flash, thinkingBudget 0 | 22 | 22 | 22 | 0 | 8.4 s | 12.5 s | 26.4 s* | 0,024 (0,048 in 2027) | 0,072 |

\* 4-recipe options call.

- **No model failed.** All 88 calls returned JSON the app can read with every field, and none went over the prep-time limit.
  No model reported thinking tokens.
- **3.8 Flash on `LOW` stalls.** 5 of 22 calls took 55–149 s, plus one at 35 s in the smoke test. With
  `thinkingBudget: 0` none stalled, but that setting isn't documented for 3.x, so it could change without notice.
- **Strict mode was respected by every model.** Each one used only the listed ingredients plus salt, oil and water.

## Quality notes (read side by side)

- **3.5 Flash-Lite writes shorter recipes.** It averages 6.2 steps and about 870 characters of method, against 6.8 steps and
  about 1,480 characters today. Its beginner recipes are still clear: they name the pan and give times and the visual cue for each step.
- **3.5 Flash-Lite sometimes oversells advanced titles.** In 2 of the 18 recipes from round 1, both at the advanced level, the title names a
  technique the steps never do: "…com Espuma…" with no foam step, and "…Dendê Esferificado" with no spherification.
  Beginner and intermediate recipes didn't show this.
- **3.8 Flash's detail is closer to today's.** It averages 7.3 steps, gives temperatures and diameters, and writes more "chef-like" titles
  (for example "Mille-Feuille de Mandioca…").
- **Today's model** gives the longest text, and gives nutrition as ranges such as "350-400 kcal (estimado)".

## Photos

The photo prompt is built from the recipe's title, intro, ingredients and steps, so the text model also shapes the
photo. I made photos for 5 of the requests (3 beginner/intermediate, the 2 advanced ones) from each model's recipe,
using the production photo path (`gemini-3.1-flash-image`, 1:1, `buildImagePrompt`). That's 15 photos.

- **All 15 are realistic and appetizing, and match the dish.** The photo model sets the quality; the text model didn't make any
  photo worse. Flash-Lite's shorter recipes give a shorter photo prompt (1,300–2,000 characters against 2,200–2,900) with no visible loss.
- **Fancy titles do show up in the photo.** Flash-Lite's "…com Espuma…" photo shows a foam, and its "…Dendê Esferificado" photo
  shows red spheres. The recipe steps make neither, so on those two advanced recipes the photo promises something the recipe
  doesn't deliver.
- **The photo model sometimes draws real brand packaging.** For the condensed-milk dessert it drew Moça and Maisena packs (spelled "MAIZENA" in one
  photo). This happened with today's model too, so it comes from the photo prompt, not the text model.
- **The photo quota is tight.** Spaced 25 s apart, 11 of 13 calls got `429 RESOURCE_EXHAUSTED` once before succeeding
  on a retry 30 s later. The backend doesn't retry, and the only production photo failure in the last 30 days
  (2026-11-13 04:21 UTC) was this 429.

## Decision

On 2026-11-26 the owner picked `gemini-3.5-flash-lite` on `global`, with `thinkingLevel: MINIMAL`. That was the recommendation:

- Google names it as a replacement for 2.5 Flash.
- It's about twice as fast as today.
- It costs about 25% less per recipe (R$0,012), and its price doesn't rise in January.

The trade-off is shorter recipe text and an occasional over-fancy title at the advanced level.

The alternative was `gemini-3.8-flash`, which keeps today's level of detail. It costs about R$0,048 per recipe from January, and it
would need `thinkingBudget: 0` or accept roughly 1-in-4 waits of about a minute.

## What the code does now

- **Model and endpoint.** `src/services/geminiService.ts` calls `gemini-3.5-flash-lite` on `global` with `thinkingLevel: MINIMAL` for
  `/gemini/`, `/gemini/recipe-options` and `/gemini/refine-recipes`. `temperature` is gone, since 3.x ignores it.
- **One retry on bad JSON.** After the switch, an end-to-end run of the real service got one options reply that didn't parse. Then
  36 more calls (options, single and refine) all parsed, so the miss rate is 1 in 60 Flash-Lite calls so far. That one was a 4-option call, which production makes about 6 times a month.
  When a reply doesn't parse, the backend now asks once more. A failed Vertex call (429, 500) is not retried.
- **A log line per call.** Each text call logs `[gemini] <route> model=<served model> ms=… in=… out=… thoughts=… finish=…`, so the logs
  show which model actually answered.
- **Rollback.** Send traffic back to the previous revision (`server-my-recipe-app-00012-qtf`). That only works while Google still
  serves 2.5 Flash.

## Rerun

```bash
GCLOUD_ACCESS_TOKEN="$(gcloud auth print-access-token)" npx tsx scripts/compare-models.ts /tmp/model-compare
```

Set `ONLY_CASES=almoco-frango,cafe-banana` to run a subset. Raw results from this run are kept outside the repo, in the
side-session notes (`gemini-model-compare-2026-11-26.json`).
