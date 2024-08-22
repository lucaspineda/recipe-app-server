const express = require('express');

const app = express();
const port = 3003;

app.get('/', (req, res) => {
  res.send('Hello, world!');
});

app.listen(port, () => {
  console.log(`Server listening
 on port ${port}`);
});