import { normalizeSubscriptionAddons } from './subscriptionAddons';

export type ModuleCatalogEntry = {
  moduleKey: string;
  displayName: string;
  category: string;
  description: string;
  isCore?: boolean;
  dependencies?: string[];
  defaultConfig?: Record<string, unknown>;
};

export type ResolvedLegacyModuleAssignment = {
  source: 'CORE' | 'BUNDLE' | 'ADDON';
  config?: Record<string, unknown>;
  limits?: Record<string, unknown>;
};

export const POS_MODULE_CATALOG: ModuleCatalogEntry[] = [
  {
    moduleKey: 'module_dashboard',
    displayName: 'Dashboard',
    category: 'core',
    description: 'Dashboard utama POS tenant.',
    isCore: true,
  },
  {
    moduleKey: 'module_sales',
    displayName: 'Sales',
    category: 'operations',
    description: 'Transaksi penjualan utama POS.',
    defaultConfig: {
      allow_manual_discount: true,
      allow_saved_carts: true,
    },
  },
  {
    moduleKey: 'module_inventory',
    displayName: 'Inventory',
    category: 'operations',
    description: 'Kelola stok, produk, dan inventaris.',
  },
  {
    moduleKey: 'module_procurement',
    displayName: 'Procurement',
    category: 'operations',
    description: 'Daftar belanja dan kebutuhan restock.',
  },
  {
    moduleKey: 'module_sales_history',
    displayName: 'Sales History',
    category: 'operations',
    description: 'Riwayat transaksi penjualan.',
    defaultConfig: {
      allow_void_history: true,
    },
  },
  {
    moduleKey: 'module_settings',
    displayName: 'Settings',
    category: 'core',
    description: 'Pengaturan tenant dan perangkat POS.',
    isCore: true,
  },
  {
    moduleKey: 'module_receipt_printing',
    displayName: 'Receipt Printing',
    category: 'capability',
    description: 'Cetak struk penjualan.',
    isCore: true,
    defaultConfig: {
      allow_whatsapp_share: true,
    },
  },
  {
    moduleKey: 'module_offline_mode',
    displayName: 'Offline Mode',
    category: 'capability',
    description: 'Operasional POS saat koneksi tidak tersedia.',
    isCore: true,
  },
  {
    moduleKey: 'module_debt_management',
    displayName: 'Debt Management',
    category: 'operations',
    description: 'Kas bon dan piutang pelanggan.',
    dependencies: ['module_sales', 'module_customer_management'],
  },
  {
    moduleKey: 'module_customer_management',
    displayName: 'Customer Management',
    category: 'master_data',
    description: 'Master data dan lookup pelanggan.',
    defaultConfig: {
      lookup_mode: 'hybrid',
      max_customers: 50000,
    },
  },
  {
    moduleKey: 'module_finance_reports',
    displayName: 'Finance Reports',
    category: 'finance',
    description: 'Laporan keuangan dan cashflow.',
    dependencies: ['module_sales'],
  },
  {
    moduleKey: 'module_expense_management',
    displayName: 'Expense Management',
    category: 'finance',
    description: 'Manajemen pengeluaran operasional.',
  },
  {
    moduleKey: 'module_supplier_management',
    displayName: 'Supplier Management',
    category: 'master_data',
    description: 'Master data supplier.',
    dependencies: ['module_inventory'],
  },
  {
    moduleKey: 'module_tax_reports',
    displayName: 'Tax Reports',
    category: 'finance',
    description: 'Laporan pajak penjualan.',
    dependencies: ['module_sales'],
  },
  {
    moduleKey: 'module_user_management',
    displayName: 'User Management',
    category: 'admin',
    description: 'Kelola user tenant dan staf POS.',
    defaultConfig: {
      max_users: 50,
    },
  },
  {
    moduleKey: 'module_role_management',
    displayName: 'Role Management',
    category: 'admin',
    description: 'Kelola custom role dan RBAC POS.',
    dependencies: ['module_user_management', 'module_custom_rbac'],
  },
  {
    moduleKey: 'module_custom_rbac',
    displayName: 'Custom RBAC',
    category: 'admin',
    description: 'Capability untuk role permission custom.',
  },
  {
    moduleKey: 'module_hardware_devices',
    displayName: 'Hardware Devices',
    category: 'capability',
    description: 'Printer, cash drawer, dan perangkat keras POS.',
    dependencies: ['module_settings'],
  },
  {
    moduleKey: 'module_realtime_sync',
    displayName: 'Realtime Sync',
    category: 'capability',
    description: 'Sinkronisasi realtime cloud.',
    defaultConfig: {
      transport: 'socket_io',
    },
  },
  {
    moduleKey: 'module_category_management',
    displayName: 'Category Management',
    category: 'master_data',
    description: 'Manajemen kategori produk.',
    dependencies: ['module_inventory'],
  },
  {
    moduleKey: 'module_service_orders',
    displayName: 'Service Orders',
    category: 'service',
    description: 'Servis dan perbaikan / service note.',
    dependencies: ['module_sales', 'module_inventory'],
    defaultConfig: {
      allow_walk_in: true,
      require_device_identity: false,
    },
  },
  {
    moduleKey: 'module_service_receipt_printing',
    displayName: 'Service Receipt Printing',
    category: 'service',
    description: 'Cetak tiket atau struk servis.',
    dependencies: ['module_service_orders', 'module_receipt_printing'],
  },
];

const CORE_MODULE_KEYS = [
  'module_dashboard',
  'module_settings',
  'module_receipt_printing',
  'module_offline_mode',
] as const;

const STANDARD_BUNDLE_MODULE_KEYS = [
  'module_sales',
  'module_inventory',
  'module_procurement',
  'module_sales_history',
] as const;

const PROFESSIONAL_BUNDLE_MODULE_KEYS = [
  'module_debt_management',
  'module_customer_management',
  'module_finance_reports',
  'module_expense_management',
  'module_supplier_management',
  'module_tax_reports',
  'module_user_management',
  'module_role_management',
  'module_custom_rbac',
  'module_hardware_devices',
  'module_realtime_sync',
  'module_category_management',
] as const;

const SERVICE_NOTE_ADDON_MODULE_KEYS = [
  'module_service_orders',
  'module_service_receipt_printing',
] as const;

function normalizeTier(tier: string | null | undefined): string {
  return (tier ?? '').toString().trim().toLowerCase();
}

function buildUserManagementLimits(
  tier: string,
): Record<string, unknown> | undefined {
  if (tier === 'standard') {
    return { max_users: 1 };
  }
  if (tier === 'professional') {
    return { max_users: 10 };
  }
  if (tier === 'enterprise') {
    return { max_users: 50 };
  }
  return undefined;
}

function buildCustomerManagementLimits(
  tier: string,
): Record<string, unknown> | undefined {
  if (tier === 'professional' || tier === 'enterprise') {
    return { max_customers: 50000 };
  }
  return undefined;
}

function buildReceiptPrintingConfig(
  tier: string,
): Record<string, unknown> | undefined {
  if (tier === 'standard') {
    return { allow_whatsapp_share: false };
  }
  if (tier === 'professional' || tier === 'enterprise') {
    return { allow_whatsapp_share: true };
  }
  return undefined;
}

function buildSalesHistoryConfig(
  tier: string,
): Record<string, unknown> | undefined {
  if (tier === 'standard') {
    return { allow_void_history: false };
  }
  if (tier === 'professional' || tier === 'enterprise') {
    return { allow_void_history: true };
  }
  return undefined;
}

export function resolveLegacyModuleAssignments(input: {
  tier?: string | null;
  addons?: unknown;
}): Record<string, ResolvedLegacyModuleAssignment> {
  const tier = normalizeTier(input.tier);
  const addons = normalizeSubscriptionAddons(input.addons);
  const assignments: Record<string, ResolvedLegacyModuleAssignment> = {};

  for (const moduleKey of CORE_MODULE_KEYS) {
    assignments[moduleKey] = { source: 'CORE' };
  }

  if (tier === 'standard' || tier === 'professional' || tier === 'enterprise') {
    for (const moduleKey of STANDARD_BUNDLE_MODULE_KEYS) {
      assignments[moduleKey] = { source: 'BUNDLE' };
    }
  }

  if (tier === 'professional' || tier === 'enterprise') {
    for (const moduleKey of PROFESSIONAL_BUNDLE_MODULE_KEYS) {
      assignments[moduleKey] = { source: 'BUNDLE' };
    }
  }

  if (assignments.module_user_management) {
    const limits = buildUserManagementLimits(tier);
    if (limits) {
      assignments.module_user_management = {
        ...assignments.module_user_management,
        limits,
      };
    }
  }

  if (assignments.module_customer_management) {
    const limits = buildCustomerManagementLimits(tier);
    if (limits) {
      assignments.module_customer_management = {
        ...assignments.module_customer_management,
        limits,
      };
    }
  }

  if (assignments.module_receipt_printing) {
    const config = buildReceiptPrintingConfig(tier);
    if (config) {
      assignments.module_receipt_printing = {
        ...assignments.module_receipt_printing,
        config,
      };
    }
  }

  if (assignments.module_sales_history) {
    const config = buildSalesHistoryConfig(tier);
    if (config) {
      assignments.module_sales_history = {
        ...assignments.module_sales_history,
        config,
      };
    }
  }

  if (assignments.module_realtime_sync) {
    assignments.module_realtime_sync = {
      ...assignments.module_realtime_sync,
      config: {
        transport: 'socket_io',
      },
    };
  }

  if (addons.includes('service_note')) {
    for (const moduleKey of SERVICE_NOTE_ADDON_MODULE_KEYS) {
      assignments[moduleKey] = {
        source: 'ADDON',
        config:
            moduleKey === 'module_service_orders'
              ? {
                  allow_walk_in: true,
                  require_device_identity: false,
                }
              : undefined,
      };
    }
  }

  return assignments;
}

export function getPosModuleCatalogMap(): Map<string, ModuleCatalogEntry> {
  return new Map(POS_MODULE_CATALOG.map((entry) => [entry.moduleKey, entry]));
}