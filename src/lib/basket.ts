import { catalog, categoryLabels, type Category, type Product } from './catalog';

export type Intent = { categories: Category[]; preferredProductIds: string[]; explanation: string };
export type Constraints = { lightweight: boolean; leatherFree: boolean };
export type BasketLine = { productId: string; name: string; category: Category; quantity: number; unitPriceCents: number; totalCents: number };
export type Basket = { lines: BasketLine[]; subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number; budgetCents: number; currency: 'USD'; explanation: string; substitutions: string[]; constraints: Constraints };

const shippingCents = 500;
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function validateBudget(budgetCents: number): void {
  if (!Number.isSafeInteger(budgetCents) || budgetCents < 1 || budgetCents > 100000) {
    throw new Error('Budget must be a whole number of cents between $0.01 and $1,000.00.');
  }
}

function eligibleProduct(product: Product, constraints: Constraints): boolean {
  return product.stock > 0
    && (!constraints.lightweight || product.weightGrams <= 500)
    && (!constraints.leatherFree || !/leather/i.test(product.material));
}

export function recommendBasket(intent: Intent, budgetCents: number, constraints: Constraints): Basket {
  validateBudget(budgetCents);
  if (!intent || !Array.isArray(intent.categories) || intent.categories.length === 0
    || intent.categories.some((category) => typeof category !== 'string' || !Object.hasOwn(categoryLabels, category))) {
    throw new Error('Choose at least one valid product category.');
  }
  if (!Array.isArray(intent.preferredProductIds)) {
    throw new Error('Preferred product IDs must be an array.');
  }
  if (!constraints || typeof constraints.lightweight !== 'boolean' || typeof constraints.leatherFree !== 'boolean') {
    throw new Error('Material and weight constraints must be true or false.');
  }

  const categories = [...new Set(intent.categories)];
  const preferences = intent.preferredProductIds.filter((id) => typeof id === 'string');
  const choices = categories.map((category) => {
    const eligible = catalog
      .filter((product) => product.category === category && eligibleProduct(product, constraints))
      .sort((first, second) => first.priceCents - second.priceCents || first.id.localeCompare(second.id));
    if (eligible.length === 0) {
      throw new Error(`No in-stock ${category} meets your material and weight constraints.`);
    }
    const preferred = preferences
      .map((id) => catalog.find((product) => product.id === id))
      .find((product) => product?.category === category);
    return { category, eligible, preferred };
  });

  const minimumSubtotal = choices.reduce((total, choice) => total + choice.eligible[0].priceCents, 0);
  if (minimumSubtotal + shippingCents > budgetCents) {
    throw new Error(`A complete basket needs at least ${money(minimumSubtotal + shippingCents)} including shipping. Your budget is ${money(budgetCents)}.`);
  }

  const lines: BasketLine[] = [];
  const substitutions: string[] = [];
  let subtotalCents = 0;
  for (const [index, choice] of choices.entries()) {
    // Reserve every remaining category's cheapest eligible item before honoring a preference.
    const remainingMinimum = choices.slice(index + 1).reduce((total, remaining) => total + remaining.eligible[0].priceCents, 0);
    const preferredFits = choice.preferred
      && eligibleProduct(choice.preferred, constraints)
      && subtotalCents + choice.preferred.priceCents + remainingMinimum + shippingCents <= budgetCents;
    const selected = preferredFits ? choice.preferred! : choice.eligible[0];
    if (choice.preferred && selected.id !== choice.preferred.id) {
      substitutions.push(`${choice.preferred.name} was replaced with ${selected.name} to meet your stock, material, weight, and complete budget requirements.`);
    }
    lines.push({
      productId: selected.id, name: selected.name, category: choice.category,
      quantity: 1, unitPriceCents: selected.priceCents, totalCents: selected.priceCents,
    });
    subtotalCents += selected.priceCents;
  }

  const totalCents = subtotalCents + shippingCents;
  return {
    lines, subtotalCents, shippingCents, taxCents: 0, totalCents, budgetCents, currency: 'USD',
    explanation: `${lines.map((line) => line.name).join(', ')} total ${money(totalCents)}, including ${money(shippingCents)} shipping. Every requested category is included.`,
    substitutions, constraints: { ...constraints },
  };
}

export function effectiveBudget(text: string, explicitBudgetCents: number): number {
  validateBudget(explicitBudgetCents);
  if (typeof text !== 'string') throw new Error('Budget request must be text.');

  let budgetCents = explicitBudgetCents;
  for (const phrase of text.matchAll(/\b(?:under|up\s+to|budget)\s*\$\s*/gi)) {
    const remainder = text.slice(phrase.index! + phrase[0].length);
    const rawAmount = remainder.match(/^\S+/)?.[0] ?? '';
    const amount = rawAmount.replace(/[.,!?;:]$/, '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
      throw new Error('Text budget must be a positive dollar amount with at most two decimal places.');
    }
    const [dollars, fraction = ''] = amount.split('.');
    const parsedCents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
    validateBudget(parsedCents);
    budgetCents = Math.min(budgetCents, parsedCents);
  }
  return budgetCents;
}

export function money(cents: number): string {
  return usd.format(cents / 100);
}
