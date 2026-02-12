import { RecipePreferences } from '../types/recipe';

const MEAL_MAP: Record<string, string> = {
  'cafe': 'café da manhã',
  'almoco': 'almoço',
  'lanche': 'lanche da tarde',
  'janta': 'jantar',
  'sobremesa': 'sobremesa',
};

const COOKING_LEVEL_INSTRUCTIONS: Record<string, string> = {
  'iniciante': `Nível do cozinheiro: INICIANTE. 
    - Use apenas técnicas básicas de cozinha (fritar, cozinhar, assar simples)
    - Evite técnicas complexas como flambagem, emulsificação, etc
    - Forneça instruções BEM DETALHADAS para cada passo
    - Explique termos culinários quando usar
    - Prefira receitas com poucas etapas (máximo 6-8 passos)
    - Indique temperaturas exatas e tempos de cocção`,
  'intermediario': `Nível do cozinheiro: INTERMEDIÁRIO.
    - Pode usar técnicas moderadamente elaboradas
    - Instruções com nível médio de detalhamento
    - Pode incluir algumas técnicas mais avançadas com explicação breve`,
  'avancado': `Nível do cozinheiro: AVANÇADO.
    - Pode usar técnicas complexas e sofisticadas
    - Instruções mais concisas, sem explicações básicas
    - Liberdade para receitas elaboradas e desafiadoras`,
};

const SINGLE_RECIPE_JSON = `{
  "titulo": "titulo da receita",
  "introducao": "breve introdução sobre o prato",
  "tempoPreparo": "XX minutos",
  "ingredientes": [
    {
      "nome": "nome ingrediente",
      "quantidade": "1 unidade"
    }
  ],
  "modoDePreparo": [
    "Passo 1...",
    "Passo 2..."
  ],
  "observacoes": [
    "Dica 1",
    "Dica 2"
  ],
  "informacoesNutricionais": {
    "calorias": "XXX kcal",
    "proteinas": "XXg",
    "carboidratos": "XXg",
    "gorduras": "XXg",
    "fibras": "XXg"
  },
  "tempoPreparo": "X Min",
  "Dificuldade": "XXX"
}`;

const MULTIPLE_RECIPE_JSON = `{
  "receitas": [
    ${SINGLE_RECIPE_JSON}
  ]
}`;

function getMealName(optionMeal: string): string {
  return MEAL_MAP[optionMeal] || optionMeal;
}

function getIngredientInstructions(ingredientMode: string, ingredients: string): string {
  return ingredientMode === 'strict'
    ? `IMPORTANTE: Use APENAS os ingredientes listados pelo usuário: ${ingredients}. Não sugira nem adicione NENHUM ingrediente extra, a não ser temperos básicos (como sal, água, óleo) ou algum ingrediente essencial.`
    : `Ingredientes disponíveis: ${ingredients}. Você pode sugerir a adição de ingredientes que combinam com a receita ou remover algum que não combine bem. Seja criativo mas use a maioria dos ingredientes listados.`;
}

function getPrepTimeInstructions(prepTime?: number): string {
  return prepTime && prepTime > 0
    ? `O tempo total de preparo da receita deve ser de no máximo ${prepTime} minutos. Escolha técnicas e métodos de cocção que respeitem esse limite de tempo.`
    : 'Não há limite de tempo para o preparo.';
}

function getLevelInstructions(cookingLevel: string): string {
  return COOKING_LEVEL_INSTRUCTIONS[cookingLevel] || COOKING_LEVEL_INSTRUCTIONS['intermediario'];
}

export function buildSingleRecipePrompt(preferences: RecipePreferences): string {
  const mealName = getMealName(preferences.optionMeal);
  const ingredientInstructions = getIngredientInstructions(preferences.ingredientMode, preferences.ingredients);
  const prepTimeInstructions = getPrepTimeInstructions(preferences.prepTime);
  const levelInstructions = getLevelInstructions(preferences.cookingLevel);

  return `Crie uma receita para o ${mealName} seguindo estas instruções:

${ingredientInstructions}

${prepTimeInstructions}

Instruções sobre dificuldade da receita:
${levelInstructions}

Instruções adicionais para a receita:
- Seja específico em qual tipo de panela adequada para cada etapa da receita.
- Retorne APENAS o JSON, sem markdown ou texto adicional.

Retorne um objeto JSON no seguinte formato:
${SINGLE_RECIPE_JSON}`;
}

export function buildMultipleRecipePrompt(preferences: RecipePreferences): string {
  const mealName = getMealName(preferences.optionMeal);
  const ingredientInstructions = getIngredientInstructions(preferences.ingredientMode, preferences.ingredients);
  const prepTimeInstructions = getPrepTimeInstructions(preferences.prepTime);
  const levelInstructions = getLevelInstructions(preferences.cookingLevel);

  return `Crie 4 opções DIFERENTES de receitas para o ${mealName} seguindo estas instruções:

${ingredientInstructions}

${prepTimeInstructions}

Instruções sobre dificuldade da receita:
${levelInstructions}

Instruções adicionais para as receitas:
- Cada receita deve ser DIFERENTE das outras (pratos distintos, não variações do mesmo prato).
- Seja específico em qual tipo de panela adequada para cada etapa da receita.
- Retorne APENAS o JSON, sem markdown ou texto adicional.

Retorne um objeto JSON no seguinte formato:
${MULTIPLE_RECIPE_JSON}

O array "receitas" DEVE conter exatamente 4 receitas diferentes.`;
}

export function buildImagePrompt(
  recipeTitle: string,
  recipeDescription?: string,
  ingredientsList?: string,
  preparationMethodText?: string,
): string {
  return `Um prato típico brasileiro de ${recipeTitle}. ${recipeDescription || ''}
    ${ingredientsList ? `Ingredientes visíveis no prato: ${ingredientsList}.` : ''}
    ${preparationMethodText ? `Modo de preparo: ${preparationMethodText}` : ''}
    Fotografia profissional de comida brasileira, extremamente realista e fiel ao prato real,
    apetitoso, bem iluminado com luz natural, qualidade de restaurante brasileiro,
    alta resolução 4K, estilização de alimentos autêntica, hiper-realista, 
    com aparência deliciosa e caseira, público brasileiro.`;
}
