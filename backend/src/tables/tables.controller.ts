import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request, HttpException, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { TablesService } from './tables.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JoinTableDto } from './dto/join-table.dto';
import { TableResponseDto } from './dto/table-response.dto';
import { GameService } from '../game/game.service';

@Controller('api/tables')
@UseGuards(JwtAuthGuard)
export class TablesController {
  constructor(
    private readonly tablesService: TablesService,
    @Inject(forwardRef(() => GameService))
    private readonly gameService: GameService,
  ) {}

  @Get()
  async getAllTables(): Promise<TableResponseDto[]> {
    return this.tablesService.findAllWithPlayersAndWatchers();
  }

  @Post(':id/join')
  async joinTable(
    @Param('id') tableId: string,
    @Body() joinTableDto: JoinTableDto,
    @Request() req,
  ) {
    try {
      await this.tablesService.joinTable(tableId, req.user.userId, joinTableDto.position);
      return { success: true };
    } catch (error) {
      if (error.message === 'Position already taken') {
        throw new HttpException('Position already taken', HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  @Post(':id/leave')
  async leaveTable(@Param('id') tableId: string, @Request() req) {
    await this.tablesService.leaveTable(tableId, req.user.userId);
    return { success: true };
  }

  @Post(':id/watch')
  async watchTable(@Param('id') tableId: string, @Request() req) {
    await this.tablesService.addWatcher(tableId, req.user.userId);
    return { success: true };
  }

  @Delete(':id/watch')
  async unwatchTable(@Param('id') tableId: string, @Request() req) {
    await this.tablesService.removeWatcher(tableId, req.user.userId);
    return { success: true };
  }

  @Post(':id/start-game')
  async startGame(@Param('id') tableId: string, @Request() req) {
    try {
      const game = await this.gameService.createGame(tableId);
      // Don't start dealing yet - wait for players to be ready
      return { success: true, gameId: game.id };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }
}
