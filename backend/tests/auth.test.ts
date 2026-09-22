import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { seed } from '../prisma/seed';

const app = createApp();
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD ?? 'ChangeMe123!';

describe('auth', () => {
  beforeAll(async () => {
    await seed(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/auth/login', () => {
    it('logs in with valid admin credentials and sets both cookies', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('Admin');
      const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cookies.some((c) => c.startsWith('access_token='))).toBe(true);
      expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
    });

    it('rejects invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: ADMIN_EMAIL, password: 'wrong-password' });

      expect(res.status).toBe(401);
    });

    it('rejects a malformed request body', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 without a session', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns the current user and permissions when authenticated', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

      const res = await agent.get('/api/auth/me');
      expect(res.status).toBe(200);
      expect(res.body.role).toBe('Admin');
      expect(res.body.permissions).toContain('user:manage');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears both cookies', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
      const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cookies.some((c) => c.startsWith('access_token=;'))).toBe(true);
      expect(cookies.some((c) => c.startsWith('refresh_token=;'))).toBe(true);
    });
  });
});
