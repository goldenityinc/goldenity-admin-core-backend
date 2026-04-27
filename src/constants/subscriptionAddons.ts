export const SUBSCRIPTION_ADDON_VALUES = ['service_note'] as const;

export type SubscriptionAddon = (typeof SUBSCRIPTION_ADDON_VALUES)[number];

const SUBSCRIPTION_ADDON_SET = new Set<string>(SUBSCRIPTION_ADDON_VALUES);

export function normalizeSubscriptionAddons(addons: unknown): SubscriptionAddon[] {
  if (!Array.isArray(addons)) {
    return [];
  }

  const normalized = addons
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item): item is SubscriptionAddon => SUBSCRIPTION_ADDON_SET.has(item));

  return Array.from(new Set(normalized));
}
