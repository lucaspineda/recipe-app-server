import GeminiController from "../controller/geminiController"
import express from "express"

const router = express.Router()

router.post('/', GeminiController.generatePrompt)

export default router