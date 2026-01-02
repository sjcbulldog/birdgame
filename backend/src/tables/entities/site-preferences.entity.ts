import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('site_preferences')
export class SitePreferences {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: 3 })
  tableCount: number;

  @Column({ default: 10000 })
  dealAnimationTime: number;

  @Column({ default: 1000 })
  trickAnimationTime: number;

  @Column({ default: 2000 })
  trickDisplayDelay: number;

  @Column({ default: 1000 })
  bidWinnerMessageTime: number;
}
