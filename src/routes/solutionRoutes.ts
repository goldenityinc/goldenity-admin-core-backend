import { Router } from 'express';
import {
  createSolution,
  deleteSolution,
  getSolutions,
  updateSolution,
} from '../controllers/solutionController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);
router.get('/', roleMiddleware('SUPER_ADMIN'), getSolutions);
router.post('/', roleMiddleware('SUPER_ADMIN'), createSolution);
router.put('/:id', roleMiddleware('SUPER_ADMIN'), updateSolution);
router.delete('/:id', roleMiddleware('SUPER_ADMIN'), deleteSolution);

export default router;
