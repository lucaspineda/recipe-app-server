import TesteController from "../controller/testeController.ts"
import express from "express"

const router = express.Router()

router.post('/', TesteController.teste)

export default router