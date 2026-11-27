import { GenerateContentResponse, GoogleGenAI, ThinkingLevel } from '@google/genai';
import { RecipePreferences, ImageGenerationInput, RefinementInput } from '../types/recipe';
import {
  buildSingleRecipePrompt,
  buildMultipleRecipePrompt,
  buildRefinementPrompt,
  buildImagePrompt,
} from './promptBuilder';
import { QuotaRetryOptions, retryOnQuota } from './quotaRetry';

const GCP_PROJECT = 'recipe-app-1bbdc';

// gemini-2.5-flash passed its Vertex retirement date (2026-10-20). Google lists gemini-3.5-flash-lite as a
// replacement. It is served from the global endpoint (or the us/eu multi-regions), not from us-central1.
// Gemini 3.x ignores temperature/topP/topK and takes thinkingLevel instead of thinkingBudget; MINIMAL is the
// fastest level. Comparison and reasoning: docs/gemini-text-model-migration.md.
const TEXT_MODEL = 'gemini-3.5-flash-lite';
const TEXT_LOCATION = 'global';
const TEXT_THINKING = { thinkingLevel: ThinkingLevel.MINIMAL };

// Imagen 4 was retired on Vertex AI; Gemini image models are served from the global endpoint.
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-3.1-flash-image';
const IMAGE_LOCATION = process.env.IMAGE_LOCATION || 'global';

function getAIClient(location: string): GoogleGenAI {
  return new GoogleGenAI({
    vertexai: true,
    project: GCP_PROJECT,
    location,
  });
}

function logUsage(route: string, result: GenerateContentResponse, startedAt: number): void {
  const usage = result.usageMetadata;
  console.log(
    `[gemini] ${route} model=${result.modelVersion ?? TEXT_MODEL} ms=${Date.now() - startedAt}` +
      ` in=${usage?.promptTokenCount ?? 0} out=${usage?.candidatesTokenCount ?? 0}` +
      ` thoughts=${usage?.thoughtsTokenCount ?? 0} finish=${result.candidates?.[0]?.finishReason}`,
  );
}

function parseJsonResponse(text: string | undefined): object {
  if (!text) {
    throw new Error('Empty response from AI');
  }

  try {
    return JSON.parse(text);
  } catch {
    // Fallback: strip markdown fences if model still wraps them
    console.log('Initial JSON parsing failed, attempting to clean response and parse again.');
    const cleaned = text
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse AI response:', text.substring(0, 200));
      throw new Error('Invalid JSON response from AI');
    }
  }
}

// In testing, gemini-3.5-flash-lite returned unparseable JSON on 1 of 60 calls (a 4-recipe options call), and the
// same request parsed on the next try. One retry keeps that rare miss from reaching the user as a 500.
export async function parseWithRetry(route: string, generate: () => Promise<string | undefined>): Promise<any> {
  const first = await generate();
  try {
    return parseJsonResponse(first);
  } catch {
    console.log(`[gemini] ${route} returned invalid JSON, retrying once`);
    return parseJsonResponse(await generate());
  }
}

async function generateText(route: string, prompt: string, maxOutputTokens: number): Promise<string | undefined> {
  const ai = getAIClient(TEXT_LOCATION);
  const startedAt = Date.now();
  const result = await ai.models.generateContent({
    model: TEXT_MODEL,
    contents: prompt,
    config: {
      maxOutputTokens,
      responseMimeType: 'application/json',
      thinkingConfig: TEXT_THINKING,
    },
  });
  logUsage(route, result, startedAt);
  return result.text;
}

export async function generateSingleRecipe(preferences: RecipePreferences): Promise<object> {
  const prompt = buildSingleRecipePrompt(preferences);

  console.log('Generated prompt:', prompt);

  return parseWithRetry('single', () => generateText('single', prompt, 4096));
}

export async function generateMultipleRecipes(preferences: RecipePreferences): Promise<object> {
  const prompt = buildMultipleRecipePrompt(preferences);

  console.log('Generated prompt:', prompt);

  return parseWithRetry('options', () => generateText('options', prompt, 16384));
}

export async function refineRecipes(input: RefinementInput): Promise<object> {
  const prompt = buildRefinementPrompt(input.recipes, input.refinementInstruction);

  console.log('Refinement prompt:', prompt);

  const parsed = await parseWithRetry('refine', () => generateText('refine', prompt, 16384));

  // Normalize: ensure response always has { receitas: [...] } structure
  if (Array.isArray(parsed)) {
    return { receitas: parsed };
  }
  if (parsed.receitas) {
    return parsed;
  }
  return { receitas: [parsed] };
}

/** Tests pass a fake client and instant waits; the route uses the defaults. */
export interface RecipeImageDeps {
  ai?: { models: Pick<GoogleGenAI['models'], 'generateContent'> };
  retry?: QuotaRetryOptions;
}

export async function generateRecipeImage(input: ImageGenerationInput, deps: RecipeImageDeps = {}): Promise<Buffer> {
  const ai = deps.ai ?? getAIClient(IMAGE_LOCATION);

  const ingredientsList = input.ingredients && Array.isArray(input.ingredients)
    ? input.ingredients.map((i: any) => i.nome || i).join(', ')
    : undefined;

  const preparationMethodText = input.preparationMethod && Array.isArray(input.preparationMethod)
    ? input.preparationMethod.join(' ')
    : undefined;

  const imagePrompt = buildImagePrompt(
    input.recipeTitle,
    input.recipeDescription,
    ingredientsList,
    preparationMethodText,
  );

  // The photo model's quota is tight: a photo asked for right after another one gets a 429.
  const result = await retryOnQuota(
    () =>
      ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: imagePrompt,
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '1:1',
          },
        },
      }),
    { label: 'Recipe photo', ...deps.retry },
  );

  const parts = result.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part) => part.inlineData?.data);

  if (!imagePart?.inlineData?.data) {
    console.log('Image generation returned no image:', JSON.stringify(result.candidates?.[0] ?? result));
    throw new Error('No image generated');
  }

  return Buffer.from(imagePart.inlineData.data, 'base64');
}
