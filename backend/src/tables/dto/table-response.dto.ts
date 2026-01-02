export class PlayerDto {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  playerType?: 'human' | 'computer';
}

export class TableResponseDto {
  id: string;
  tableNumber: number;
  positions: {
    north?: PlayerDto;
    south?: PlayerDto;
    east?: PlayerDto;
    west?: PlayerDto;
  };
  watcherCount: number;
  activeGameId?: string;
  watchers?: PlayerDto[];
  playerTypes?: Record<string, 'human' | 'computer'>;
}
