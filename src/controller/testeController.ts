import {Request, Response} from 'express'

class TesteController {

  static teste = async (req: Request, res: Response) => {

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ body: 'body must not be empty' })
    }
    return res.status(200).json({ uid: (req as any).uid })
  }

  static test = async (req: Request, res: Response) => {

    console.log('called test')
    return res.status(200).json({ uid:'test' })
  }
}

export default TesteController