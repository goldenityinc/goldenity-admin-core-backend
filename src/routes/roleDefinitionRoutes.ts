import { Router } from 'express';
import { authMiddleware, roleMiddleware, tierMiddleware } from '../middlewares/authMiddleware';
import * as ctrl from '../controllers/roleDefinitionController';

const router = Router();

// Semua endpoint butuh autentikasi + minimal role TENANT_ADMIN/MANAGER
// + tier Professional atau Enterprise
const auth = authMiddleware;
const adminRoles = roleMiddleware('SUPER_ADMIN', 'TENANT_ADMIN', 'CRM_MANAGER', 'ADMIN', 'OWNER', 'MANAGER');
const proTier = tierMiddleware('Professional', 'Enterprise');

/**
 * GET  /api/roles           → list semua custom role milik tenant
 * POST /api/roles           → buat custom role baru (tier-gated)
 * GET  /api/roles/:id       → detail satu custom role
 * PATCH/api/roles/:id       → update nama/deskripsi/permissions
 * DELETE /api/roles/:id     → hapus custom role
 * PATCH /api/roles/assign/:userId → assign/unassign custom role ke user
 */
router.get('/',          auth, adminRoles,          ctrl.listRoles);
router.post('/seed',     auth, adminRoles, proTier, ctrl.seedRoles); // Seed default roles Admin/Kasir/Pajak
router.post('/',         auth, adminRoles, proTier, ctrl.createRole);
router.get('/:id',       auth, adminRoles,          ctrl.getRole);
router.put('/:id',       auth, adminRoles, proTier, ctrl.updateRole);
router.patch('/:id',     auth, adminRoles, proTier, ctrl.updateRole);
router.delete('/:id',    auth, adminRoles, proTier, ctrl.deleteRole);
router.patch('/assign/:userId', auth, adminRoles, proTier, ctrl.assignRole);

export default router;
