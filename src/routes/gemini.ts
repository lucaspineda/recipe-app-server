import GeminiController from "../controller/geminiController"
import express from "express"

const router = express.Router()

router.post('/', GeminiController.generateRecipe)
router.post('/recipe-options', GeminiController.generateRecipeOptions)
router.post('/refine-recipes', GeminiController.refineRecipeOptions)
router.post('/generate-image', GeminiController.generateRecipeImage)

export default router