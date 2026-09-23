import { createApp } from './app';

const port = Number(process.env.PORT ?? 4000);
const app = createApp();

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
