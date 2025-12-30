import { Controller, Post, Get, Param, Body, UseGuards, Request } from '@nestjs/common';
import { GameService } from './game.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlayerPosition, Suit } from './entities/game.entity';

@Controller('games')
@UseGuards(JwtAuthGuard)
export class GameController {
  constructor(private readonly gameService: GameService) {}

  @Post('table/:tableId/start')
  async startGame(@Param('tableId') tableId: string) {
    const game = await this.gameService.createGame(tableId);
    const dealingGame = await this.gameService.startDealing(game.id);
    return dealingGame;
  }

  @Get(':id')
  async getGame(@Param('id') id: string) {
    return await this.gameService.getGame(id);
  }

  @Get('table/:tableId/current')
  async getGameByTable(@Param('tableId') tableId: string) {
    return await this.gameService.getGameByTableId(tableId);
  }

  @Post(':id/bid')
  async placeBid(
    @Param('id') id: string,
    @Body() body: { player: PlayerPosition; bid: number | 'pass' | 'check' }
  ) {
    return await this.gameService.placeBid(id, body.player, body.bid);
  }

  @Post(':id/select-cards')
  async selectCards(
    @Param('id') id: string,
    @Body() body: { player: PlayerPosition; selectedCardIds: string[] }
  ) {
    return await this.gameService.selectNineCards(id, body.player, body.selectedCardIds);
  }

  @Post(':id/trump')
  async declareTrump(
    @Param('id') id: string,
    @Body() body: { player: PlayerPosition; trumpSuit: Suit }
  ) {
    return await this.gameService.declareTrump(id, body.player, body.trumpSuit);
  }

  @Post(':id/play')
  async playCard(
    @Param('id') id: string,
    @Body() body: { player: PlayerPosition; cardId: string }
  ) {
    return await this.gameService.playCard(id, body.player, body.cardId);
  }

  @Post(':id/score')
  async scoreHand(@Param('id') id: string) {
    return await this.gameService.scoreHand(id);
  }
}
