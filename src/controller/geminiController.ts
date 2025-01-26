import { GoogleGenerativeAI } from "@google/generative-ai";
import { Request, Response } from "express";
class GeminiController {
  static generatePrompt = async (req: Request, res: Response) => {

    try {
      if (Object.keys(req.body).length === 0) {
        return res.status(400).json({ body: "body must not be empty" });
      }
      const genAI = new GoogleGenerativeAI(
        "AIzaSyBlyiYUioKr9r4o9PhZjnOM4ZvOjW20KXA"
      );

      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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
      const result = await model.generateContent(prompt);
      console.log("response sent");
      return res.status(200).json(result.response.text());
    } catch (error: any) {
      console.log(error)
      return res.status(500).json({ error: error.message });
    }
  };
}

export default GeminiController;
