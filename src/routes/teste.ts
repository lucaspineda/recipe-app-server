import verifyTokenMiddleware from  '../middleware/verifyToken.ts'
import TesteController from "../controller/testeController.ts"
import express from "express"

const router = express.Router()

verifyTokenMiddleware(router)

router.post('/', TesteController.teste)

export default router