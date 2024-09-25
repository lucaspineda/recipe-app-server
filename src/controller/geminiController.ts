import { GoogleGenerativeAI } from "@google/generative-ai";

class GeminiController {

    static generatePrompt = async (req, res) => {

        if (Object.keys(req.body).length === 0) {
            return res.status(400).json({ body: 'body must not be empty' })
        }

        const genAI = new GoogleGenerativeAI('AIzaSyAzs6S46b8FTRzzwyQ84kdezCkmPaQfqqc');
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const { optionMeal, ingredients } = req.body

        const prompt = `Crie uma receita para o ${optionMeal} 
        apenas com os seguintes ingredientes: ${ingredients}`

        const result = await model.generateContent(prompt);

        return res.status(200).json(result.response.text())
    }
}

export default GeminiController