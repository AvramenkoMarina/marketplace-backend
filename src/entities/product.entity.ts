import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderItem } from './order-item.entity';
import { User } from './user.entity';

@Entity('products')
@Check('products_price_positive', '"price_cents" > 0')
@Check('products_name_not_blank', 'length(btrim(name)) > 0')
@Check('products_description_not_blank', 'length(btrim(description)) > 0')
@Index('idx_products_lower_name', { synchronize: false })
@Index('idx_products_search_vector', { synchronize: false })
export class Product {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @ManyToOne(() => User, (user) => user.products, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'seller_id' })
  seller!: User;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'integer', name: 'price_cents' })
  priceCents!: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column({
    type: 'tsvector',
    name: 'search_vector',
    asExpression: "to_tsvector('simple', name || ' ' || description)",
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: false,
  })
  searchVector!: string;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems!: OrderItem[];
}
