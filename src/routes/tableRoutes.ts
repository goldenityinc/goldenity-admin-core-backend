import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { createTable, deleteTable, listTables, patchTable } from '../controllers/tableController';

const router = Router();

router.use(authMiddleware);
router.get('/', listTables);
router.post('/', createTable);
router.patch('/:id', patchTable);
router.delete('/:id', deleteTable);

export default router;
