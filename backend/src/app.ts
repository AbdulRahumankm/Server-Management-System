import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/authRoutes';
import { serverRouter } from './routes/serverRoutes';
import { keyRouter } from './routes/keyRoutes';
import { auditRouter } from './routes/auditRoutes';
import { userRouter } from './routes/userRoutes';
import { roleRouter } from './routes/roleRoutes';
import { inventoryRouter } from './routes/inventoryRoutes';
import { dashboardRouter } from './routes/dashboardRoutes';
import { errorHandler } from './middleware/errorHandler';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/servers', serverRouter);
  app.use('/api/keys', keyRouter);
  app.use('/api/audit-logs', auditRouter);
  app.use('/api/users', userRouter);
  app.use('/api/roles', roleRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/dashboard', dashboardRouter);

  app.use(errorHandler);

  return app;
}
