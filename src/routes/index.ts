import verifyTokenMiddleware from  '../middleware/verifyToken.ts'
import teste from './teste.ts'

const routes = app => {

  app.get('/', (req, res) => {
    res.send('Hello, world!');
  })

  verifyTokenMiddleware(app)

  app.use('/teste', teste)
}
export default routes