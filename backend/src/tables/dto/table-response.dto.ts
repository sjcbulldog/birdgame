export class PlayerDto {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
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
}
