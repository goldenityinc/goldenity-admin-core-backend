import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { closeShift, getActiveShift, getShifts, openShift } from '../controllers/shiftController';

const router = Router();

router.use(authMiddleware);

router.get('/', getShifts);
router.post('/open', openShift);
router.get('/active', getActiveShift);
router.post('/close', closeShift);

export default router;
