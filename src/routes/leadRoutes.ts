import { Router } from 'express';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';
import {
  createLead,
  deleteLead,
  getLeadSummary,
  importLeads,
  listLeads,
  updateLead,
} from '../controllers/leadController';

const router = Router();

// Pipeline penjualan hanya untuk Super Admin Goldenity.
router.use(authMiddleware, roleMiddleware('SUPER_ADMIN'));

router.get('/', listLeads);
router.get('/summary', getLeadSummary);
router.post('/', createLead);
router.post('/import', importLeads);
router.patch('/:leadId', updateLead);
router.delete('/:leadId', deleteLead);

export default router;
