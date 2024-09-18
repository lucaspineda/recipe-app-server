import { GoogleGenerativeAI } from "@google/generative-ai";

class GeminiController {

    static generatePrompt = async (req, res) => {

        if (Object.keys(req.body).length === 0) {
            return res.status(400).json({ body: 'body must not be empty' })
        }

        const genAI = new GoogleGenerativeAI('API_KEY');
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = req.body.prompt

        const result = await model.generateContent(prompt);

        return res.status(200).json(result.response.text())
    }
}

export default GeminiController