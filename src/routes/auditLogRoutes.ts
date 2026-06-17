import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { listAuditLogs } from '../controllers/auditLogController';

const router = Router();

router.use(authMiddleware);
router.get('/', listAuditLogs);

export default router;
