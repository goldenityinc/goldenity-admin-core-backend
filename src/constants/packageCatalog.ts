// Harga daftar per outlet per bulan (Rupiah, sudah termasuk PPN) untuk estimasi MRR di dashboard.
// Sumber: usulan harga K3 di Goldenity-Research-v2.md (belum final). Ubah di sini jika harga berubah.
// Tier "Custom" sengaja tidak punya harga daftar: dihitung terpisah sebagai "langganan custom".

export type PackageInfo = {
  label: string;
  monthlyPricePerOutlet: number | null;
};

const POS_PACKAGES: Record<string, PackageInfo> = {
  Standard: { label: 'POS Standard', monthlyPricePerOutlet: 149_000 },
  Professional: { label: 'POS Pro', monthlyPricePerOutlet: 249_000 },
  Enterprise: { label: 'POS + Produksi', monthlyPricePerOutlet: 499_000 },
  Custom: { label: 'Custom', monthlyPricePerOutlet: null },
};

const ERP_PACKAGE: PackageInfo = { label: 'Bakery / Produksi ERP', monthlyPricePerOutlet: 499_000 };

export function getPackageInfo(solutionCode: string | null | undefined, tier: string | null | undefined): PackageInfo {
  const code = (solutionCode ?? '').toString().trim().toUpperCase();
  const normalizedTier = (tier ?? '').toString().trim();

  if (normalizedTier === 'Custom') {
    return POS_PACKAGES.Custom;
  }

  if (code === 'ERP') {
    return ERP_PACKAGE;
  }

  if (code === 'POS') {
    return POS_PACKAGES[normalizedTier] ?? { label: normalizedTier || 'POS', monthlyPricePerOutlet: null };
  }

  // Solusi lain (MEDICAL, SCHOOL_ERP, dll.) belum punya harga daftar.
  return { label: [code, normalizedTier].filter(Boolean).join(' ') || 'Lainnya', monthlyPricePerOutlet: null };
}
