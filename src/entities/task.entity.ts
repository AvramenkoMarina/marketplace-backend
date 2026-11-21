import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Order } from './order.entity';

@Entity('tasks')
@Check('tasks_status_check', `"status" IN ('pending', 'done')`)
@Check('tasks_processed_non_negative', '"processed" >= 0')
@Index('idx_tasks_pending', ['id'], { where: `"status" = 'pending'` })
export class Task {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id!: string;

  @ManyToOne('Order', 'tasks', { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order!: Order | null;

  @Column({ type: 'text' })
  kind!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: 'pending' | 'done';

  @Column({ type: 'integer', default: 0 })
  processed!: number;

  @Column({ type: 'text', name: 'worker_id', nullable: true })
  workerId!: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
