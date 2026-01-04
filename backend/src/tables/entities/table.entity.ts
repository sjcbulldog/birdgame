import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { User } from '../../users/user.entity';
import { TableWatcher } from './table-watcher.entity';

@Entity('tables')
export class Table {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', unique: true })
  tableNumber: number;

  @Column({ type: 'varchar', nullable: true })
  northPlayerId: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'northPlayerId' })
  northPlayer: User;

  @Column({ type: 'varchar', nullable: true })
  southPlayerId: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'southPlayerId' })
  southPlayer: User;

  @Column({ type: 'varchar', nullable: true })
  eastPlayerId: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'eastPlayerId' })
  eastPlayer: User;

  @Column({ type: 'varchar', nullable: true })
  westPlayerId: string;

  @ManyToOne(() => User, { nullable: true, eager: true })
  @JoinColumn({ name: 'westPlayerId' })
  westPlayer: User;

  @OneToMany(() => TableWatcher, tableWatcher => tableWatcher.table)
  watchers: TableWatcher[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
