import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Game, GameState, PlayerPosition, PlayerType, Suit } from './entities/game.entity';
import { Table } from '../tables/entities/table.entity';

interface Card {
  color: Suit | 'bird';
  value: number;
  id: string;
}

interface GameStateData {
  hands: Record<PlayerPosition, Card[]>;
  kitty: {
    faceDown: Card[];
    faceUp: Card | null;
  };
  currentTrick: {
    cards: Array<{ player: PlayerPosition; card: Card }>;
    leadPlayer: PlayerPosition | null;
    leadSuit: Suit | null;
  };
  completedTricks: Array<{
    winner: PlayerPosition;
    cards: Array<{ player: PlayerPosition; card: Card }>;
    points: number;
  }>;
  biddingHistory: Array<{
    player: PlayerPosition;
    bid: number | 'pass' | 'check';
    timestamp: Date;
  }>;
}

@Injectable()
export class GameService implements OnModuleInit {
  private gateway: any;

  constructor(
    @InjectRepository(Game)
    private gameRepository: Repository<Game>,
    private dataSource: DataSource,
  ) {}

  onModuleInit() {
  }

  setGateway(gateway: any) {
    this.gateway = gateway;
  }

  async createGame(tableId: string): Promise<Game> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const table = await queryRunner.manager.findOne(Table, {
        where: { id: tableId },
        relations: ['northPlayer', 'eastPlayer', 'southPlayer', 'westPlayer'],
      });

      if (!table) {
        throw new NotFoundException(`Table with ID ${tableId} not found`);
      }

      // Determine player types
      const playerTypes: Record<PlayerPosition, PlayerType> = {
        north: table.northPlayer ? 'human' : 'computer',
        east: table.eastPlayer ? 'human' : 'computer',
        south: table.southPlayer ? 'human' : 'computer',
        west: table.westPlayer ? 'human' : 'computer',
      };

      // Assign player names
      const computerNames = [
        'Alex', 'Bailey', 'Casey', 'Dakota', 'Emerson',
        'Finley', 'Gray', 'Harper', 'Indigo', 'Jordan',
        'Kennedy', 'Logan', 'Morgan', 'Noel', 'Oakley',
        'Parker', 'Quinn', 'Reese', 'Sage', 'Taylor'
      ];
      const usedNames = new Set<string>();
      
      const playerNames: Record<PlayerPosition, string> = {
        north: table.northPlayer ? table.northPlayer.username : this.getRandomUniqueName(computerNames, usedNames),
        east: table.eastPlayer ? table.eastPlayer.username : this.getRandomUniqueName(computerNames, usedNames),
        south: table.southPlayer ? table.southPlayer.username : this.getRandomUniqueName(computerNames, usedNames),
        west: table.westPlayer ? table.westPlayer.username : this.getRandomUniqueName(computerNames, usedNames),
      };

      // Choose a random dealer
      const positions: PlayerPosition[] = ['north', 'east', 'south', 'west'];
      const randomDealer = positions[Math.floor(Math.random() * 4)];

      const game = queryRunner.manager.create(Game, {
        tableId,
        state: GameState.NEW,
        northSouthScore: 0,
        eastWestScore: 0,
        handNumber: 0,
        dealer: randomDealer,
        playerTypes,
        playerNames,
        playerReady: {
          north: playerTypes.north === 'computer',
          east: playerTypes.east === 'computer',
          south: playerTypes.south === 'computer',
          west: playerTypes.west === 'computer',
        },
        gameState: this.initializeGameState(),
      });

      const savedGame = await queryRunner.manager.save(game);
      await queryRunner.commitTransaction();

      return savedGame;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getGame(gameId: string): Promise<Game> {
    const game = await this.gameRepository.findOne({
      where: { id: gameId },
      relations: ['table', 'table.northPlayer', 'table.eastPlayer', 'table.southPlayer', 'table.westPlayer'],
    });

    if (!game) {
      throw new NotFoundException(`Game with ID ${gameId} not found`);
    }

    return game;
  }

  async getGameByTableId(tableId: string): Promise<Game | null> {
    return await this.gameRepository.findOne({
      where: { tableId },
      order: { createdAt: 'DESC' },
      relations: ['table'],
    });
  }

  async getCurrentGameForTable(tableId: string): Promise<Game | null> {
    return this.getGameByTableId(tableId);
  }

  async deleteGame(gameId: string): Promise<void> {
    const result = await this.gameRepository.delete(gameId);
    if (result.affected === 0) {
      throw new NotFoundException(`Game with ID ${gameId} not found`);
    }
  }

  async setPlayerReady(gameId: string, player: PlayerPosition): Promise<{ game: Game; allReady: boolean }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const game = await queryRunner.manager.findOne(Game, {
        where: { id: gameId },
        relations: ['table', 'table.northPlayer', 'table.eastPlayer', 'table.southPlayer', 'table.westPlayer'],
      });

      if (!game) {
        throw new NotFoundException(`Game with ID ${gameId} not found`);
      }

      if (game.state !== GameState.NEW) {
        throw new BadRequestException('Game has already started');
      }

      // Set player ready
      game.playerReady[player] = true;
      await queryRunner.manager.save(game);

      // Check if all human players are ready
      const allReady = Object.entries(game.playerReady).every(([pos, ready]) => ready);

      await queryRunner.commitTransaction();

      return { game, allReady };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async startDealing(gameId: string): Promise<Game> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const game = await queryRunner.manager.findOne(Game, { where: { id: gameId } });

      if (!game) {
        throw new NotFoundException(`Game with ID ${gameId} not found`);
      }

      if (game.state !== GameState.NEW) {
        throw new BadRequestException('Game must be in NEW state to start dealing');
      }

      game.state = GameState.DEALING;
      game.handNumber += 1;
      game.gameState = this.dealCards(game.dealer);

      const savedGame = await queryRunner.manager.save(game);
      await queryRunner.commitTransaction();

      // Emit update after transaction completes
      if (this.gateway) {
        this.gateway.emitGameUpdate(savedGame.id);
      }

      // Wait for frontend to complete dealing animation
      // Frontend will send 'dealingComplete' message when animation finishes

      return savedGame;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async startBidding(gameId: string): Promise<Game> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const game = await queryRunner.manager.findOne(Game, { where: { id: gameId } });

      if (!game) {
        throw new NotFoundException(`Game with ID ${gameId} not found`);
      }

      if (game.state !== GameState.DEALING) {
        throw new BadRequestException('Game must be in DEALING state to start bidding');
      }

      game.state = GameState.BIDDING;
      game.currentBidder = this.getNextPlayer(game.dealer);
      game.gameState.biddingHistory = [];

      const savedGame = await queryRunner.manager.save(game);
      await queryRunner.commitTransaction();

      if (this.gateway) {
        this.gateway.emitGameUpdate(savedGame.id);
      }

      // Trigger computer player if current bidder is computer
      if (game.playerTypes[game.currentBidder] === 'computer') {
        setTimeout(() => this.computerPlaceBid(gameId), 2000);
      }

      return savedGame;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async placeBid(gameId: string, player: PlayerPosition, bid: number | 'pass' | 'check'): Promise<Game> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const game = await queryRunner.manager.findOne(Game, { where: { id: gameId } });

      if (!game) {
        throw new NotFoundException(`Game with ID ${gameId} not found`);
      }

      if (game.state !== GameState.BIDDING) {
        throw new BadRequestException('Game must be in BIDDING state to place bids');
      }

      if (game.currentBidder !== player) {
        throw new BadRequestException('Not your turn to bid');
      }

      // Validate bid
      if (typeof bid === 'number') {
        if (bid < 60 || bid % 5 !== 0) {
          throw new BadRequestException('Bid must be at least 60 and in multiples of 5');
        }
        if (game.highBid && bid <= game.highBid) {
          throw new BadRequestException('Bid must be higher than current high bid');
        }
        game.highBid = bid;
        game.highBidder = player;
      } else if (bid === 'check') {
        const partner = this.getPartner(player);
        if (game.highBidder !== partner) {
          throw new BadRequestException('Can only check if partner is high bidder');
        }
      }

      // Record bid in history
      game.gameState.biddingHistory.push({
        player,
        bid,
        timestamp: new Date(),
      });

      // Check if bidding is complete (3 consecutive passes after a bid)
      const recentBids = game.gameState.biddingHistory.slice(-3);
      const allPassed = recentBids.length === 3 && recentBids.every(b => b.bid === 'pass');

      if (allPassed && game.highBidder) {
        // Bidding complete - transition to selecting
        game.state = GameState.SELECTING;

        // Give kitty cards to high bidder
        const kittyCards = [...game.gameState.kitty.faceDown];
        if (game.gameState.kitty.faceUp) {
          kittyCards.push(game.gameState.kitty.faceUp);
        }
        game.gameState.hands[game.highBidder].push(...kittyCards);
        game.gameState.kitty = { faceDown: [], faceUp: null };

        const savedGame = await queryRunner.manager.save(game);
        await queryRunner.commitTransaction();

        if (this.gateway) {
          this.gateway.emitGameUpdate(savedGame.id);
        }

        // Trigger computer player selection if needed
        if (game.playerTypes[game.highBidder] === 'computer') {
          setTimeout(() => this.computerSelectCards(gameId), 3000);
        }

        return savedGame;
      }

      // Move to next bidder
      game.currentBidder = this.getNextPlayer(player);

      const savedGame = await queryRunner.manager.save(game);
      await queryRunner.commitTransaction();

      if (this.gateway) {
        this.gateway.emitGameUpdate(savedGame.id);
      }

      // Trigger computer player if next bidder is computer
      if (game.playerTypes[game.currentBidder] === 'computer') {
        setTimeout(() => this.computerPlaceBid(gameId), 2000);
      }

      return savedGame;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async selectNineCards(gameId: string, player: PlayerPosition, selectedCardIds: string[]): Promise<Game> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const game = await queryRunner.manager.findOne(Game, { where: { id: gameId } });

      if (!game) {
        throw new NotFoundException(`Game with ID ${gameId} not found`);
      }

      if (game.state !== GameState.SELECTING) {
        throw new BadRequestException('Game must be in SELECTING state');
      }

      if (game.highBidder !== player) {
        throw new BadRequestException('Only the high bidder can select cards');
      }

      if (selectedCardIds.length !== 9) {
        throw new BadRequestException('Must select exactly 9 cards');
      }

      const hand = game.gameState.hands[player];
      if (hand.length !== 15) {
        throw new BadRequestException('Invalid hand size');
      }

      // Keep selected cards, discard others
      const selectedCards = hand.filter(card => selectedCardIds.includes(card.id));
      if (selectedCards.length !== 9) {
        throw new BadRequestException('Invalid card selection');
      }

      game.gameState.hands[player] = selectedCards;
      game.state = GameState.DECLARING_TRUMP;

      const savedGame = await queryRunner.manager.save(game);
      await queryRunner.commitTransaction();

      if (this.gateway) {
        this.gateway.emitGameUpdate(savedGame.id);
      }

      // Trigger computer player trump declaration if needed
      if (game.playerTypes[player] === 'computer') {
        setTimeout(() => this.computerDeclareTrump(gameId), 2000);
      }

      return savedGame;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async declareTrump(gameId: string, player: PlayerPosition, trumpSuit: Suit): Promise<Game> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const game = await queryRunner.manager.findOne(Game, { where: { id: gameId } });

      if (!game) {
        throw new NotFoundException(`Game with ID ${gameId} not found`);
      }

      if (game.state !== GameState.DECLARING_TRUMP) {
        throw new BadRequestException('Game must be in DECLARING_TRUMP state');
      }

      if (game.highBidder !== player) {
        throw new BadRequestException('Only the high bidder can declare trump');
      }

      game.trumpSuit = trumpSuit;
      game.state = GameState.PLAYING;
      game.gameState.currentTrick.leadPlayer = game.highBidder;

      const savedGame = await queryRunner.manager.save(game);
      await queryRunner.commitTransaction();

      if (this.gateway) {
        this.gateway.emitGameUpdate(savedGame.id);
      }

      // Trigger computer player if lead player is computer
      if (game.playerTypes[game.highBidder] === 'computer') {
        setTimeout(() => this.computerPlayCard(gameId), 1500);
      }

      return savedGame;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async playCard(gameId: string, player: PlayerPosition, cardId: string): Promise<Game> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const game = await queryRunner.manager.findOne(Game, { where: { id: gameId } });

      if (!game) {
        throw new NotFoundException(`Game with ID ${gameId} not found`);
      }

      if (game.state !== GameState.PLAYING) {
        throw new BadRequestException('Game must be in PLAYING state');
      }

      const currentTrick = game.gameState.currentTrick;
      const expectedPlayer = currentTrick.cards.length === 0 
        ? currentTrick.leadPlayer 
        : this.getNextPlayer(currentTrick.cards[currentTrick.cards.length - 1].player);

      if (expectedPlayer !== player) {
        throw new BadRequestException('Not your turn to play');
      }

      const hand = game.gameState.hands[player];
      const card = hand.find(c => c.id === cardId);

      if (!card) {
        throw new BadRequestException('Card not in hand');
      }

      // Remove card from hand
      game.gameState.hands[player] = hand.filter(c => c.id !== cardId);

      // Add card to current trick
      currentTrick.cards.push({ player, card });

      // Set lead suit if first card
      if (currentTrick.cards.length === 1) {
        currentTrick.leadSuit = card.color === 'bird' ? null : card.color;
      }

      // Check if trick is complete
      if (currentTrick.cards.length === 4) {
        const winner = this.determineTrickWinner(currentTrick, game.trumpSuit);
        const points = this.calculateTrickPoints(currentTrick.cards);

        game.gameState.completedTricks.push({
          winner,
          cards: [...currentTrick.cards],
          points,
        });

        // Reset current trick
        currentTrick.cards = [];
        currentTrick.leadPlayer = winner;
        currentTrick.leadSuit = null;

        // Check if hand is complete (9 tricks)
        if (game.gameState.completedTricks.length === 9) {
          game.state = GameState.SCORING;

          const savedGame = await queryRunner.manager.save(game);
          await queryRunner.commitTransaction();

          if (this.gateway) {
            this.gateway.emitGameUpdate(savedGame.id);
          }

          // Auto-score the hand
          setTimeout(() => this.scoreHand(gameId), 2000);

          return savedGame;
        }
      }

      const savedGame = await queryRunner.manager.save(game);
      await queryRunner.commitTransaction();

      if (this.gateway) {
        this.gateway.emitGameUpdate(savedGame.id);
      }

      // Trigger next player if computer
      const nextPlayer = currentTrick.cards.length === 0 
        ? currentTrick.leadPlayer 
        : this.getNextPlayer(currentTrick.cards[currentTrick.cards.length - 1].player);

      if (game.playerTypes[nextPlayer] === 'computer') {
        setTimeout(() => this.computerPlayCard(gameId), 1500);
      }

      return savedGame;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async scoreHand(gameId: string): Promise<Game> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const game = await queryRunner.manager.findOne(Game, { where: { id: gameId } });

      if (!game) {
        throw new NotFoundException(`Game with ID ${gameId} not found`);
      }

      // Calculate team scores from completed tricks
      let northSouthPoints = 0;
      let eastWestPoints = 0;

      for (const trick of game.gameState.completedTricks) {
        if (trick.winner === 'north' || trick.winner === 'south') {
          northSouthPoints += trick.points;
        } else {
          eastWestPoints += trick.points;
        }
      }

      game.northSouthScore += northSouthPoints;
      game.eastWestScore += eastWestPoints;

      // Check for winner
      if (game.northSouthScore >= 500 || game.eastWestScore >= 500) {
        game.state = GameState.COMPLETE;
      } else {
        // Start new hand
        game.state = GameState.NEW;
        game.dealer = this.getNextPlayer(game.dealer);
        game.highBid = null;
        game.highBidder = null;
        game.trumpSuit = null;
        game.currentBidder = null;
        game.gameState = this.initializeGameState();
      }

      const savedGame = await queryRunner.manager.save(game);
      await queryRunner.commitTransaction();

      if (this.gateway) {
        this.gateway.emitGameUpdate(savedGame.id);
      }

      return savedGame;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // Helper methods
  private initializeGameState(): GameStateData {
    return {
      hands: {
        north: [],
        east: [],
        south: [],
        west: [],
      },
      kitty: {
        faceDown: [],
        faceUp: null,
      },
      currentTrick: {
        cards: [],
        leadPlayer: null,
        leadSuit: null,
      },
      completedTricks: [],
      biddingHistory: [],
    };
  }

  private createDeck(): Card[] {
    const deck: Card[] = [];
    const colors: Suit[] = ['red', 'black', 'green', 'yellow'];
    let cardId = 0;

    // Add numbered cards 5-14 for each color
    for (const color of colors) {
      for (let value = 5; value <= 14; value++) {
        deck.push({ color, value, id: `${color}-${value}-${cardId++}` });
      }
    }

    // Add special cards
    deck.push({ color: 'bird', value: 0, id: `bird-${cardId++}` });
    deck.push({ color: 'red', value: 1, id: `red-1-${cardId++}` });

    return deck;
  }

  private shuffleDeck(deck: Card[]): void {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }

  private dealCards(dealer: PlayerPosition): GameStateData {
    const deck = this.createDeck();
    this.shuffleDeck(deck);

    const gameState = this.initializeGameState();
    let cardIndex = 0;

    const startPlayer = this.getNextPlayer(dealer);
    const dealOrder = this.getDealOrder(startPlayer);

    // First 5 rounds: each player gets 1, kitty gets 1 face down
    for (let round = 0; round < 5; round++) {
      for (const player of dealOrder) {
        gameState.hands[player].push(deck[cardIndex++]);
      }
      gameState.kitty.faceDown.push(deck[cardIndex++]);
    }

    // Next 4 rounds: each player gets 1
    for (let round = 0; round < 4; round++) {
      for (const player of dealOrder) {
        gameState.hands[player].push(deck[cardIndex++]);
      }
    }

    // Last card to kitty face up
    gameState.kitty.faceUp = deck[cardIndex++];

    return gameState;
  }

  private getNextPlayer(currentPlayer: PlayerPosition): PlayerPosition {
    const order: PlayerPosition[] = ['south', 'west', 'north', 'east'];
    const currentIndex = order.indexOf(currentPlayer);
    return order[(currentIndex + 1) % 4];
  }

  private getPartner(player: PlayerPosition): PlayerPosition {
    const partners: Record<PlayerPosition, PlayerPosition> = {
      north: 'south',
      south: 'north',
      east: 'west',
      west: 'east',
    };
    return partners[player];
  }

  private getRandomUniqueName(names: string[], usedNames: Set<string>): string {
    const availableNames = names.filter(name => !usedNames.has(name));
    if (availableNames.length === 0) {
      // Fallback: add number suffix if all names used
      const name = names[Math.floor(Math.random() * names.length)];
      return `${name}${Math.floor(Math.random() * 100)}`;
    }
    const selectedName = availableNames[Math.floor(Math.random() * availableNames.length)];
    usedNames.add(selectedName);
    return selectedName;
  }

  private getDealOrder(startPlayer: PlayerPosition): PlayerPosition[] {
    const order: PlayerPosition[] = ['south', 'west', 'north', 'east'];
    const startIndex = order.indexOf(startPlayer);
    return [...order.slice(startIndex), ...order.slice(0, startIndex)];
  }

  private determineTrickWinner(trick: GameStateData['currentTrick'], trumpSuit: Suit): PlayerPosition {
    // TODO: Implement trick winner logic based on game rules
    // For now, return first player as placeholder
    return trick.cards[0].player;
  }

  private calculateTrickPoints(cards: Array<{ player: PlayerPosition; card: Card }>): number {
    let points = 0;
    for (const { card } of cards) {
      if (card.value === 5) points += 5;
      else if (card.value === 10) points += 10;
      else if (card.value === 14) points += 10;
      else if (card.color === 'bird') points += 20;
      else if (card.color === 'red' && card.value === 1) points += 30;
    }
    return points;
  }

  // Computer player methods (basic implementations)
  private async computerPlaceBid(gameId: string): Promise<void> {
    try {
      const game = await this.getGame(gameId);
      if (game.state !== GameState.BIDDING) return;

      // Simple strategy: pass for now
      await this.placeBid(gameId, game.currentBidder, 'pass');
    } catch (error) {
      console.error('Computer bid error:', error);
    }
  }

  private async computerSelectCards(gameId: string): Promise<void> {
    try {
      const game = await this.getGame(gameId);
      if (game.state !== GameState.SELECTING || !game.highBidder) return;

      const hand = game.gameState.hands[game.highBidder];
      // Simple strategy: keep first 9 cards
      const selectedCardIds = hand.slice(0, 9).map(c => c.id);
      await this.selectNineCards(gameId, game.highBidder, selectedCardIds);
    } catch (error) {
      console.error('Computer select error:', error);
    }
  }

  private async computerDeclareTrump(gameId: string): Promise<void> {
    try {
      const game = await this.getGame(gameId);
      if (game.state !== GameState.DECLARING_TRUMP || !game.highBidder) return;

      // Simple strategy: declare red
      await this.declareTrump(gameId, game.highBidder, 'red');
    } catch (error) {
      console.error('Computer trump error:', error);
    }
  }

  private async computerPlayCard(gameId: string): Promise<void> {
    try {
      const game = await this.getGame(gameId);
      if (game.state !== GameState.PLAYING) return;

      const currentTrick = game.gameState.currentTrick;
      const player = currentTrick.cards.length === 0 
        ? currentTrick.leadPlayer 
        : this.getNextPlayer(currentTrick.cards[currentTrick.cards.length - 1].player);

      const hand = game.gameState.hands[player];
      if (hand.length === 0) return;

      // Simple strategy: play first card
      await this.playCard(gameId, player, hand[0].id);
    } catch (error) {
      console.error('Computer play error:', error);
    }
  }
}
