import { getAuth } from "firebase-admin/auth";


const verifyTokenMiddleware = async app => {

  app.use(async (req, res, next) => {

    const idToken = req.headers.authorization

    getAuth()
      .verifyIdToken(idToken)
      .then((decodedToken) => {
        const uid = decodedToken.uid
        req.uid = uid
        return next()

      })
      .catch(() => {
        return res.status(403).json({ error: 'Unauthorized' })
      });

  })
}

export default verifyTokenMiddleware