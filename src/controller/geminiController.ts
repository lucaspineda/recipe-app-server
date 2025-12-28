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


      const { optionMeal, ingredients } = req.body;

      const prompt = `Crie uma receita para o ${optionMeal} 
        apenas com os seguintes ingredientes: ${ingredients}
        e retorne um objeto com o objeto de titulo, objeto de introdução do prato, 
        um objeto com os ingredientes, objeto com o modo de preparo, objeto com observacoes,
        e objeto com informações nutricionais.
        Caso o usuário não tenha passado ingredientes, crie uma receita qualquer.
        Intruções pra a receita:
        - Seja específic em qual tipo de panela adequada para cada etapa da receita.

        siga o padrao: 
        {
          "titulo": "titulo",
          "introducao": "introducao",
          "ingredientes": [
            {
              "nome": "nome ingrediente",
              "quantidade": "1 unidade"
            },
            {
              "nome": "nome ingrediente",
              "quantidade": "5 unidade"
            }
          ],
          "modoDePreparo": [
            "Aqueça uma frigideira em fogo médio.",
            "Lorem ipsum
            "Lorem ipsum
            "Lorem ipsum
            "Lorem ipsum
            "Lorem ipsum"
          ],
          "observacoes": [
            "Lorem ipsum",
            "Lorem ipsum",
            "Lorem ipsum"
          ],
          "informacoesNutricionais": {
            "calorias": "XXX kcal",
            "proteinas": "XXg",
            "carboidratos": "XXg",
            "gorduras": "XXg",
            "fibras": "XXg",
          }
        }`;

      const tokenCount = prompt.split(/\s+/).length;
      if (tokenCount > 200) {
        return res.status(400).json({ error: "Token count exceeds 200" });
      }

      const result = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
        config: {
          temperature: 0,
          maxOutputTokens: 1512,
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
        model: 'imagen-3.0-generate-001',
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
