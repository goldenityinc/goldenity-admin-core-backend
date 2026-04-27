import { Router } from 'express';
import {
  createBranch,
  deleteBranch,
  getBranch,
  listBranches,
  updateBranch,
} from '../controllers/branchController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);
router.get('/', listBranches);
router.get('/:id', getBranch);
router.post('/', createBranch);
router.patch('/:id', updateBranch);
router.delete('/:id', deleteBranch);

export default router;