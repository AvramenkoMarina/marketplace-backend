import {
  Check,
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import type { Order } from './order.entity';
import type { Product } from './product.entity';

@Entity('users')
@Unique('users_email_unique', ['email'])
@Check('users_email_not_blank', 'length(btrim(email)) > 0')
@Check('users_display_name_not_blank', 'length(btrim(display_name)) > 0')
export class User {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ type: 'text', name: 'display_name' })
  displayName!: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @OneToMany('Product', 'seller')
  products!: Product[];

  @OneToMany('Order', 'buyer')
  orders!: Order[];
}
