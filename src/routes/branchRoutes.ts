import { Router } from 'express';
import {
  createBranch,
  deleteBranch,
  getBranch,
  listBranches,
  updateBranch,
} from '../controllers/branchController';
import { authMiddleware, tenantMiddleware } from '../middlewares/authMiddleware';

const router = Router({ mergeParams: true });

router.use(authMiddleware);
router.use(tenantMiddleware);
router.get('/', listBranches);
router.get('/:id', getBranch);
router.post('/', createBranch);
router.patch('/:id', updateBranch);
router.delete('/:id', deleteBranch);

export default router;