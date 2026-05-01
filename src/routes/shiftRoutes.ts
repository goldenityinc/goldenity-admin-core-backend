import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { closeShift, getActiveShift, openShift } from '../controllers/shiftController';

const router = Router();

router.use(authMiddleware);

router.post('/open', openShift);
router.get('/active', getActiveShift);
router.post('/close', closeShift);

export default router;
