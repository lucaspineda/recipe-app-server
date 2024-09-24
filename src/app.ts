import { initializeApp, cert } from 'firebase-admin/app';
import routes from './routes';
import cors from 'cors'

const express = require('express');

const app = express();

app.use(cors())
app.options('*', cors());

app.use(express.json())

initializeApp({
  credential: cert('./src/services/serviceAccountKey.json'),
});

routes(app)

export default app