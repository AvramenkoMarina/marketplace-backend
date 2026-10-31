import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Order } from './order.entity';
import type { Product } from './product.entity';

@Entity('order_items')
@Check('order_items_qty_positive', '"qty" > 0')
@Check('order_items_unit_price_positive', '"unit_price_cents" > 0')
export class OrderItem {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @ManyToOne('Order', 'items', {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order!: Order;

  @ManyToOne('Product', 'orderItems', {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'product_id' })
  product!: Product;

  @Column({ type: 'integer' })
  qty!: number;

  @Column({ type: 'integer', name: 'unit_price_cents' })
  unitPriceCents!: number;
}
