export interface RecipePreferences {
  optionMeal: string;
  ingredients: string;
  ingredientMode: 'strict' | 'flexible';
  prepTime?: number;
  cookingLevel: 'iniciante' | 'intermediario' | 'avancado';
}

export interface ImageGenerationInput {
  recipeTitle: string;
  recipeDescription?: string;
  ingredients?: Array<{ nome: string } | string>;
  preparationMethod?: string[];
}

export interface UploadedImage {
  imageUrl: string;
  filename: string;
}
