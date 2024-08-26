

class TesteController {

  static teste = async (req, res) => {

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ body: 'body must not be empty' })
    }
  }
}

export default TesteController