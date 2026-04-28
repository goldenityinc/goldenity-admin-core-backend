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
router.get('/:branchId', getBranch);
router.post('/', createBranch);
router.put('/:branchId', updateBranch);
router.patch('/:branchId', updateBranch);
router.delete('/:branchId', deleteBranch);

export default router;