import type { Category } from './catalog';

type ShoppingPreset = {
  name: string;
  request: string;
  budget: string;
  lightweight: boolean;
  leatherFree: boolean;
  categories: readonly Category[];
};

export const shoppingPresets = [
  { name: 'Travel light', request: 'A lightweight travel kit under $75, no leather', budget: '75', lightweight: true, leatherFree: true, categories: ['bag', 'bottle', 'charger'] },
  { name: 'Desk refresh', request: 'A notebook and lamp to refresh my desk under $65', budget: '65', lightweight: false, leatherFree: true, categories: ['notebook', 'lamp'] },
  { name: 'A thoughtful gift', request: 'A thoughtful bottle and notebook gift under $40', budget: '40', lightweight: false, leatherFree: true, categories: ['bottle', 'notebook'] },
] as const satisfies readonly ShoppingPreset[];

function normalizedRequest(request: string): string {
  return request.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();
}

export function findShoppingPreset(request: string): ShoppingPreset | undefined {
  const normalized = normalizedRequest(request);
  return shoppingPresets.find((preset) => normalizedRequest(preset.request) === normalized);
}
