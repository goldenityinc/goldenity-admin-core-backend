import { Router } from 'express';
import {
  createAppInstance,
  deleteAppInstance,
  getAppInstances,
  getAppInstanceModuleCatalog,
  updateAppInstance,
} from '../controllers/appInstanceController';
import { authMiddleware, roleMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);
router.get('/modules/catalog', roleMiddleware('SUPER_ADMIN'), getAppInstanceModuleCatalog);
router.get('/', roleMiddleware('SUPER_ADMIN'), getAppInstances);
router.post('/', roleMiddleware('SUPER_ADMIN'), createAppInstance);
router.put('/:id', roleMiddleware('SUPER_ADMIN'), updateAppInstance);
router.patch('/:id', roleMiddleware('SUPER_ADMIN'), updateAppInstance);
router.delete('/:id', roleMiddleware('SUPER_ADMIN'), deleteAppInstance);

export default router;
