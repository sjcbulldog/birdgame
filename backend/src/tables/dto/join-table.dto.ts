import { IsString, IsIn } from 'class-validator';

export class JoinTableDto {
  @IsString()
  @IsIn(['north', 'south', 'east', 'west'])
  position: 'north' | 'south' | 'east' | 'west';
}
