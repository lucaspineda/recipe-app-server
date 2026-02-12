import { Request, Response } from 'express';
import { RecipePreferences } from '../types/recipe';
import {
  generateSingleRecipe,
  generateMultipleRecipes,
  generateRecipeImage as generateImage,
} from '../services/geminiService';
import { uploadRecipeImage } from '../services/storageService';

class GeminiController {
  static generateRecipe = async (req: Request, res: Response) => {
    try {
      if (Object.keys(req.body).length === 0) {
        return res.status(400).json({ body: 'body must not be empty' });
      }

      const preferences: RecipePreferences = req.body;
      console.log('Request body:', req.body);

      const result = await generateSingleRecipe(preferences);
      console.log(result);

      return res.status(200).json({ response: result });
    } catch (error: any) {
      console.log(error);
      return res.status(500).json({ error: 'Error generating response' });
    }
  };

  static generateRecipeOptions = async (req: Request, res: Response) => {
    try {
      if (Object.keys(req.body).length === 0) {
        return res.status(400).json({ body: 'body must not be empty' });
      }

      const preferences: RecipePreferences = req.body;
      console.log('Request body:', req.body);

      const result = await generateMultipleRecipes(preferences);
      console.log(result);

      return res.status(200).json({ response: result });
    } catch (error: any) {
      console.log(error);
      return res.status(500).json({ error: 'Error generating recipe options' });
    }
  };

  static generateRecipeImage = async (req: Request, res: Response) => {
    try {
      console.log('Request body:', JSON.stringify(req.body, null, 2));

      const { recipeTitle, recipeDescription, ingredients, preparationMethod } = req.body;

      if (!recipeTitle) {
        return res.status(400).json({ error: 'Recipe title is required' });
      }

      const imageBuffer = await generateImage({
        recipeTitle,
        recipeDescription,
        ingredients,
        preparationMethod,
      });

      const uploaded = await uploadRecipeImage(imageBuffer, recipeTitle);

      return res.status(200).json(uploaded);
    } catch (error: any) {
      console.log('Image generation error:', error);
      return res.status(500).json({
        error: 'Error generating image',
        details: error.message,
      });
    }
  };
}

export default GeminiController;
