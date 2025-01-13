import verifyTokenMiddleware from  '../middleware/verifyToken.ts'
import teste from './teste.ts'
import gemini from './gemini.ts'
import subscription from '../subscription/subscription.route.ts'

const routes = app => {

  app.get('/', (req, res) => {
    res.send('Hello, world!');
  })

  verifyTokenMiddleware(app)

  app.use('/teste', teste)
  app.use('/gemini', gemini)
  app.use(subscription)
}
export default routes