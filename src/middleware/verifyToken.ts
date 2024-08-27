import { getAuth } from "firebase-admin/auth";
import ApiError from "../utils/api-errors";

const verifyTokenMiddleware = async app => {

  app.use(async (req, res, next) => {

    if (!req.headers.authorization)
      return ApiError.unauthorized(res, 'User Unauthorized')

    const idToken = req?.headers?.authorization

    getAuth()
      .verifyIdToken(idToken)
      .then((decodedToken) => {
        const uid = decodedToken.uid
        req.uid = uid
        return next()
      })
      .catch(() => {
        return ApiError.forbidden(res, 'Token invalid')
      });

  })
}
export default verifyTokenMiddleware