import { GoogleGenAI } from '@google/genai';
import { RecipePreferences, ImageGenerationInput } from '../types/recipe';
import {
  buildSingleRecipePrompt,
  buildMultipleRecipePrompt,
  buildImagePrompt,
} from './promptBuilder';

const GCP_PROJECT = 'recipe-app-1bbdc';
const GCP_LOCATION = 'us-central1';

function getAIClient(): GoogleGenAI {
  return new GoogleGenAI({
    vertexai: true,
    project: GCP_PROJECT,
    location: GCP_LOCATION,
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
    model: 'gemini-2.0-flash',
    contents: prompt,
    config: {
      temperature: 0.7,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  });

  return parseJsonResponse(result.text);
}

export async function generateMultipleRecipes(preferences: RecipePreferences): Promise<object> {
  const ai = getAIClient();
  const prompt = buildMultipleRecipePrompt(preferences);

  console.log('Generated prompt:', prompt);

  const result = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: prompt,
    config: {
      temperature: 0.9,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
    },
  });

  return parseJsonResponse(result.text);
}

export async function generateRecipeImage(input: ImageGenerationInput): Promise<Buffer> {
  const ai = getAIClient();

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

  const result = await ai.models.generateImages({
    model: 'imagen-4.0-generate-001',
    prompt: imagePrompt,
    config: {
      numberOfImages: 1,
      aspectRatio: '1:1',
    },
  });

  if (!result.generatedImages?.length) {
    throw new Error('No image generated');
  }

  const generatedImage = result.generatedImages[0] as any;

  const imageBase64 =
    generatedImage.image?.imageBytes ||
    generatedImage.image?.imageData ||
    generatedImage.imageBytes ||
    generatedImage.image;

  if (!imageBase64) {
    console.log('Full generatedImage object:', generatedImage);
    throw new Error('Invalid image data format');
  }

  const base64String = typeof imageBase64 === 'string'
    ? imageBase64
    : Buffer.isBuffer(imageBase64)
      ? imageBase64.toString('base64')
      : imageBase64;

  return Buffer.from(base64String, 'base64');
}
