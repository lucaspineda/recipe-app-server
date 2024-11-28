import { GoogleGenerativeAI } from "@google/generative-ai";

class GeminiController {
  static generatePrompt = async (req, res) => {
    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ body: "body must not be empty" });
    }
    const genAI = new GoogleGenerativeAI(
      "AIzaSyBxuVntQlSSR-NyhUQC6I0wN9GI4YahvG8"
    );

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const { optionMeal, ingredients } = req.body;

    const prompt = `Crie uma receita para o ${optionMeal} 
        apenas com os seguintes ingredientes: ${ingredients}
        e retorne em formato HTML com os titulos com font-weight 600 e o resto do testo co font-weight 400.
        A fonte de todo conteúdo incluindo o título deve ter 16px.
        Deve ter um título e uma breve introdução do prato.
        Após a cada seção deixar um margin de 16px
        No início deixar um margin top de 32px, este estilo deve ficar no h1
        O titulo deve ser h1 e é importanto que tenha o font-size de 16px.
        Do not give me then format as rich text, just plain html. Eg no '''html'''.
        Start the response with <!DOCTYPE html>, not '''html
        `;
    const result = await model.generateContent(prompt);
    return res.status(200).json(result.response.text());
  };
}

export default GeminiController;
