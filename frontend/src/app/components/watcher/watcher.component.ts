import { Component, OnInit, AfterViewInit, OnDestroy, inject, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { SocketService } from '../../services/socket.service';
import { TableService } from '../../services/table.service';
import { User } from '../../models/auth.model';

type PlayerPosition = 'north' | 'south' | 'east' | 'west';

interface Card {
  color: 'red' | 'black' | 'green' | 'yellow' | 'bird';
  value: number;
  id: string;
}

interface ServerGameState {
  id: string;
  state: 'new' | 'dealing' | 'bidding' | 'selecting' | 'declaring_trump' | 'playing' | 'scoring' | 'showscore' | 'complete';
  northSouthScore: number;
  eastWestScore: number;
  dealer: string;
  currentBidder: string | null;
  highBid: number | null;
  highBidder: string | null;
  trumpSuit: string | null;
  winningTeam: 'northSouth' | 'eastWest' | null;
  lastHandResult: {
    biddingTeam: 'northSouth' | 'eastWest';
    bid: number;
    northSouthPoints: number;
    eastWestPoints: number;
    madeBid: boolean;
  } | null;
  playerTypes: Record<string, 'human' | 'computer'>;
  playerNames: Record<string, string>;
  playerReady: Record<string, boolean>;
  scoringReady: Record<string, boolean>;
  playerBRB?: Record<string, boolean>;
  playerMessages?: Record<string, { text: string; timestamp: number } | null>;
  table: {
    id: string;
    tableNumber: number;
    northPlayer: any;
    eastPlayer: any;
    southPlayer: any;
    westPlayer: any;
  };
  gameState: {
    hands: {
      north: Card[];
      east: Card[];
      south: Card[];
      west: Card[];
    };
    centerPile: {
      faceDown: Card[];
      faceUp: Card | null;
    };
    currentTrick: {
      cards: Array<{ player: string; card: Card }>;
      leadPlayer: string | null;
    };
    completedTricks: Array<{
      winner: string;
      cards: Array<{ player: string; card: Card }>;
      points: number;
    }>;
    biddingHistory: Array<{ player: string; bid: number | string; timestamp: string }>;
  };
}

@Component({
  selector: 'app-watcher',
  imports: [CommonModule],
  templateUrl: './watcher.component.html',
  styleUrls: ['./watcher.component.scss']
})
export class WatcherComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('cardCanvas', { static: false }) canvasRef?: ElementRef<HTMLCanvasElement>;
  
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private socketService = inject(SocketService);
  private tableService = inject(TableService);
  private cdr = inject(ChangeDetectorRef);
  private cardImage?: HTMLImageElement;
  private ctx?: CanvasRenderingContext2D;

  currentUser: User | null = null;
  game?: ServerGameState;
  gameId?: string;
  gameStateText = '';
  private isDealingAnimation = false;
  private dealAnimationProgress = 0;
  private isPlayingTrickAnimation = false;
  private trickAnimationStartTime = 0;
  private winningCardIndex = -1;
  private showingCompletedTrick = false;
  private completedTrickDisplay?: Array<{ player: string; card: Card }>;
  private lastTrickWinner?: string;
  private trickCompletionTime = 0;
  private animationFrameId?: number;
  private dealAnimationTime = 10000;
  private trickAnimationTime = 1000;
  private trickDisplayDelay = 2000;

  // Card dimensions - must match game component
  private readonly CARD_WIDTH_SOURCE = 1024;
  private readonly CARD_HEIGHT_SOURCE = 1536;
  private readonly CARD_WIDTH_DISPLAY = 77;
  private readonly CARD_HEIGHT_DISPLAY = 115;

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });

    this.gameId = this.route.snapshot.paramMap.get('gameId') || undefined;

    if (this.gameId) {
      // Subscribe to game state updates
      this.socketService.onGameState().subscribe(gameState => {
        this.handleGameStateUpdate(gameState);
      });

      // Join game as watcher
      this.socketService.emit('joinGame', { gameId: this.gameId, player: 'watcher' });
    }

    // Load preferences
    this.tableService.getPreferences().subscribe({
      next: (prefs) => {
        this.dealAnimationTime = prefs.dealAnimationTime;
        this.trickAnimationTime = prefs.trickAnimationTime;
        this.trickDisplayDelay = prefs.trickDisplayDelay;
      },
      error: (error) => {
        console.error('Error loading preferences:', error);
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.canvasRef) {
      this.ctx = this.canvasRef.nativeElement.getContext('2d') || undefined;
      this.loadCardImage();
    }
  }

  ngOnDestroy(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  private loadCardImage(): void {
    this.cardImage = new Image();
    this.cardImage.onload = () => {
      this.renderGame();
    };
    this.cardImage.src = '/images/cards/combined_deck.png';
  }

  private handleGameStateUpdate(gameState: ServerGameState): void {
    const previousState = this.game?.state;
    this.game = gameState;
    
    // Update game state text
    this.updateGameStateText();

    // Handle state transitions
    if (previousState !== gameState.state) {
      if (gameState.state === 'dealing') {
        this.startDealAnimation();
      } else if (gameState.state === 'playing') {
        this.isDealingAnimation = false;
      }
    }

    // Check for completed trick
    if (gameState.state === 'playing' && gameState.gameState.currentTrick.cards.length === 0 && 
        gameState.gameState.completedTricks.length > 0 && !this.showingCompletedTrick) {
      const lastTrick = gameState.gameState.completedTricks[gameState.gameState.completedTricks.length - 1];
      this.displayCompletedTrick(lastTrick);
    }

    this.renderGame();
    this.cdr.detectChanges();
  }

  private updateGameStateText(): void {
    if (!this.game) {
      this.gameStateText = 'Loading...';
      return;
    }

    switch (this.game.state) {
      case 'new':
        this.gameStateText = 'Waiting for players...';
        break;
      case 'dealing':
        this.gameStateText = 'Dealing cards...';
        break;
      case 'bidding':
        if (this.game.currentBidder) {
          const bidderName = this.game.playerNames[this.game.currentBidder] || this.game.currentBidder;
          this.gameStateText = `Bidding - ${bidderName}'s turn`;
        } else {
          this.gameStateText = 'Bidding';
        }
        break;
      case 'selecting':
        if (this.game.highBidder) {
          const bidderName = this.game.playerNames[this.game.highBidder] || this.game.highBidder;
          this.gameStateText = `${bidderName} is selecting cards...`;
        } else {
          this.gameStateText = 'Selecting cards...';
        }
        break;
      case 'declaring_trump':
        if (this.game.highBidder) {
          const bidderName = this.game.playerNames[this.game.highBidder] || this.game.highBidder;
          this.gameStateText = `${bidderName} is declaring trump...`;
        } else {
          this.gameStateText = 'Declaring trump...';
        }
        break;
      case 'playing':
        this.gameStateText = 'Playing';
        break;
      case 'scoring':
      case 'showscore':
        this.gameStateText = 'Scoring hand...';
        break;
      case 'complete':
        this.gameStateText = 'Game complete';
        break;
      default:
        this.gameStateText = '';
    }
  }

  private startDealAnimation(): void {
    this.isDealingAnimation = true;
    this.dealAnimationProgress = 0;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      this.dealAnimationProgress = Math.min(elapsed / this.dealAnimationTime, 1);
      
      this.renderGame();

      if (this.dealAnimationProgress < 1) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        this.isDealingAnimation = false;
      }
    };

    animate();
  }

  private displayCompletedTrick(trick: { winner: string; cards: Array<{ player: string; card: Card }>; points: number }): void {
    this.showingCompletedTrick = true;
    this.completedTrickDisplay = trick.cards;
    this.lastTrickWinner = trick.winner;
    this.trickCompletionTime = Date.now();
    this.isPlayingTrickAnimation = true;
    this.trickAnimationStartTime = Date.now();
    this.winningCardIndex = trick.cards.findIndex(c => c.player === trick.winner);

    const animate = () => {
      const elapsed = Date.now() - this.trickAnimationStartTime;
      
      if (elapsed < this.trickAnimationTime) {
        this.renderGame();
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        this.isPlayingTrickAnimation = false;
        
        // Show the completed trick for the delay period
        setTimeout(() => {
          this.showingCompletedTrick = false;
          this.completedTrickDisplay = undefined;
          this.lastTrickWinner = undefined;
          this.renderGame();
        }, this.trickDisplayDelay);
      }
    };

    animate();
  }

  private renderGame(): void {
    if (!this.ctx || !this.cardImage || !this.game) return;

    const canvas = this.ctx.canvas;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw table background
    this.ctx.fillStyle = '#2d5016';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw player hands (show actual cards for watcher)
    this.drawPlayerHand('north', this.game.gameState.hands.north);
    this.drawPlayerHand('south', this.game.gameState.hands.south);
    this.drawPlayerHand('east', this.game.gameState.hands.east);
    this.drawPlayerHand('west', this.game.gameState.hands.west);

    // Draw center pile
    if (this.game.gameState.centerPile.faceDown.length > 0 || this.game.gameState.centerPile.faceUp) {
      this.drawCenterPile();
    }

    // Draw current trick or completed trick display
    if (this.showingCompletedTrick && this.completedTrickDisplay) {
      this.drawTrickCards(this.completedTrickDisplay, true);
    } else if (this.game.gameState.currentTrick.cards.length > 0) {
      this.drawTrickCards(this.game.gameState.currentTrick.cards, false);
    }

    // Draw player names and info
    this.drawPlayerInfo('north', this.game.playerNames['north'] || 'North');
    this.drawPlayerInfo('south', this.game.playerNames['south'] || 'South');
    this.drawPlayerInfo('east', this.game.playerNames['east'] || 'East');
    this.drawPlayerInfo('west', this.game.playerNames['west'] || 'West');

    // Draw scores
    this.drawScores();

    // Draw trump suit indicator
    if (this.game.trumpSuit && this.game.state === 'playing') {
      this.drawTrumpIndicator();
    }
  }

  private drawPlayerHand(position: PlayerPosition, cards: Card[]): void {
    if (!this.ctx || !this.cardImage || cards.length === 0) return;

    const ctx = this.ctx;
    const cardImage = this.cardImage;
    const cardCount = cards.length;
    const margin = 12;
    const cardOverlapTight = 20;
    const cardOverlapVertical = 30;

    let x = 0, y = 0;
    const totalWidth = this.CARD_WIDTH_DISPLAY + (cardCount - 1) * cardOverlapTight;
    const totalHeight = this.CARD_HEIGHT_DISPLAY + (cardCount - 1) * cardOverlapVertical;

    switch (position) {
      case 'north':
        x = (ctx.canvas.width - totalWidth) / 2;
        y = margin;
        break;
      case 'south':
        x = (ctx.canvas.width - totalWidth) / 2;
        y = ctx.canvas.height - this.CARD_HEIGHT_DISPLAY - margin;
        break;
      case 'east':
        x = ctx.canvas.width - this.CARD_WIDTH_DISPLAY - margin;
        y = (ctx.canvas.height - totalHeight) / 2;
        break;
      case 'west':
        x = margin;
        y = (ctx.canvas.height - totalHeight) / 2;
        break;
    }

    // Draw all cards face up
    for (let i = 0; i < cardCount; i++) {
      const card = cards[i];
      const sourceX = this.getCardSourceX(card);
      
      if (position === 'east' || position === 'west') {
        ctx.drawImage(
          cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          x, y + i * cardOverlapVertical,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
      } else {
        ctx.drawImage(
          cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          x + i * cardOverlapTight, y,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
      }
    }
  }

  private drawCenterPile(): void {
    if (!this.ctx || !this.cardImage || !this.game) return;

    const ctx = this.ctx;
    const cardImage = this.cardImage;
    const centerX = ctx.canvas.width / 2 - this.CARD_WIDTH_DISPLAY / 2;
    const centerY = ctx.canvas.height / 2 - this.CARD_HEIGHT_DISPLAY / 2;

    // Draw face down pile
    if (this.game.gameState.centerPile.faceDown.length > 0) {
      const backSrcX = 57 * this.CARD_WIDTH_SOURCE;
      ctx.drawImage(
        cardImage,
        backSrcX, 0,
        this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
        centerX - 40, centerY,
        this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
      );
    }

    // Draw face up card
    if (this.game.gameState.centerPile.faceUp) {
      const card = this.game.gameState.centerPile.faceUp;
      const sourceX = this.getCardSourceX(card);
      ctx.drawImage(
        cardImage,
        sourceX, 0,
        this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
        centerX + 40, centerY,
        this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
      );
    }
  }

  private drawTrickCards(cards: Array<{ player: string; card: Card }>, isCompleted: boolean): void {
    if (!this.ctx || !this.cardImage) return;

    const ctx = this.ctx;
    const cardImage = this.cardImage;
    const centerX = ctx.canvas.width / 2;
    const centerY = ctx.canvas.height / 2;
    const offset = 60;

    cards.forEach((playedCard, index) => {
      const sourceX = this.getCardSourceX(playedCard.card);
      let x = centerX - this.CARD_WIDTH_DISPLAY / 2;
      let y = centerY - this.CARD_HEIGHT_DISPLAY / 2;

      // Position based on player
      switch (playedCard.player) {
        case 'north':
          y = centerY - offset - this.CARD_HEIGHT_DISPLAY;
          break;
        case 'south':
          y = centerY + offset;
          break;
        case 'east':
          x = centerX + offset;
          break;
        case 'west':
          x = centerX - offset - this.CARD_WIDTH_DISPLAY;
          break;
      }

      // Highlight winning card with animation
      if (isCompleted && this.isPlayingTrickAnimation && index === this.winningCardIndex) {
        const progress = Math.min((Date.now() - this.trickAnimationStartTime) / this.trickAnimationTime, 1);
        const scale = 1 + 0.2 * Math.sin(progress * Math.PI);
        ctx.save();
        ctx.translate(x + this.CARD_WIDTH_DISPLAY / 2, y + this.CARD_HEIGHT_DISPLAY / 2);
        ctx.scale(scale, scale);
        ctx.drawImage(
          cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          -this.CARD_WIDTH_DISPLAY / 2, -this.CARD_HEIGHT_DISPLAY / 2,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
        ctx.restore();
      } else {
        ctx.drawImage(
          cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          x, y,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
      }
    });
  }

  private drawPlayerInfo(position: PlayerPosition, name: string): void {
    if (!this.ctx || !this.game) return;

    this.ctx.font = '16px Arial';
    this.ctx.fillStyle = 'white';
    this.ctx.textAlign = 'center';

    let x = 0, y = 0;
    switch (position) {
      case 'north':
        x = this.ctx.canvas.width / 2;
        y = 140;
        break;
      case 'south':
        x = this.ctx.canvas.width / 2;
        y = this.ctx.canvas.height - 140;
        break;
      case 'east':
        x = this.ctx.canvas.width - 140;
        y = this.ctx.canvas.height / 2;
        break;
      case 'west':
        x = 140;
        y = this.ctx.canvas.height / 2;
        break;
    }

    this.ctx.fillText(name, x, y);

    // Show BRB indicator
    if (this.game.playerBRB && this.game.playerBRB[position]) {
      this.ctx.fillStyle = 'yellow';
      this.ctx.fillText('(BRB)', x, y + 20);
    }

    // Show player message
    if (this.game.playerMessages && this.game.playerMessages[position]) {
      const message = this.game.playerMessages[position];
      if (message) {
        this.ctx.fillStyle = 'lightblue';
        this.ctx.font = '14px Arial';
        this.ctx.fillText(message.text, x, y + 40);
      }
    }
  }

  private drawScores(): void {
    if (!this.ctx || !this.game) return;

    this.ctx.font = '20px Arial';
    this.ctx.fillStyle = 'white';
    this.ctx.textAlign = 'left';

    const padding = 20;
    this.ctx.fillText(`N/S: ${this.game.northSouthScore}`, padding, 30);
    this.ctx.fillText(`E/W: ${this.game.eastWestScore}`, padding, 60);

    // Show current bid if in playing state
    if (this.game.state === 'playing' && this.game.highBid && this.game.highBidder) {
      const bidderName = this.game.playerNames[this.game.highBidder] || this.game.highBidder;
      this.ctx.fillText(`Bid: ${this.game.highBid} (${bidderName})`, padding, 90);
    }
  }

  private drawTrumpIndicator(): void {
    if (!this.ctx || !this.game || !this.game.trumpSuit) return;

    const size = 40;
    const x = this.ctx.canvas.width - size - 20;
    const y = 20;

    // Draw trump suit symbol
    this.ctx.fillStyle = this.getTrumpColor(this.game.trumpSuit);
    this.ctx.fillRect(x, y, size, size);
    this.ctx.strokeStyle = 'white';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(x, y, size, size);

    this.ctx.fillStyle = 'white';
    this.ctx.font = '12px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('Trump', x + size / 2, y + size + 15);
  }

  private getTrumpColor(suit: string): string {
    switch (suit) {
      case 'red': return '#cc0000';
      case 'black': return '#000000';
      case 'green': return '#00cc00';
      case 'yellow': return '#cccc00';
      case 'bird': return '#9900cc';
      default: return '#666666';
    }
  }

  private getCardSourceX(card: Card): number {
    // Calculate x position in the source image
    let offset = 0;
    
    if (card.color === 'bird') {
      offset = 56 * this.CARD_WIDTH_SOURCE;
    } else {
      // Determine color offset
      let colorOffset = 0;
      switch (card.color) {
        case 'red':
          colorOffset = 0;
          break;
        case 'black':
          colorOffset = 14;
          break;
        case 'green':
          colorOffset = 28;
          break;
        case 'yellow':
          colorOffset = 42;
          break;
      }
      
      // Cards are numbered 1-14 but we only have 5-14 plus the red 1
      // Red 1 is at position 0, cards 5-14 are at positions 4-13
      if (card.value === 1) {
        offset = 0; // Red 1 is first red card
      } else {
        offset = (colorOffset + card.value - 1) * this.CARD_WIDTH_SOURCE;
      }
    }
    
    return offset;
  }

  onLeave(): void {
    if (this.game) {
      this.tableService.unwatchTable(this.game.table.id).subscribe({
        next: () => {
          this.router.navigate(['/home']);
        },
        error: (error) => {
          console.error('Error leaving watch:', error);
          this.router.navigate(['/home']);
        }
      });
    } else {
      this.router.navigate(['/home']);
    }
  }
}
