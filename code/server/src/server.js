import app from './app.js';
import { env } from './config/env.js';

app.listen(env.PORT, () => {
  console.log(`Cinemind server chạy tại http://localhost:${env.PORT}/api/v1`);
});
