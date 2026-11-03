export type Category = 'bag' | 'bottle' | 'charger' | 'headphones' | 'notebook' | 'lamp';
export type Product = {
  id: string;
  name: string;
  category: Category;
  priceCents: number;
  description: string;
  tags: string[];
  material: string;
  weightGrams: number;
  stock: number;
  color: string;
  badge?: string;
};

export const catalog: Product[] = [
  {
    id: 'daypack', name: 'Everyday Daypack', category: 'bag', priceCents: 2700,
    description: 'A simple daypack with a padded sleeve and room for daily essentials.',
    tags: ['travel', 'lightweight', 'recycled'], material: 'Recycled polyester',
    weightGrams: 420, stock: 18, color: '#839A86', badge: 'Recycled fabric',
  },
  {
    id: 'leather-bag', name: 'Leather Weekender', category: 'bag', priceCents: 8900,
    description: 'A roomy leather carryall with a detachable shoulder strap.',
    tags: ['travel', 'premium'], material: 'Full-grain leather',
    weightGrams: 1100, stock: 7, color: '#A77A59', badge: 'Premium',
  },
  {
    id: 'steel-bottle', name: 'Steel Water Bottle', category: 'bottle', priceCents: 1800,
    description: 'A lightweight 650 ml stainless steel bottle with a screw cap.',
    tags: ['travel', 'lightweight', 'reusable'], material: 'Stainless steel',
    weightGrams: 280, stock: 26, color: '#98A9B0',
  },
  {
    id: 'insulated-bottle', name: 'Insulated Water Bottle', category: 'bottle', priceCents: 3200,
    description: 'A double-wall 750 ml bottle for hot or cold drinks on the go.',
    tags: ['travel', 'insulated', 'reusable'], material: 'Stainless steel',
    weightGrams: 450, stock: 14, color: '#C6A285', badge: 'Insulated',
  },
  {
    id: 'travel-charger', name: 'Compact Travel Charger', category: 'charger', priceCents: 2400,
    description: 'A compact USB-C wall charger for your everyday charging kit.',
    tags: ['travel', 'lightweight', 'usb-c'], material: 'Polycarbonate',
    weightGrams: 110, stock: 22, color: '#E4DDCD',
  },
  {
    id: 'premium-charger', name: 'Dual-Port Charger', category: 'charger', priceCents: 3900,
    description: 'A two-port USB-C wall charger for charging two devices together.',
    tags: ['travel', 'premium', 'usb-c'], material: 'Polycarbonate',
    weightGrams: 190, stock: 12, color: '#787F91', badge: 'Two ports',
  },
  {
    id: 'everyday-headphones', name: 'Everyday Headphones', category: 'headphones', priceCents: 3500,
    description: 'Comfortable wireless on-ear headphones with folding earcups.',
    tags: ['audio', 'lightweight', 'wireless'], material: 'Polycarbonate and fabric',
    weightGrams: 220, stock: 16, color: '#9D92A7',
  },
  {
    id: 'studio-headphones', name: 'Studio Headphones', category: 'headphones', priceCents: 5900,
    description: 'Wireless over-ear headphones with soft fabric cushions.',
    tags: ['audio', 'premium', 'wireless'], material: 'Aluminum and fabric',
    weightGrams: 340, stock: 8, color: '#687A77', badge: 'Over-ear',
  },
  {
    id: 'pocket-notebook', name: 'Pocket Notebook', category: 'notebook', priceCents: 900,
    description: 'A compact ruled notebook with 96 pages for notes on the move.',
    tags: ['stationery', 'lightweight', 'recycled'], material: 'Recycled paper and card',
    weightGrams: 140, stock: 35, color: '#D1B5A3',
  },
  {
    id: 'desk-notebook', name: 'Desk Notebook', category: 'notebook', priceCents: 1600,
    description: 'A clothbound dotted notebook with 160 pages and a ribbon marker.',
    tags: ['stationery', 'premium'], material: 'Paper and cotton cloth',
    weightGrams: 380, stock: 19, color: '#B2B894', badge: 'Clothbound',
  },
  {
    id: 'task-lamp', name: 'Compact Task Lamp', category: 'lamp', priceCents: 2900,
    description: 'A small USB-powered desk lamp with an adjustable light head.',
    tags: ['desk', 'lightweight', 'usb'], material: 'Aluminum and polycarbonate',
    weightGrams: 470, stock: 13, color: '#B5ADA2',
  },
  {
    id: 'ambient-lamp', name: 'Ambient Desk Lamp', category: 'lamp', priceCents: 4900,
    description: 'A warm desk light with a ceramic base and a dimming control.',
    tags: ['desk', 'premium', 'dimmable'], material: 'Ceramic and aluminum',
    weightGrams: 780, stock: 6, color: '#C09B80', badge: 'Dimmable',
  },
];
export const categoryLabels: Record<Category, string> = {
  bag: 'Bags', bottle: 'Bottles', charger: 'Chargers', headphones: 'Headphones', notebook: 'Notebooks', lamp: 'Lamps',
};
