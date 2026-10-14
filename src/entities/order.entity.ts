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

export type OrderStatus = 'pending' | 'paid' | 'cancelled';

@Entity('orders')
@Check(
  'orders_status_check',
  `"status" IN ('pending', 'paid', 'cancelled')`,
)
@Check('orders_total_non_negative', '"total_cents" >= 0')
@Index('idx_orders_user_created_at', ['buyer', 'createdAt', 'id'])
@Index('idx_orders_cancelled_created_at', ['createdAt', 'id'], {
  where: `"status" = 'cancelled'`,
})
export class Order {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @ManyToOne(() => User, (user) => user.orders, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  buyer!: User;

  @Column({ type: 'text' })
  status!: OrderStatus;

  @Column({ type: 'integer', name: 'total_cents' })
  totalCents!: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @OneToMany(() => OrderItem, (item) => item.order)
  items!: OrderItem[];
}
