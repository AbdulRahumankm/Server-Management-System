import type { Request, Response } from 'express';
import { requirePermission } from '../src/middleware/requirePermission';

function mockRes() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('requirePermission', () => {
  it('calls next when the user has the permission', () => {
    const req = { user: { role: { permissions: ['server:view'] } } } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    requirePermission('server:view')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when the user lacks the permission', () => {
    const req = { user: { role: { permissions: [] } } } as unknown as Request;
    const res = mockRes();
    const next = jest.fn();

    requirePermission('server:delete')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no authenticated user', () => {
    const req = {} as Request;
    const res = mockRes();
    const next = jest.fn();

    requirePermission('server:view')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
