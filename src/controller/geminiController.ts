import { GoogleGenAI } from '@google/genai';
import { Request, Response } from "express";

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
        um objeto com os ingredientes, objeto com o modo de preparo, e objeto com observacoes,
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
          ]
        }`;

      const tokenCount = prompt.split(/\s+/).length;
      if (tokenCount > 100) {
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
}

export default GeminiController;
