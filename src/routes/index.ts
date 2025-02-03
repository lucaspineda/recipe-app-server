import verifyTokenMiddleware from  '../middleware/verifyToken';
import teste from './teste'
import gemini from './gemini'
import subscription from '../subscription/subscription.route'
import webhook from '../webhook/webhook.route'
import { Application, Request, Response } from 'express';

interface RouteHandler {
  (app: Application): void;
}

const routes: RouteHandler = (app: Application): void => {
  app.get('/', (req: Request, res: Response): void => {
    res.send('Hello, world!');
  });

  
  verifyTokenMiddleware(app);
  
  app.use('/teste', verifyTokenMiddleware, teste);
  app.use('/test', teste);
  app.use('/gemini', gemini);
  app.use(subscription);
  app.use(webhook)
};
export default routes