import teste from './teste.ts'

const routes = app => {

  app.get('/', (req, res) => {
    res.send('Hello, world!');
  })

  // Demais rotas
  app.use('/teste', teste)
  
}

export default routes