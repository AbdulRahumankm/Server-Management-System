import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { requirePermission } from '../middleware/requirePermission';
import {
  listUsersHandler,
  getUserHandler,
  createUserHandler,
  updateUserHandler,
  deleteUserHandler,
} from '../controllers/userController';

export const userRouter = Router();

userRouter.use(requireAuth);
userRouter.use(requirePermission('user:manage'));

userRouter.get('/', listUsersHandler);
userRouter.post('/', createUserHandler);
userRouter.get('/:id', getUserHandler);
userRouter.put('/:id', updateUserHandler);
userRouter.delete('/:id', deleteUserHandler);
