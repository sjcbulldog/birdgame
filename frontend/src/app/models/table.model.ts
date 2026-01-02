export interface Player {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
}

export interface TablePositions {
  north?: Player;
  south?: Player;
  east?: Player;
  west?: Player;
}

export interface Table {
  id: string;
  tableNumber: number;
  positions: TablePositions;
  watcherCount: number;
  activeGameId?: string;
  watchers?: Player[];
  playerTypes?: Record<string, 'human' | 'computer'>;
  gameState?: string;
  playerNames?: Record<string, string>;
}

export type Position = 'north' | 'south' | 'east' | 'west';
