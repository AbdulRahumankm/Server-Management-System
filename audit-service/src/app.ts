import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { auditRouter, internalAuditRouter } from './routes/auditRoutes';
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

  app.use('/api/audit-logs', auditRouter);
  app.use('/internal/audit-logs', internalAuditRouter);

  app.use(errorHandler);

  return app;
}
