import TesteController from "../controller/testeController.ts"
import express from "express"

const router = express.Router()

router.post('/post', TesteController.teste)
router.get('/', TesteController.test)

export default router