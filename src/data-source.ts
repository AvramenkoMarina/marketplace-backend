import 'reflect-metadata';
import { DataSource, type DataSourceOptions, type Logger } from 'typeorm';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { Product } from './entities/product.entity';
import { User } from './entities/user.entity';

const entities = [User, Product, Order, OrderItem];

type DataSourceOverrides = {
  logging?: DataSourceOptions['logging'];
  logger?: Logger;
};

export function createDataSource(
  overrides: DataSourceOverrides = {},
): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    synchronize: false,
    logging: overrides.logging ?? false,
    logger: overrides.logger,
    entities,
    migrations: [__dirname + '/migrations/*.js'],
  });
}

export const AppDataSource = createDataSource();
