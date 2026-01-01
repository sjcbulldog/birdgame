import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Table } from '../../tables/entities/table.entity';

export enum GameState {
  NEW = 'new',
  DEALING = 'dealing',
  BIDDING = 'bidding',
  SELECTING = 'selecting',
  DECLARING_TRUMP = 'declaring_trump',
  PLAYING = 'playing',
  SCORING = 'scoring',
  SHOWSCORE = 'showscore',
  COMPLETE = 'complete'
}

export type PlayerPosition = 'north' | 'east' | 'south' | 'west';
export type PlayerType = 'human' | 'computer';
export type Suit = 'red' | 'black' | 'green' | 'yellow';

@Entity('games')
export class Game {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 36 })
  tableId: string;

  @ManyToOne(() => Table, { nullable: false, eager: true })
  @JoinColumn({ name: 'tableId' })
  table: Table;

  @Column({ type: 'enum', enum: GameState, default: GameState.NEW })
  state: GameState;

  @Column({ type: 'int', default: 0 })
  northSouthScore: number;

  @Column({ type: 'int', default: 0 })
  eastWestScore: number;

  @Column({ type: 'int', default: 0 })
  handNumber: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  dealer: PlayerPosition;

  @Column({ type: 'varchar', length: 10, nullable: true })
  currentBidder: PlayerPosition;

  @Column({ type: 'int', nullable: true })
  highBid: number;

  @Column({ type: 'varchar', length: 10, nullable: true })
  highBidder: PlayerPosition;

  @Column({ type: 'varchar', length: 10, nullable: true })
  trumpSuit: Suit;

  @Column({ type: 'json' })
  playerTypes: Record<PlayerPosition, PlayerType>;

  @Column({ type: 'json', nullable: true })
  playerNames: Record<PlayerPosition, string>;

  @Column({ type: 'json', nullable: true })
  playerReady: Record<PlayerPosition, boolean>;

  @Column({ type: 'json', nullable: true })
  scoringReady: Record<PlayerPosition, boolean>;

  @Column({ type: 'json', nullable: true })
  gameState: any;

  @Column({ type: 'json', nullable: true })
  lastHandResult: {
    biddingTeam: 'northSouth' | 'eastWest';
    bid: number;
    northSouthPoints: number;
    eastWestPoints: number;
    madeBid: boolean;
  };

  @Column({ type: 'varchar', length: 20, nullable: true })
  winningTeam: 'northSouth' | 'eastWest' | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
