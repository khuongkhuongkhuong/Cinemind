import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';

const app = express();

// credentials: true để trình duyệt gửi/nhận cookie refresh token; origin phải cụ thể (không được '*').
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json());

app.use('/api/v1', routes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
