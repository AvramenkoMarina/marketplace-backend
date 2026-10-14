import 'reflect-metadata';
import { EntityManager } from 'typeorm';
import { createDataSource } from './data-source';
import { Order, type OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Product } from './entities/product.entity';
import { User } from './entities/user.entity';

type UserSeed = {
  email: string;
  displayName: string;
  createdAt: string;
};

type ProductSeed = {
  sellerEmail: string;
  name: string;
  description: string;
  priceCents: number;
  createdAt: string;
};

type ItemSeed = {
  productName: string;
  qty: number;
  unitPriceCents: number;
};

type OrderSeed = {
  buyerEmail: string;
  status: OrderStatus;
  createdAt: string;
  items: ItemSeed[];
};

const USERS: UserSeed[] = [
  {
    email: 'olena.koval@seed.marketplace',
    displayName: 'Олена Коваль',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    email: 'ivan.melnyk@seed.marketplace',
    displayName: 'Іван Мельник',
    createdAt: '2024-01-02T00:00:00.000Z',
  },
  {
    email: 'andrii.tkachenko@seed.marketplace',
    displayName: 'Андрій Ткаченко',
    createdAt: '2024-01-03T00:00:00.000Z',
  },
  {
    email: 'maria.shevchenko@seed.marketplace',
    displayName: 'Марія Шевченко',
    createdAt: '2024-01-04T00:00:00.000Z',
  },
  {
    email: 'taras.bondar@seed.marketplace',
    displayName: 'Тарас Бондар',
    createdAt: '2024-01-05T00:00:00.000Z',
  },
  {
    email: 'sofia.kravchenko@seed.marketplace',
    displayName: 'Софія Кравченко',
    createdAt: '2024-01-06T00:00:00.000Z',
  },
  {
    email: 'daryna.lysenko@seed.marketplace',
    displayName: 'Дарина Лисенко',
    createdAt: '2024-01-07T00:00:00.000Z',
  },
  {
    email: 'oleh.savchuk@seed.marketplace',
    displayName: 'Олег Савчук',
    createdAt: '2024-01-08T00:00:00.000Z',
  },
];

const PRODUCTS: ProductSeed[] = [
  {
    sellerEmail: 'olena.koval@seed.marketplace',
    name: 'Двомісний намет',
    description: 'Легкий двомісний намет для кемпінгу в Карпатах.',
    priceCents: 249900,
    createdAt: '2024-02-01T00:00:00.000Z',
  },
  {
    sellerEmail: 'olena.koval@seed.marketplace',
    name: 'Спальний мішок',
    description: 'Трисезонний спальний мішок, комфорт до нуля.',
    priceCents: 89900,
    createdAt: '2024-02-02T00:00:00.000Z',
  },
  {
    sellerEmail: 'olena.koval@seed.marketplace',
    name: 'Туристичні намети компакт',
    description: 'Легкі туристичні намети для трекінгу.',
    priceCents: 319900,
    createdAt: '2024-02-03T00:00:00.000Z',
  },
  {
    sellerEmail: 'olena.koval@seed.marketplace',
    name: 'Каремат',
    description: 'Складний каремат для ночівлі.',
    priceCents: 45900,
    createdAt: '2024-02-04T00:00:00.000Z',
  },
  {
    sellerEmail: 'ivan.melnyk@seed.marketplace',
    name: 'Туристичний пальник',
    description: 'Газовий пальник для походу.',
    priceCents: 34900,
    createdAt: '2024-02-05T00:00:00.000Z',
  },
  {
    sellerEmail: 'ivan.melnyk@seed.marketplace',
    name: 'Термос',
    description: 'Сталевий термос на один літр.',
    priceCents: 52900,
    createdAt: '2024-02-06T00:00:00.000Z',
  },
  {
    sellerEmail: 'ivan.melnyk@seed.marketplace',
    name: 'Налобний ліхтар',
    description: 'Ліхтар із червоним режимом для нічного виходу.',
    priceCents: 27900,
    createdAt: '2024-02-07T00:00:00.000Z',
  },
  {
    sellerEmail: 'ivan.melnyk@seed.marketplace',
    name: 'Ремонт каркаса наметів',
    description: 'Запчастини для каркаса наметів, дуги та наконечники.',
    priceCents: 18900,
    createdAt: '2024-02-08T00:00:00.000Z',
  },
  {
    sellerEmail: 'andrii.tkachenko@seed.marketplace',
    name: 'Похідний рюкзак',
    description: 'Рюкзак 50 літрів із дощовиком.',
    priceCents: 159900,
    createdAt: '2024-02-09T00:00:00.000Z',
  },
  {
    sellerEmail: 'andrii.tkachenko@seed.marketplace',
    name: 'Трекінгові палиці',
    description: 'Пара палиць із пробковими ручками.',
    priceCents: 74900,
    createdAt: '2024-02-10T00:00:00.000Z',
  },
];

const ORDERS: OrderSeed[] = [
  {
    buyerEmail: 'maria.shevchenko@seed.marketplace',
    status: 'paid',
    createdAt: '2024-03-01T10:00:00.000Z',
    items: [
      { productName: 'Двомісний намет', qty: 1, unitPriceCents: 239900 },
      { productName: 'Спальний мішок', qty: 1, unitPriceCents: 89900 },
    ],
  },
  {
    buyerEmail: 'taras.bondar@seed.marketplace',
    status: 'paid',
    createdAt: '2024-03-02T10:00:00.000Z',
    items: [
      { productName: 'Туристичний пальник', qty: 1, unitPriceCents: 34900 },
      { productName: 'Термос', qty: 2, unitPriceCents: 52900 },
    ],
  },
  {
    buyerEmail: 'sofia.kravchenko@seed.marketplace',
    status: 'paid',
    createdAt: '2024-03-03T10:00:00.000Z',
    items: [
      { productName: 'Похідний рюкзак', qty: 1, unitPriceCents: 159900 },
      { productName: 'Трекінгові палиці', qty: 1, unitPriceCents: 74900 },
    ],
  },
  {
    buyerEmail: 'daryna.lysenko@seed.marketplace',
    status: 'pending',
    createdAt: '2024-03-04T10:00:00.000Z',
    items: [
      { productName: 'Налобний ліхтар', qty: 1, unitPriceCents: 27900 },
      { productName: 'Каремат', qty: 1, unitPriceCents: 45900 },
    ],
  },
  {
    buyerEmail: 'oleh.savchuk@seed.marketplace',
    status: 'cancelled',
    createdAt: '2024-03-05T10:00:00.000Z',
    items: [
      { productName: 'Туристичні намети компакт', qty: 1, unitPriceCents: 319900 },
      { productName: 'Ремонт каркаса наметів', qty: 1, unitPriceCents: 18900 },
    ],
  },
  {
    buyerEmail: 'maria.shevchenko@seed.marketplace',
    status: 'paid',
    createdAt: '2024-03-06T10:00:00.000Z',
    items: [
      { productName: 'Термос', qty: 1, unitPriceCents: 52900 },
      { productName: 'Налобний ліхтар', qty: 1, unitPriceCents: 27900 },
    ],
  },
  {
    buyerEmail: 'taras.bondar@seed.marketplace',
    status: 'pending',
    createdAt: '2024-03-07T10:00:00.000Z',
    items: [{ productName: 'Похідний рюкзак', qty: 1, unitPriceCents: 159900 }],
  },
  {
    buyerEmail: 'olena.koval@seed.marketplace',
    status: 'paid',
    createdAt: '2024-03-08T10:00:00.000Z',
    items: [
      { productName: 'Трекінгові палиці', qty: 1, unitPriceCents: 74900 },
      { productName: 'Туристичний пальник', qty: 1, unitPriceCents: 34900 },
    ],
  },
];

function totalCents(items: ItemSeed[]): number {
  return items.reduce((sum, item) => sum + item.qty * item.unitPriceCents, 0);
}

async function ensureUser(manager: EntityManager, input: UserSeed): Promise<User> {
  const existing = await manager.findOne(User, { where: { email: input.email } });
  if (existing) {
    return existing;
  }
  return manager.save(
    manager.create(User, {
      email: input.email,
      displayName: input.displayName,
      createdAt: new Date(input.createdAt),
    }),
  );
}

async function ensureProduct(
  manager: EntityManager,
  input: ProductSeed,
  sellers: Map<string, User>,
): Promise<Product> {
  const existing = await manager.findOne(Product, { where: { name: input.name } });
  if (existing) {
    return existing;
  }
  const seller = sellers.get(input.sellerEmail);
  if (!seller) {
    throw new Error(`Seed seller not found: ${input.sellerEmail}`);
  }
  return manager.save(
    manager.create(Product, {
      seller,
      name: input.name,
      description: input.description,
      priceCents: input.priceCents,
      createdAt: new Date(input.createdAt),
    }),
  );
}

async function ensureOrder(
  manager: EntityManager,
  input: OrderSeed,
  buyers: Map<string, User>,
  products: Map<string, Product>,
): Promise<void> {
  const buyer = buyers.get(input.buyerEmail);
  if (!buyer) {
    throw new Error(`Seed buyer not found: ${input.buyerEmail}`);
  }
  const createdAt = new Date(input.createdAt);
  let order = await manager.findOne(Order, {
    where: { buyer: { id: buyer.id }, createdAt },
  });
  if (!order) {
    order = await manager.save(
      manager.create(Order, {
        buyer,
        status: input.status,
        totalCents: totalCents(input.items),
        createdAt,
      }),
    );
  }

  for (const item of input.items) {
    const product = products.get(item.productName);
    if (!product) {
      throw new Error(`Seed product not found: ${item.productName}`);
    }
    const existing = await manager.findOne(OrderItem, {
      where: { order: { id: order.id }, product: { id: product.id } },
    });
    if (existing) {
      continue;
    }
    await manager.save(
      manager.create(OrderItem, {
        order,
        product,
        qty: item.qty,
        unitPriceCents: item.unitPriceCents,
      }),
    );
  }
}

async function seed(manager: EntityManager): Promise<void> {
  const sellers = new Map<string, User>();
  for (const input of USERS) {
    sellers.set(input.email, await ensureUser(manager, input));
  }

  const products = new Map<string, Product>();
  for (const input of PRODUCTS) {
    products.set(input.name, await ensureProduct(manager, input, sellers));
  }

  for (const input of ORDERS) {
    await ensureOrder(manager, input, sellers, products);
  }
}

async function printCounts(manager: EntityManager): Promise<void> {
  const [users, products, orders, items] = await Promise.all([
    manager.count(User),
    manager.count(Product),
    manager.count(Order),
    manager.count(OrderItem),
  ]);
  console.log(
    `seed counts users=${users} products=${products} orders=${orders} order_items=${items}`,
  );
}

async function main(): Promise<void> {
  const dataSource = createDataSource();
  await dataSource.initialize();
  try {
    await dataSource.transaction(seed);
    await printCounts(dataSource.manager);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
