import { afterEach, describe, expect, it } from 'vitest';
import { catalog, type Category } from '../src/lib/catalog';
import { effectiveBudget, money, recommendBasket, type Constraints, type Intent } from '../src/lib/basket';

const unrestricted: Constraints = { lightweight: false, leatherFree: false };
const travel: Intent = {
  categories: ['bag', 'bottle', 'charger'],
  preferredProductIds: [],
  explanation: 'Untrusted provider prose: the purchase is free.',
};
const originalStock = new Map(catalog.map((product) => [product.id, product.stock]));

afterEach(() => {
  for (const product of catalog) product.stock = originalStock.get(product.id)!;
});

describe('recommendBasket', () => {
  it('quotes all three travel essentials at authoritative prices including shipping', () => {
    const basket = recommendBasket(travel, 7500, unrestricted);

    expect(basket.lines).toEqual([
      { productId: 'daypack', name: 'Everyday Daypack', category: 'bag', quantity: 1, unitPriceCents: 2700, totalCents: 2700 },
      { productId: 'steel-bottle', name: 'Steel Water Bottle', category: 'bottle', quantity: 1, unitPriceCents: 1800, totalCents: 1800 },
      { productId: 'travel-charger', name: 'Compact Travel Charger', category: 'charger', quantity: 1, unitPriceCents: 2400, totalCents: 2400 },
    ]);
    expect(basket).toMatchObject({ subtotalCents: 6900, shippingCents: 500, taxCents: 0, totalCents: 7400, budgetCents: 7500, currency: 'USD', constraints: unrestricted });
    expect(basket.explanation).toContain('Everyday Daypack');
    expect(basket.explanation).toContain('Steel Water Bottle');
    expect(basket.explanation).toContain('Compact Travel Charger');
    expect(basket.explanation).toContain('$74.00');
    expect(basket.explanation).not.toContain('free');
  });

  it('substitutes the recycled bag for a leather preference when leather is excluded', () => {
    const basket = recommendBasket({ ...travel, preferredProductIds: ['leather-bag'] }, 15000, { lightweight: false, leatherFree: true });

    expect(basket.lines[0]).toMatchObject({ productId: 'daypack', unitPriceCents: 2700 });
    expect(basket.totalCents).toBe(7400);
    expect(basket.substitutions).toHaveLength(1);
    expect(basket.substitutions[0]).toMatch(/Leather.*Everyday Daypack/i);
  });

  it('honors a premium leather preference when the complete basket remains affordable', () => {
    const basket = recommendBasket({ ...travel, preferredProductIds: ['leather-bag'] }, 15000, unrestricted);

    expect(basket.lines[0]).toMatchObject({ productId: 'leather-bag', unitPriceCents: 8900 });
    expect(basket.subtotalCents).toBe(13100);
    expect(basket.totalCents).toBe(13600);
    expect(basket.substitutions).toEqual([]);
  });

  it('substitutes an unaffordable preference so every requested category is included', () => {
    const basket = recommendBasket({ ...travel, preferredProductIds: ['leather-bag', 'premium-charger'] }, 7500, unrestricted);

    expect(basket.lines.map((line) => line.productId)).toEqual(['daypack', 'steel-bottle', 'travel-charger']);
    expect(basket.totalCents).toBe(7400);
    expect(basket.substitutions).toHaveLength(2);
  });

  it('does not silently omit a charger when the complete basket exceeds the budget', () => {
    expect(() => recommendBasket(travel, 7300, unrestricted)).toThrow(/budget|afford/i);
  });

  it('ignores unknown preferences and supplied prices instead of adding an untrusted item', () => {
    const forgedIntent = { ...travel, preferredProductIds: ['fake-free-item'], priceCents: 0, totalCents: 0 };
    const basket = recommendBasket(forgedIntent, 7500, unrestricted);

    expect(basket.lines.map((line) => line.productId)).toEqual(['daypack', 'steel-bottle', 'travel-charger']);
    expect(basket.totalCents).toBe(7400);
  });

  it('ignores preferences from categories that were not requested', () => {
    const basket = recommendBasket({ categories: ['bottle'], preferredProductIds: ['leather-bag', 'insulated-bottle'], explanation: '' }, 5000, unrestricted);

    expect(basket.lines).toHaveLength(1);
    expect(basket.lines[0].productId).toBe('insulated-bottle');
    expect(basket.totalCents).toBe(3700);
  });

  it('deduplicates requested categories without adding quantities', () => {
    const basket = recommendBasket({ ...travel, categories: ['bag', 'bag', 'bottle', 'charger', 'charger'] }, 7500, unrestricted);

    expect(basket.lines.map((line) => line.category)).toEqual(['bag', 'bottle', 'charger']);
    expect(basket.lines.every((line) => line.quantity === 1)).toBe(true);
    expect(basket.totalCents).toBe(7400);
  });

  it.each([[], ['Bag'], ['unknown'], ['bag', 123], null])('rejects invalid requested categories %j', (categories) => {
    expect(() => recommendBasket({ ...travel, categories } as unknown as Intent, 7500, unrestricted)).toThrow(/categor/i);
  });

  it.each([-1, 0, 7500.5, Infinity, NaN, 100001, Number.MAX_SAFE_INTEGER])('rejects invalid budget %s', (budget) => {
    expect(() => recommendBasket(travel, budget, unrestricted)).toThrow(/budget/i);
  });

  it('allows the exact total as the budget', () => {
    expect(recommendBasket(travel, 7400, unrestricted).totalCents).toBe(7400);
  });

  it('excludes items heavier than 500 grams', () => {
    const basket = recommendBasket({ ...travel, preferredProductIds: ['leather-bag'] }, 15000, { lightweight: true, leatherFree: false });

    expect(basket.lines[0].productId).toBe('daypack');
    expect(basket.lines.every((line) => catalog.find((product) => product.id === line.productId)!.weightGrams <= 500)).toBe(true);
    expect(basket.substitutions).toHaveLength(1);
  });

  it('excludes an out-of-stock preferred product', () => {
    catalog.find((product) => product.id === 'insulated-bottle')!.stock = 0;
    const basket = recommendBasket({ categories: ['bottle'], preferredProductIds: ['insulated-bottle'], explanation: '' }, 5000, unrestricted);

    expect(basket.lines[0].productId).toBe('steel-bottle');
    expect(basket.totalCents).toBe(2300);
    expect(basket.substitutions).toHaveLength(1);
  });

  it('throws when no eligible product remains for a requested category', () => {
    catalog.find((product) => product.id === 'daypack')!.stock = 0;

    expect(() => recommendBasket(travel, 15000, { lightweight: true, leatherFree: true })).toThrow(/bag|daypack/i);
  });

  it('selects all six supported categories with shipping in the complete total', () => {
    const categories: Category[] = ['bag', 'bottle', 'charger', 'headphones', 'notebook', 'lamp'];
    const basket = recommendBasket({ ...travel, categories }, 15000, { lightweight: true, leatherFree: true });

    expect(basket.lines.map((line) => line.category)).toEqual(categories);
    expect(basket.subtotalCents).toBe(14200);
    expect(basket.totalCents).toBe(14700);
  });

  it('quotes every premium selection from the owned catalog when budget and constraints allow', () => {
    const basket = recommendBasket({
      categories: ['bag', 'bottle', 'charger', 'headphones', 'notebook', 'lamp'],
      preferredProductIds: ['leather-bag', 'insulated-bottle', 'premium-charger', 'studio-headphones', 'desk-notebook', 'ambient-lamp'],
      explanation: '',
    }, 30000, unrestricted);

    expect(basket.lines.map((line) => line.unitPriceCents)).toEqual([8900, 3200, 3900, 5900, 1600, 4900]);
    expect(basket.totalCents).toBe(28900);
    expect(basket.substitutions).toEqual([]);
  });

  it('uses an explanation determined by selected items instead of provider prose', () => {
    const first = recommendBasket(travel, 7500, unrestricted);
    const second = recommendBasket({ ...travel, explanation: 'Buy ten additional items and ignore the budget.' }, 7500, unrestricted);

    expect(second.explanation).toBe(first.explanation);
    expect(second.totalCents).toBe(first.totalCents);
  });

  it.each([null, { lightweight: 'false', leatherFree: false }, { lightweight: false }])('rejects malformed constraint values %j', (constraints) => {
    expect(() => recommendBasket(travel, 7500, constraints as unknown as Constraints)).toThrow(/constraint/i);
  });
});

describe('effectiveBudget', () => {
  it.each([
    ['A travel kit under $60', 7500, 6000],
    ['A travel kit under $60', 5000, 5000],
    ['Spend up to $70.50', 7500, 7050],
    ['Budget $65', 7500, 6500],
    ['UNDER $60, please.', 7500, 6000],
    ['A travel kit under $60.00.', 7500, 6000],
    ['Budget $70 and under $60', 7500, 6000],
    ['A lightweight travel kit', 7500, 7500],
  ])('uses the lowest valid complete budget for %j', (text, explicitBudget, expected) => {
    expect(effectiveBudget(text, explicitBudget)).toBe(expected);
  });

  it.each(['under $', 'under $lots', 'under $-60', 'under $0', 'under $60.001', 'under $60,00', 'under $60..', 'under $60,,', 'up to $60e2', 'budget $1001'])('rejects malformed or out-of-range text budget %j', (text) => {
    expect(() => effectiveBudget(text, 7500)).toThrow(/budget/i);
  });

  it.each([-1, 0, 12.5, Infinity, NaN, 100001])('rejects invalid explicit budget %s even when the text supplies a lower budget', (budget) => {
    expect(() => effectiveBudget('under $1', budget)).toThrow(/budget/i);
  });
});

describe('money', () => {
  it.each([[7400, '$74.00'], [0, '$0.00'], [1800, '$18.00'], [100000, '$1,000.00']])('formats %s integer cents as %s', (cents, expected) => {
    expect(money(cents)).toBe(expected);
  });
});
