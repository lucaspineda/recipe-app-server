import verifyTokenMiddleware from  '../middleware/verifyToken';
import teste from './teste'
import gemini from './gemini'
import subscription from '../subscription/subscription.route'
import { createJobsRouter } from '../jobs/jobs.route'
import { Application, Request, Response } from 'express';

interface RouteHandler {
  (app: Application): void;
}

const routes: RouteHandler = (app: Application): void => {
  app.get('/', (req: Request, res: Response): void => {
    res.send('Hello, world!');
  });

  // Cloud Scheduler jobs check their own Google token, so they go before the Firebase sign-in check.
  app.use('/jobs', createJobsRouter());

  verifyTokenMiddleware(app);
  
  app.use('/teste', verifyTokenMiddleware, teste);
  app.use('/test', teste);
  app.use('/gemini', gemini);
  app.use('/subscription', subscription);
  // POST /webhook is registered in app.ts, before the JSON body parser.
};
export default routes