import { Controller, Get, Post, Delete, Param, Body, UseGuards, Request, HttpException, HttpStatus, Inject, forwardRef } from '@nestjs/common';
import { TablesService } from './tables.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JoinTableDto } from './dto/join-table.dto';
import { TableResponseDto } from './dto/table-response.dto';
import { GameService } from '../game/game.service';
import { GameGateway } from '../game/game.gateway';

@Controller('api/tables')
@UseGuards(JwtAuthGuard)
export class TablesController {
  constructor(
    private readonly tablesService: TablesService,
    @Inject(forwardRef(() => GameService))
    private readonly gameService: GameService,
    @Inject(forwardRef(() => GameGateway))
    private readonly gameGateway: GameGateway,
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
      // Check if there's already an active game
      const existingGame = await this.gameService.getGameByTableId(tableId);
      if (existingGame && existingGame.state !== 'complete') {
        // Continue existing game
        this.gameGateway.emitGameStarted(tableId, existingGame.id);
        return { success: true, gameId: existingGame.id };
      }
      
      // Create new game
      const game = await this.gameService.createGame(tableId);
      // Emit gameStarted event to all clients watching this table
      this.gameGateway.emitGameStarted(tableId, game.id);
      // Don't start dealing yet - wait for players to be ready
      return { success: true, gameId: game.id };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('preferences')
  async getPreferences() {
    return this.tablesService.getPreferences();
  }

  @Post('preferences')
  async setPreferences(@Body() body: { tableCount?: number; dealAnimationTime?: number }, @Request() req) {
    // Check if user is admin
    if (req.user.userType !== 'admin') {
      throw new HttpException('Unauthorized: Admin access required', HttpStatus.FORBIDDEN);
    }

    if (body.tableCount !== undefined) {
      if (body.tableCount < 3 || body.tableCount > 36) {
        throw new HttpException('Table count must be between 3 and 36', HttpStatus.BAD_REQUEST);
      }
    }

    if (body.dealAnimationTime !== undefined) {
      if (body.dealAnimationTime < 1000 || body.dealAnimationTime > 42000) {
        throw new HttpException('Deal animation time must be between 1000 and 42000', HttpStatus.BAD_REQUEST);
      }
    }

    await this.tablesService.setPreferences(body);
    return { success: true };
  }
}
