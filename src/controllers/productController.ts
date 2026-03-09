import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * @route   GET /api/products
 * @desc    Get all products for current tenant
 * @access  Private (requires authentication)
 */
export const getProducts = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    // TODO: Implement get products logic in service layer
    res.status(200).json({
      success: true,
      message: 'Get products endpoint',
      tenantId: req.user?.tenantId,
    });
  }
);

/**
 * @route   POST /api/products
 * @desc    Create new product
 * @access  Private (TENANT_ADMIN, SUPER_ADMIN)
 */
export const createProduct = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    // TODO: Implement create product logic in service layer
    res.status(201).json({
      success: true,
      message: 'Create product endpoint',
    });
  }
);
