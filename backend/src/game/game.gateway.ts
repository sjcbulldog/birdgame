import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import { PlayerPosition, Suit } from './entities/game.entity';

@WebSocketGateway({ cors: true })
export class GameGateway implements OnModuleInit {
  @WebSocketServer()
  server: Server;

  constructor(private readonly gameService: GameService) {}

  onModuleInit() {
    this.gameService.setGateway(this);
  }

  @SubscribeMessage('joinGame')
  async handleJoinGame(
    @MessageBody() data: { gameId: string; player: PlayerPosition },
    @ConnectedSocket() client: Socket,
  ) {
    await client.join(`game:${data.gameId}`);
    const game = await this.gameService.getGame(data.gameId);
    
    // Send personalized game state (show only player's own cards)
    const personalizedState = this.personalizeGameState(game, data.player);
    
    // Emit directly to the client that just joined
    client.emit('gameState', personalizedState);
    
    return { event: 'joined', data: { success: true } };
  }

  @SubscribeMessage('playerReady')
  async handlePlayerReady(
    @MessageBody() data: { gameId: string; player: PlayerPosition },
  ) {
    const { game, allReady } = await this.gameService.setPlayerReady(data.gameId, data.player);
    
    // Broadcast updated ready state to all players
    this.server.to(`game:${data.gameId}`).emit('playerReadyUpdate', {
      playerReady: game.playerReady,
      allReady,
    });

    // If all players are ready, start the game
    if (allReady) {
      const startedGame = await this.gameService.startDealing(data.gameId);
      await this.emitGameUpdate(data.gameId);
    }

    return { event: 'playerReady', data: { allReady } };
  }

  @SubscribeMessage('dealingComplete')
  async handleDealingComplete(
    @MessageBody() data: { gameId: string },
  ) {
    // Frontend animation is complete, transition to bidding
    const game = await this.gameService.startBidding(data.gameId);
    await this.emitGameUpdate(data.gameId);
    return { event: 'biddingStarted', data: game };
  }

  @SubscribeMessage('placeBid')
  async handlePlaceBid(
    @MessageBody() data: { gameId: string; player: PlayerPosition; bid: number | 'pass' | 'check' },
  ) {
    const game = await this.gameService.placeBid(data.gameId, data.player, data.bid);
    return { event: 'bidPlaced', data: game };
  }

  @SubscribeMessage('selectCards')
  async handleSelectCards(
    @MessageBody() data: { gameId: string; player: PlayerPosition; selectedCardIds: string[] },
  ) {
    const game = await this.gameService.selectNineCards(data.gameId, data.player, data.selectedCardIds);
    return { event: 'cardsSelected', data: game };
  }

  @SubscribeMessage('declareTrump')
  async handleDeclareTrump(
    @MessageBody() data: { gameId: string; player: PlayerPosition; trumpSuit: Suit },
  ) {
    const game = await this.gameService.declareTrump(data.gameId, data.player, data.trumpSuit);
    return { event: 'trumpDeclared', data: game };
  }

  @SubscribeMessage('playCard')
  async handlePlayCard(
    @MessageBody() data: { gameId: string; player: PlayerPosition; cardId: string },
  ) {
    const game = await this.gameService.playCard(data.gameId, data.player, data.cardId);
    return { event: 'cardPlayed', data: game };
  }

  async emitGameUpdate(gameId: string) {
    try {
      const game = await this.gameService.getGame(gameId);
      
      // For now, emit the same state to all players in the room
      // The personalization should happen per-socket when they join
      // But for updates, we can broadcast to the room
      this.server.to(`game:${gameId}`).emit('gameState', game);
    } catch (error) {
      console.error('Error emitting game update:', error);
    }
  }

  @SubscribeMessage('scoringReady')
  async handleScoringReady(
    @MessageBody() data: { gameId: string; player: string },
  ) {
    const { game, allHumansReady, gameComplete, winningTeam } = await this.gameService.setScoringReady(data.gameId, data.player as any);
    
    // Broadcast updated scoring ready state to all players
    this.server.to(`game:${data.gameId}`).emit('scoringReadyUpdate', {
      scoringReady: game.scoringReady,
      allHumansReady,
      gameComplete,
      winningTeam,
    });

    // If all human players are ready
    if (allHumansReady) {
      if (gameComplete) {
        // Game is complete - transition to COMPLETE state
        await this.gameService.completeGame(data.gameId);
        await this.emitGameUpdate(data.gameId);
      } else {
        // Continue to next hand
        await this.gameService.startDealing(data.gameId);
        await this.emitGameUpdate(data.gameId);
      }
    }

    return { event: 'scoringReady', data: { allHumansReady, gameComplete, winningTeam } };
  }

  @SubscribeMessage('startNextHand')
  async handleStartNextHand(
    @MessageBody() data: { gameId: string },
  ) {
    // Start dealing for the next hand
    const game = await this.gameService.startDealing(data.gameId);
    await this.emitGameUpdate(data.gameId);
    return { event: 'nextHandStarted', data: game };
  }

  emitGameStarted(tableId: string, gameId: string) {
    // Emit globally to all connected clients
    // The frontend will handle navigation for players at this table
    this.server.emit('gameStarted', { tableId, gameId });
  }

  private personalizeGameState(game: any, forPlayer: PlayerPosition) {
    // Clone the game state
    const personalizedGame = JSON.parse(JSON.stringify(game));

    // Hide other players' cards
    const positions: PlayerPosition[] = ['north', 'east', 'south', 'west'];
    for (const position of positions) {
      if (position !== forPlayer && personalizedGame.gameState?.hands?.[position]) {
        // Replace cards with count only
        const cardCount = personalizedGame.gameState.hands[position].length;
        personalizedGame.gameState.hands[position] = Array(cardCount).fill({ hidden: true });
      }
    }

    return personalizedGame;
  }
}
