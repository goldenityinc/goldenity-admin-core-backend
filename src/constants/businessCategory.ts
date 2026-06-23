import type { BusinessCategory } from '@prisma/client';

export const BUSINESS_CATEGORY_VALUES = [
  'GENERAL',
  'RETAIL_FNB',
  'SERVICES_AUTOMOTIVE',
] as const;

export const BUSINESS_CATEGORY_DEFAULT_MODULES: Record<BusinessCategory, readonly string[]> = {
  GENERAL: [],
  RETAIL_FNB: ['module_fnb'],
  SERVICES_AUTOMOTIVE: ['module_service_orders'],
};

export function getBusinessCategoryDefaultModuleKeys(
  businessCategory: BusinessCategory | null | undefined,
): string[] {
  if (!businessCategory) {
    return [];
  }

  return [...(BUSINESS_CATEGORY_DEFAULT_MODULES[businessCategory] ?? [])];
}
