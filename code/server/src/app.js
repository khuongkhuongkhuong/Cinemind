import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { rejectNullBytes, securityHeaders } from './middlewares/security.js';

const app = express();

app.disable('x-powered-by'); // không khoe "Express" (giúp kẻ tấn công chọn lỗ hổng theo phiên bản)
if (env.TRUST_PROXY !== undefined) app.set('trust proxy', env.TRUST_PROXY); // đúng req.ip khi chạy sau proxy
app.use(securityHeaders);

// credentials: true để trình duyệt gửi/nhận cookie refresh token; origin phải cụ thể (không được '*').
app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '100kb' })); // body lớn hơn bị từ chối 413 (mọi request của hệ thống đều rất nhỏ)
app.use(rejectNullBytes);

app.use('/api/v1', routes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
