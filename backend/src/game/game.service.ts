import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Game, GameState, PlayerPosition, PlayerType, Suit } from './entities/game.entity';
import { Table } from '../tables/entities/table.entity';
import { AIPlayer } from './ai-player';

interface Card {
  color: Suit | 'bird';
  value: number;
  id: string;
}

interface GameStateData {
  hands: Record<PlayerPosition, Card[]>;
  centerPile: {
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
  private aiPlayers: Map<string, Map<PlayerPosition, AIPlayer>>;

  constructor(
    @InjectRepository(Game)
    private gameRepository: Repository<Game>,
    private dataSource: DataSource,
  ) {
    this.aiPlayers = new Map();
  }

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
        'Ada', 'Ajax', 'Alan', 'Algo', 'Alpha', 'Amber', 'Apex', 'Arc', 'Argo', 'Aria',
        'Atlas', 'Atom', 'Aurora', 'Bash', 'Beta', 'Binary', 'Bit', 'Bolt', 'Bool', 'Boost',
        'Byte', 'Cache', 'Cargo', 'Cipher', 'Circuit', 'Clang', 'Clojure', 'Cloud', 'Cobalt', 'Codec',
        'Comet', 'Compile', 'Core', 'Cron', 'Crypto', 'Crystal', 'Cube', 'Curl', 'Cyber', 'Cypher',
        'Dart', 'Data', 'Debug', 'Delta', 'Deno', 'Diesel', 'Digit', 'Django', 'Daemon', 'Dot',
        'Echo', 'Edge', 'Electron', 'Ember', 'Ether', 'Exec', 'Fiber', 'Flux', 'Fork', 'Fortran',
        'Frame', 'Gamma', 'Git', 'Gopher', 'Grace', 'Graph', 'Grep', 'Hack', 'Hash', 'Helix',
        'Hex', 'Index', 'Iota', 'Ion', 'Iris', 'Java', 'Json', 'Julia', 'Kappa', 'Karma',
        'Kernel', 'Lambda', 'Laser', 'Lex', 'Linux', 'Lisp', 'Logic', 'Loop', 'Lua', 'Lynx',
        'Matrix', 'Mega', 'Merge', 'Mint', 'Mojo', 'Nano', 'Neo', 'Neural', 'Nexus', 'Node'
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

      // Initialize AI players with current game state
      await this.initializeAIPlayers(savedGame);

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

        // Give centerPile cards to high bidder
        const centerPileCards = [...game.gameState.centerPile.faceDown];
        if (game.gameState.centerPile.faceUp) {
          centerPileCards.push(game.gameState.centerPile.faceUp);
        }
        game.gameState.hands[game.highBidder].push(...centerPileCards);
        game.gameState.centerPile = { faceDown: [], faceUp: null };

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

      // Store the 6 discarded cards (the ones not selected from the 15-card hand)
      const discarded = hand.filter(c => !selectedCardIds.includes(c.id));

      // Update AI player with discarded cards knowledge (if AI won the bid)
      if (game.playerTypes[player] === 'computer') {
        const aiPlayer = this.getAIPlayer(gameId, player);
        aiPlayer.setDiscardedCards(discarded);
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

      // Update all AI players with trump suit
      await this.initializeAIPlayers(savedGame);

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

      // Validate card can be played according to rules
      this.validateCardPlay(card, hand, currentTrick, game.trumpSuit);

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

      // Update AI players with new game state
      await this.initializeAIPlayers(savedGame);

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
        // Cleanup AI players for completed game
        this.cleanupAIPlayers(gameId);
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
      centerPile: {
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

    // First 5 rounds: each player gets 1, centerPile gets 1 face down
    for (let round = 0; round < 5; round++) {
      for (const player of dealOrder) {
        gameState.hands[player].push(deck[cardIndex++]);
      }
      gameState.centerPile.faceDown.push(deck[cardIndex++]);
    }

    // Next 4 rounds: each player gets 1
    for (let round = 0; round < 4; round++) {
      for (const player of dealOrder) {
        gameState.hands[player].push(deck[cardIndex++]);
      }
    }

    // Last card to centerPile face up
    gameState.centerPile.faceUp = deck[cardIndex++];

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
    if (trick.cards.length === 0) {
      throw new Error('Cannot determine winner of empty trick');
    }

    const leadSuit = trick.leadSuit;
    let winningPlayer = trick.cards[0].player;
    let winningCard = trick.cards[0].card;

    for (let i = 1; i < trick.cards.length; i++) {
      const { player, card } = trick.cards[i];
      
      // Check if this card beats the current winning card
      if (this.cardBeatsCard(card, winningCard, trumpSuit, leadSuit)) {
        winningPlayer = player;
        winningCard = card;
      }
    }

    return winningPlayer;
  }

  private cardBeatsCard(card: Card, winningCard: Card, trumpSuit: Suit, leadSuit: Suit | null): boolean {
    const cardIsTrump = card.color === trumpSuit || card.color === 'bird' || (card.color === 'red' && card.value === 1);
    const winningIsTrump = winningCard.color === trumpSuit || winningCard.color === 'bird' || (winningCard.color === 'red' && winningCard.value === 1);

    // If card is trump and winning card is not, card wins
    if (cardIsTrump && !winningIsTrump) {
      return true;
    }

    // If winning card is trump and card is not, card loses
    if (!cardIsTrump && winningIsTrump) {
      return false;
    }

    // Both are trump - compare trump hierarchy
    if (cardIsTrump && winningIsTrump) {
      return this.compareTrumpCards(card, winningCard);
    }

    // Neither is trump - both must follow lead suit (or both are off-suit)
    // Only cards of lead suit can win
    const cardFollowsLead = card.color === leadSuit;
    const winningFollowsLead = winningCard.color === leadSuit;

    // If card follows lead but winning doesn't, card wins
    if (cardFollowsLead && !winningFollowsLead) {
      return true;
    }

    // If winning follows lead but card doesn't, card loses
    if (!cardFollowsLead && winningFollowsLead) {
      return false;
    }

    // Both follow lead suit (or neither does) - compare values
    if (cardFollowsLead && winningFollowsLead) {
      return card.value > winningCard.value;
    }

    // Neither follows lead suit - first card played wins (no change)
    return false;
  }

  private compareTrumpCards(card: Card, winningCard: Card): boolean {
    // Trump hierarchy: red 1 (highest) > bird > regular trump cards by value
    
    // Red 1 beats everything
    if (card.color === 'red' && card.value === 1) {
      return true;
    }
    if (winningCard.color === 'red' && winningCard.value === 1) {
      return false;
    }

    // Bird beats regular trump cards but loses to red 1
    if (card.color === 'bird') {
      return winningCard.color !== 'red' || winningCard.value !== 1;
    }
    if (winningCard.color === 'bird') {
      return false;
    }

    // Both are regular trump cards - compare by value
    return card.value > winningCard.value;
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

  private validateCardPlay(
    card: Card, 
    hand: Card[], 
    currentTrick: GameStateData['currentTrick'], 
    trumpSuit: Suit | null
  ): void {
    // If leading, any card is valid
    if (currentTrick.cards.length === 0) {
      return;
    }

    const leadCard = currentTrick.cards[0].card;
    const leadSuit = currentTrick.leadSuit;

    // Special case: If red 1 or bird is led, must follow with trump suit if you have it
    if (((leadCard.color === 'red' && leadCard.value === 1) || leadCard.color === 'bird') && trumpSuit) {
      const hasTrumpCards = hand.some(c => 
        c.color === trumpSuit || 
        c.color === 'bird' || 
        (c.color === 'red' && c.value === 1)
      );
      
      if (hasTrumpCards) {
        const isValidTrump = card.color === trumpSuit || 
                             card.color === 'bird' || 
                             (card.color === 'red' && card.value === 1);
        if (!isValidTrump) {
          throw new BadRequestException('Must follow with trump when red 1 or bird is led');
        }
      }
      return;
    }

    // Normal suit following rules
    if (leadSuit) {
      const hasLeadSuit = hand.some(c => c.color === leadSuit);
      if (hasLeadSuit && card.color !== leadSuit) {
        throw new BadRequestException(`Must follow suit (${leadSuit})`);
      }
    }
  }

  // Computer player methods using AIPlayer
  private async computerPlaceBid(gameId: string): Promise<void> {
    try {
      const game = await this.getGame(gameId);
      if (game.state !== GameState.BIDDING) return;

      const aiPlayer = this.getAIPlayer(gameId, game.currentBidder);
      const bid = aiPlayer.placeBid(game.highBid, game.gameState.biddingHistory);
      
      await this.placeBid(gameId, game.currentBidder, bid);
    } catch (error) {
      console.error('Computer bid error:', error);
    }
  }

  private async computerSelectCards(gameId: string): Promise<void> {
    try {
      const game = await this.getGame(gameId);
      if (game.state !== GameState.SELECTING || !game.highBidder) return;

      const aiPlayer = this.getAIPlayer(gameId, game.highBidder);
      const centerPileCards = [...game.gameState.centerPile.faceDown];
      if (game.gameState.centerPile.faceUp) {
        centerPileCards.push(game.gameState.centerPile.faceUp);
      }
      
      const selectedCardIds = aiPlayer.selectCards(centerPileCards);
      await this.selectNineCards(gameId, game.highBidder, selectedCardIds);
    } catch (error) {
      console.error('Computer select error:', error);
    }
  }

  private async computerDeclareTrump(gameId: string): Promise<void> {
    try {
      const game = await this.getGame(gameId);
      if (game.state !== GameState.DECLARING_TRUMP || !game.highBidder) return;

      const aiPlayer = this.getAIPlayer(gameId, game.highBidder);
      const trumpSuit = aiPlayer.declareTrump();
      
      await this.declareTrump(gameId, game.highBidder, trumpSuit);
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

      const aiPlayer = this.getAIPlayer(gameId, player);
      const positionInOrder = currentTrick.cards.length;
      const cardId = aiPlayer.playCard(currentTrick, positionInOrder);
      
      await this.playCard(gameId, player, cardId);
    } catch (error) {
      console.error('Computer play error:', error);
    }
  }

  /**
   * Get or create AI player for a game and position
   */
  private getAIPlayer(gameId: string, position: PlayerPosition): AIPlayer {
    if (!this.aiPlayers.has(gameId)) {
      this.aiPlayers.set(gameId, new Map());
    }

    const gamePlayers = this.aiPlayers.get(gameId)!;
    if (!gamePlayers.has(position)) {
      gamePlayers.set(position, new AIPlayer(position));
    }

    return gamePlayers.get(position)!;
  }

  /**
   * Initialize AI players for a game and update their knowledge
   */
  private async initializeAIPlayers(game: Game): Promise<void> {
    const positions: PlayerPosition[] = ['north', 'east', 'south', 'west'];
    
    for (const position of positions) {
      if (game.playerTypes[position] === 'computer') {
        const aiPlayer = this.getAIPlayer(game.id, position);
        
        // Update hand
        aiPlayer.updateHand(game.gameState.hands[position]);
        
        // Update centerPile top card (visible to all)
        aiPlayer.setCenterPileTopCard(game.gameState.centerPile.faceUp);
        
        // Update completed tricks
        aiPlayer.updateCompletedTricks(game.gameState.completedTricks);
        
        // Update trump suit if set
        aiPlayer.setTrumpSuit(game.trumpSuit);
      }
    }
  }

  /**
   * Clean up AI players for a completed game
   */
  private cleanupAIPlayers(gameId: string): void {
    this.aiPlayers.delete(gameId);
  }
}
