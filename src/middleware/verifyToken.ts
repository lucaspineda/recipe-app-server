import { getAuth } from "firebase-admin/auth";


const verifyTokenMiddleware = async app => {

  app.use(async (req, res, next) => {

    let idToken

    if (req.headers.authorization) {
      idToken = req.headers.authorization
    } else {
      return res.status(403).json({ error: 'Unauthorized' })
    }

    getAuth()
      .verifyIdToken(idToken)
      .then((decodedToken) => {
        const uid = decodedToken.uid;
        res.status(200).json({ uid: uid })
        return next()

      })
      .catch((error) => {
        return res.status(403).json({ error: 'Unauthorized' })
        // return res.status(403).json({ error: error })
      });

  })
}

export default verifyTokenMiddleware