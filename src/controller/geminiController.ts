import { GoogleGenAI } from '@google/genai';
import { Request, Response } from "express";
import { Storage } from '@google-cloud/storage';

class GeminiController {
  static generatePrompt = async (req: Request, res: Response) => {
    try {
      if (Object.keys(req.body).length === 0) {
        return res.status(400).json({ body: "body must not be empty" });
      }
      const ai = new GoogleGenAI({
        vertexai: true,
        project: 'recipe-app-1bbdc',
        location: 'us-central1'
      });

      const { optionMeal, ingredients, ingredientMode, prepTime, cookingLevel } = req.body;

      // Mapeamento de refeições
      const mealMap: Record<string, string> = {
        'cafe': 'café da manhã',
        'almoco': 'almoço',
        'lanche': 'lanche da tarde',
        'janta': 'jantar',
        'sobremesa': 'sobremesa'
      };
      const mealName = mealMap[optionMeal] || optionMeal;

      // Instruções baseadas no modo de ingredientes
      const ingredientModeInstructions = ingredientMode === 'strict'
        ? `IMPORTANTE: Use APENAS os ingredientes listados pelo usuário: ${ingredients}. Não sugira nem adicione NENHUM ingrediente extra, a não ser temperos básicos (como sal, água, óleo) ou algum ingrediente essencial.`
        : `Ingredientes disponíveis: ${ingredients}. Você pode sugerir a adição de ingredientes que combinam com a receita ou remover algum que não combine bem. Seja criativo mas use a maioria dos ingredientes listados.`;

        console.log(ingredientModeInstructions, 'ingredientModeInstructions')

      // Instruções baseadas no tempo de preparo
      const prepTimeInstructions = prepTime && prepTime > 0
        ? `O tempo total de preparo da receita deve ser de no máximo ${prepTime} minutos. Escolha técnicas e métodos de cocção que respeitem esse limite de tempo.`
        : 'Não há limite de tempo para o preparo.';

      // Instruções baseadas no nível de cozinha
      const cookingLevelInstructions: Record<string, string> = {
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
          - Liberdade para receitas elaboradas e desafiadoras`
      };
      const levelInstructions = cookingLevelInstructions[cookingLevel] || cookingLevelInstructions['intermediario'];

      const prompt = `Crie uma receita para o ${mealName} seguindo estas instruções:

${ingredientModeInstructions}

${prepTimeInstructions}

Instruções sobre dificuldade da receita:
${levelInstructions}

Instruções adicionais para a receita:
- Seja específico em qual tipo de panela adequada para cada etapa da receita.
- Retorne APENAS o JSON, sem markdown ou texto adicional.

Retorne um objeto JSON no seguinte formato:
{
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
  }
  "tempoPreparo": "X Min",
  "Dificuldade": "XXX"
}`;

      console.log('Request body:', req.body);
      console.log('Generated prompt:', prompt);

      const result = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        }
      });
      console.log(result.text);
      return res.status(200).json({ response: result.text });
    } catch (error: any) {
      console.log(error);
      return res.status(500).json({ error: 'Error generating response' });
    }
  };

  static generateRecipeImage = async (req: Request, res: Response) => {
    try {
      console.log('Request body:', JSON.stringify(req.body, null, 2));

      const { recipeTitle, recipeDescription, ingredients, preparationMethod } = req.body;

      if (!recipeTitle) {
        return res.status(400).json({ error: "Recipe title is required" });
      }

      const ai = new GoogleGenAI({
        vertexai: true,
        project: 'recipe-app-1bbdc',
        location: 'us-central1'
      });

      // Format ingredients list if provided
      const ingredientsList = ingredients && Array.isArray(ingredients)
        ? ingredients.map((i: any) => i.nome || i).join(', ')
        : '';

      // Format preparation method if provided
      const preparationMethodText = preparationMethod && Array.isArray(preparationMethod)
        ? preparationMethod.join(' ')
        : '';

      const imagePrompt = `Um prato típico brasileiro de ${recipeTitle}. ${recipeDescription || ''}
        ${ingredientsList ? `Ingredientes visíveis no prato: ${ingredientsList}.` : ''}
        ${preparationMethodText ? `Modo de preparo: ${preparationMethodText}` : ''}
        Fotografia profissional de comida brasileira, extremamente realista e fiel ao prato real,
        apetitoso, bem iluminado com luz natural, qualidade de restaurante brasileiro,
        alta resolução 4K, estilização de alimentos autêntica, hiper-realista, 
        com aparência deliciosa e caseira, público brasileiro.`;

      const result = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: imagePrompt,
        config: {
          numberOfImages: 1,
          aspectRatio: '1:1',
        }
      });

      if (!result.generatedImages?.length) {
        return res.status(500).json({ error: 'No image generated' });
      }

      // Get the image data (base64 encoded)
      const generatedImage = result.generatedImages[0] as any;

      // Log the structure to debug
      console.log('Generated image structure:', JSON.stringify(generatedImage, null, 2));

      // The image data can be in different locations depending on the SDK version
      const imageBase64 = generatedImage.image?.imageBytes ||
        generatedImage.image?.imageData ||
        generatedImage.imageBytes ||
        generatedImage.image;

      if (!imageBase64) {
        console.log('Full generatedImage object:', generatedImage);
        return res.status(500).json({ error: 'Invalid image data format' });
      }

      // Handle both string and Buffer types
      const base64String = typeof imageBase64 === 'string'
        ? imageBase64
        : Buffer.isBuffer(imageBase64)
          ? imageBase64.toString('base64')
          : imageBase64;

      const imageBuffer = Buffer.from(base64String, 'base64');

      // Initialize Cloud Storage
      const storage = new Storage({
        projectId: 'recipe-app-1bbdc'
      });

      const bucketName = 'recipe-app-1bbdc-images';
      const bucket = storage.bucket(bucketName);

      // Generate unique filename
      const timestamp = Date.now();
      const sanitizedTitle = recipeTitle.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const filename = `recipes/${sanitizedTitle}-${timestamp}.png`;

      const file = bucket.file(filename);

      // Upload image to Cloud Storage
      await file.save(imageBuffer, {
        metadata: {
          contentType: 'image/png',
          metadata: {
            recipeTitle: recipeTitle,
            generatedAt: new Date().toISOString()
          }
        }
      });

      // Make the file publicly accessible
      await file.makePublic();

      // Get public URL
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${filename}`;

      return res.status(200).json({
        imageUrl: publicUrl,
        filename: filename
      });
    } catch (error: any) {
      console.log('Image generation error:', error);
      return res.status(500).json({
        error: 'Error generating image',
        details: error.message
      });
    }
  };
}

export default GeminiController;
