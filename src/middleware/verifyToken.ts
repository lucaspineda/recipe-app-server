import { getAuth } from "firebase-admin/auth";
import ApiError from "../utils/api-errors";
import { Application, Request } from "express";

interface AuthGuardRequest extends Request {
  uid: string;
}

const verifyTokenMiddleware = async (app: Application) => {
  app.use(async (req: Request, res, next) => {
    if (req.path === '/webhook') return next()
    if (!req.headers.authorization)
      return ApiError.unauthorized(res, "Missing authorization header");

    const idToken = req?.headers?.authorization;

    getAuth()
      .verifyIdToken(idToken)
      .then((decodedToken) => {
        const uid = decodedToken.uid;
        (req as AuthGuardRequest).uid = uid;
        return next();
      })
      .catch(() => {
        return ApiError.forbidden(res, "Unauthorized");
      });
  });
};
export default verifyTokenMiddleware;
