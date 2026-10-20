import { GoogleGenAI } from '@google/genai';
import { RecipePreferences, ImageGenerationInput, RefinementInput } from '../types/recipe';
import {
  buildSingleRecipePrompt,
  buildMultipleRecipePrompt,
  buildRefinementPrompt,
  buildImagePrompt,
} from './promptBuilder';

const GCP_PROJECT = 'recipe-app-1bbdc';
const GCP_LOCATION = 'us-central1';

// Imagen 4 was retired on Vertex AI; Gemini image models are served from the global endpoint.
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gemini-3.1-flash-image';
const IMAGE_LOCATION = process.env.IMAGE_LOCATION || 'global';

function getAIClient(location: string = GCP_LOCATION): GoogleGenAI {
  return new GoogleGenAI({
    vertexai: true,
    project: GCP_PROJECT,
    location,
  });
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

export async function generateSingleRecipe(preferences: RecipePreferences): Promise<object> {
  const ai = getAIClient();
  const prompt = buildSingleRecipePrompt(preferences);

  console.log('Generated prompt:', prompt);

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      temperature: 0.7,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });

  return parseJsonResponse(result.text);
}

export async function generateMultipleRecipes(preferences: RecipePreferences): Promise<object> {
  const ai = getAIClient();
  const prompt = buildMultipleRecipePrompt(preferences);

  console.log('Generated prompt:', prompt);

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      temperature: 0.9,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });

  return parseJsonResponse(result.text);
}

export async function refineRecipes(input: RefinementInput): Promise<object> {
  const ai = getAIClient();
  const prompt = buildRefinementPrompt(input.recipes, input.refinementInstruction);

  console.log('Refinement prompt:', prompt);

  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      temperature: 0.7,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });

  const parsed = parseJsonResponse(result.text) as any;

  // Normalize: ensure response always has { receitas: [...] } structure
  if (Array.isArray(parsed)) {
    return { receitas: parsed };
  }
  if (parsed.receitas) {
    return parsed;
  }
  return { receitas: [parsed] };
}

export async function generateRecipeImage(input: ImageGenerationInput): Promise<Buffer> {
  const ai = getAIClient(IMAGE_LOCATION);

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

  const result = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: imagePrompt,
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: '1:1',
      },
    },
  });

  const parts = result.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((part) => part.inlineData?.data);

  if (!imagePart?.inlineData?.data) {
    console.log('Image generation returned no image:', JSON.stringify(result.candidates?.[0] ?? result));
    throw new Error('No image generated');
  }

  return Buffer.from(imagePart.inlineData.data, 'base64');
}
