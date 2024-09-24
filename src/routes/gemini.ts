import GeminiController from "../controller/geminiController.ts"
import express from "express"

const router = express.Router()

router.post('/', GeminiController.generatePrompt)

export default router