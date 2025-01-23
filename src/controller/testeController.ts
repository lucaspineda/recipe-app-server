class TesteController {

  static teste = async (req, res) => {

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ body: 'body must not be empty' })
    }
    return res.status(200).json({ uid: req.uid })
  }

  static test = async (req, res) => {

    console.log('called test')
    return res.status(200).json({ uid:'test' })
  }
}

export default TesteController