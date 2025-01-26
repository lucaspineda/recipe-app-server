import app from '../app';

const port = process.env.PORT || 3003; // Use the injected PORT or default to 3003
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});