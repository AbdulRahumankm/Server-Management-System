import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listUsersHandler,
  getUserHandler,
  createUserHandler,
  updateUserHandler,
  deleteUserHandler,
  countUsersHandler,
  lookupUsersHandler,
} from '../controllers/userController';

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.get('/count', countUsersHandler);
userRouter.get('/lookup', lookupUsersHandler);
userRouter.get('/', requirePermission('user:manage'), listUsersHandler);
userRouter.post('/', requirePermission('user:manage'), createUserHandler);
userRouter.get('/:id', requirePermission('user:manage'), getUserHandler);
userRouter.put('/:id', requirePermission('user:manage'), updateUserHandler);
userRouter.delete('/:id', requirePermission('user:manage'), deleteUserHandler);
