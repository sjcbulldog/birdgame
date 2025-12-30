import { Entity, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn, JoinColumn, Unique } from 'typeorm';
import { Table } from './table.entity';
import { User } from '../../users/user.entity';

@Entity('table_watchers')
@Unique(['table', 'user'])
export class TableWatcher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Table, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tableId' })
  table: Table;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @CreateDateColumn()
  createdAt: Date;
}
