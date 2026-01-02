import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import { PlayerPosition, Suit } from './entities/game.entity';
import { HeartbeatService } from '../gateway/heartbeat.service';
import { TablesGateway } from '../gateway/tables.gateway';
import { UsersService } from '../users/users.service';

@WebSocketGateway({ cors: true })
export class GameGateway implements OnModuleInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly gameService: GameService,
    @Inject(forwardRef(() => HeartbeatService))
    private readonly heartbeatService: HeartbeatService,
    @Inject(forwardRef(() => TablesGateway))
    private readonly tablesGateway: TablesGateway,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  onModuleInit() {
    this.gameService.setGateway(this);
  }

  private async checkUserBanned(gameId: string, player: PlayerPosition, client: Socket): Promise<boolean> {
    try {
      const game = await this.gameService.getGame(gameId);
      const userId = game.table[`${player}Player`]?.id;
      
      if (userId) {
        const user = await this.usersService.findById(userId);
        if (user && user.userType === 'banned') {
          // Emit error to client and disconnect
          client.emit('error', { message: 'You have been banned from this site.' });
          client.disconnect(true);
          return true;
        }
      }
    } catch (error) {
      console.error('Error checking banned status:', error);
    }
    return false;
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (data.userId) {
      this.heartbeatService.recordHeartbeat(data.userId, client.id);
    }
    return { event: 'heartbeat', data: { received: true } };
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
    @ConnectedSocket() client: Socket,
  ) {
    if (await this.checkUserBanned(data.gameId, data.player, client)) return;
    
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
      // Update all home screens with the new game state
      this.tablesGateway.emitTableUpdate();
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
    @ConnectedSocket() client: Socket,
  ) {
    if (await this.checkUserBanned(data.gameId, data.player, client)) return;
    
    const game = await this.gameService.placeBid(data.gameId, data.player, data.bid);
    return { event: 'bidPlaced', data: game };
  }

  @SubscribeMessage('selectCards')
  async handleSelectCards(
    @MessageBody() data: { gameId: string; player: PlayerPosition; selectedCardIds: string[] },
    @ConnectedSocket() client: Socket,
  ) {
    if (await this.checkUserBanned(data.gameId, data.player, client)) return;
    
    const game = await this.gameService.selectNineCards(data.gameId, data.player, data.selectedCardIds);
    return { event: 'cardsSelected', data: game };
  }

  @SubscribeMessage('declareTrump')
  async handleDeclareTrump(
    @MessageBody() data: { gameId: string; player: PlayerPosition; trumpSuit: Suit },
    @ConnectedSocket() client: Socket,
  ) {
    if (await this.checkUserBanned(data.gameId, data.player, client)) return;
    
    const game = await this.gameService.declareTrump(data.gameId, data.player, data.trumpSuit);
    return { event: 'trumpDeclared', data: game };
  }

  @SubscribeMessage('playCard')
  async handlePlayCard(
    @MessageBody() data: { gameId: string; player: PlayerPosition; cardId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (await this.checkUserBanned(data.gameId, data.player, client)) return;
    
    const game = await this.gameService.playCard(data.gameId, data.player, data.cardId);
    return { event: 'cardPlayed', data: game };
  }

  @SubscribeMessage('toggleBRB')
  async handleToggleBRB(
    @MessageBody() data: { gameId: string; player: PlayerPosition },
  ) {
    const game = await this.gameService.togglePlayerBRB(data.gameId, data.player);
    return { event: 'brbToggled', data: game };
  }

  @SubscribeMessage('sayMessage')
  async handleSayMessage(
    @MessageBody() data: { gameId: string; player: PlayerPosition; message: string },
  ) {
    const game = await this.gameService.setPlayerMessage(data.gameId, data.player, data.message);
    return { event: 'messageSent', data: game };
  }

  @SubscribeMessage('claimGotTheRest')
  async handleClaimGotTheRest(
    @MessageBody() data: { gameId: string; player: PlayerPosition },
    @ConnectedSocket() client: Socket,
  ) {
    if (await this.checkUserBanned(data.gameId, data.player, client)) return;
    
    const game = await this.gameService.claimGotTheRest(data.gameId, data.player);
    return { event: 'gotTheRestClaimed', data: game };
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
    // Also update all home screens with the new game state
    this.tablesGateway.emitTableUpdate();
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
