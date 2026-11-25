import type { BusinessCategory } from '@prisma/client';

export const BUSINESS_CATEGORY_VALUES = [
  'GENERAL',
  'RETAIL_FNB',
  'SERVICES_AUTOMOTIVE',
  'BAKERY',
  'CATERING',
  'FLORIST',
  'FROZEN_FOOD',
] as const;

// Modul default per kategori. Edisi vertikal (bakery, katering, florist, frozen food)
// memakai inti yang sama: pre-order + DP dan stok bahan.
export const BUSINESS_CATEGORY_DEFAULT_MODULES: Record<BusinessCategory, readonly string[]> = {
  GENERAL: [],
  RETAIL_FNB: ['module_fnb'],
  SERVICES_AUTOMOTIVE: ['module_service_orders'],
  BAKERY: ['module_pre_order', 'module_inventory', 'module_procurement'],
  CATERING: ['module_pre_order', 'module_inventory', 'module_procurement'],
  FLORIST: ['module_pre_order', 'module_inventory'],
  FROZEN_FOOD: ['module_inventory', 'module_procurement', 'module_supplier_management'],
};

export function getBusinessCategoryDefaultModuleKeys(
  businessCategory: BusinessCategory | null | undefined,
): string[] {
  if (!businessCategory) {
    return [];
  }

  return [...(BUSINESS_CATEGORY_DEFAULT_MODULES[businessCategory] ?? [])];
}
