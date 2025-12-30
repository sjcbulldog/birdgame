import { Component, OnInit, AfterViewInit, OnDestroy, inject, ElementRef, ViewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { SocketService } from '../../services/socket.service';
import { TableService } from '../../services/table.service';
import { User } from '../../models/auth.model';

interface Card {
  color: 'red' | 'black' | 'green' | 'yellow' | 'bird';
  value: number;
  id: string;
}

interface ServerGameState {
  id: string;
  state: 'new' | 'dealing' | 'bidding' | 'selecting' | 'declaring_trump' | 'playing' | 'scoring' | 'complete';
  northSouthScore: number;
  eastWestScore: number;
  dealer: string;
  currentBidder: string | null;
  highBid: number | null;
  highBidder: string | null;
  trumpSuit: string | null;
  playerTypes: Record<string, 'human' | 'computer'>;
  playerNames: Record<string, string>;
  playerReady: Record<string, boolean>;
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
    kitty: {
      faceDown: Card[];
      faceUp: Card | null;
    };
    currentTrick: {
      cards: Array<{ player: string; card: Card }>;
      leadPlayer: string | null;
    };
    biddingHistory: Array<{ player: string; bid: number | string; timestamp: string }>;
  };
}

@Component({
  selector: 'app-game',
  imports: [],
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.scss']
})
export class GameComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('cardCanvas', { static: false }) canvasRef?: ElementRef<HTMLCanvasElement>;
  
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private socketService = inject(SocketService);
  private tableService = inject(TableService);
  private cardImage?: HTMLImageElement;
  private ctx?: CanvasRenderingContext2D;

  currentUser: User | null = null;
  game?: ServerGameState;
  gameId?: string;
  myPosition?: string; // north, east, south, west
  playerReadyState: Record<string, boolean> = {};
  isWaitingForPlayers = false;
  private previousGameState?: string;
  private isDealingAnimation = false;
  private dealAnimationProgress = 0;
  private dealAnimationStartTime = 0;
  showLogoutDialog = false;

  // Card dimensions
  private readonly CARD_WIDTH_SOURCE = 1024;
  private readonly CARD_HEIGHT_SOURCE = 1536;
  private readonly CARD_WIDTH_DISPLAY = 128;
  private readonly CARD_HEIGHT_DISPLAY = 192;
  private readonly TABLE_WIDTH = 1024;
  private readonly TABLE_HEIGHT = 1024;

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });

    // Subscribe to game state updates FIRST before joining
    this.socketService.onGameState().subscribe({
      next: (game: ServerGameState) => {
        // Log state transitions
        if (this.previousGameState && this.previousGameState !== game.state) {
          console.log(`%cGAME STATE CHANGED: ${this.previousGameState} → ${game.state}`, 
            'color: #00ff00; font-weight: bold; font-size: 14px;');
          
          // Start dealing animation when transitioning to dealing state
          if (game.state === 'dealing') {
            this.startDealingAnimation();
          }
        } else if (!this.previousGameState) {
          console.log(`%cGAME STATE INITIALIZED: ${game.state}`, 
            'color: #00ff00; font-weight: bold; font-size: 14px;');
        }
        
        this.previousGameState = game.state;
        this.game = game;
        this.playerReadyState = game.playerReady || {};
        if (this.ctx) {
          this.renderTable();
        }
      },
      error: (error) => {
        console.error('Error receiving game state:', error);
      }
    });

    // Subscribe to player ready updates
    this.socketService.onPlayerReadyUpdate().subscribe({
      next: (data) => {
        this.playerReadyState = data.playerReady;
        if (this.ctx) {
          this.renderTable();
        }
      },
      error: (error) => {
        console.error('Error receiving player ready update:', error);
      }
    });
    
    this.loadCardImage();

    // Get game ID from route and join game
    this.route.params.subscribe(params => {
      this.gameId = params['gameId'];
      if (this.gameId) {
        // For now, assume south position
        // TODO: Get actual player position from game/table data
        this.myPosition = 'south';
        this.socketService.joinGame(this.gameId, this.myPosition);
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.canvasRef) {
      const canvas = this.canvasRef.nativeElement;
      this.ctx = canvas.getContext('2d') ?? undefined;
      
      // Render if we already have game data and image is loaded
      if (this.game) {
        if (this.cardImage?.complete) {
          this.renderTable();
        } else if (this.cardImage) {
          // Wait for image to load
          this.cardImage.onload = () => {
            if (this.game) {
              this.renderTable();
            }
          };
        }
      }
    }
  }

  private loadCardImage(): void {
    this.cardImage = new Image();
    this.cardImage.src = '/images/cards/combined_deck.png';
    this.cardImage.onload = () => {
      if (this.ctx && this.game) {
        this.renderTable();
      }
    };
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

  private sortCards(cards: Card[]): Card[] {
    if (!cards || cards.length === 0) return cards;

    // Create a copy to avoid mutating the original array
    const sortedCards = [...cards];

    // Define color order: red, black, green, yellow
    const colorOrder: Record<string, number> = {
      'red': 0,
      'black': 1,
      'green': 2,
      'yellow': 3,
      'bird': 99 // Bird goes last
    };

    sortedCards.sort((a, b) => {
      // Bird card and red 1 always go to the far right
      if (a.color === 'bird') return 1;
      if (b.color === 'bird') return -1;
      if (a.color === 'red' && a.value === 1) return 1;
      if (b.color === 'red' && b.value === 1) return -1;

      // First sort by color
      const colorDiff = colorOrder[a.color] - colorOrder[b.color];
      if (colorDiff !== 0) return colorDiff;

      // Then sort by value within the same color (high to low)
      return b.value - a.value;
    });

    return sortedCards;
  }

  private getNextPlayer(currentPlayer: string): string {
    const order = ['south', 'west', 'north', 'east'];
    const currentIndex = order.indexOf(currentPlayer);
    return order[(currentIndex + 1) % 4];
  }

  private startDealingAnimation(): void {
    this.isDealingAnimation = true;
    this.dealAnimationProgress = 0;
    this.dealAnimationStartTime = Date.now();
    this.animateDealing();
  }

  private animateDealing(): void {
    if (!this.isDealingAnimation) {
      return;
    }

    // Calculate progress based on elapsed time
    // 42 cards * 1 second per card = 42 seconds total
    const elapsedTime = Date.now() - this.dealAnimationStartTime;
    const totalAnimationTime = 10000; // 10 seconds total
    this.dealAnimationProgress = Math.min(1, elapsedTime / totalAnimationTime);

    if (this.dealAnimationProgress >= 1) {
      this.isDealingAnimation = false;
      
      // Notify backend that dealing animation is complete
      if (this.gameId) {
        this.socketService.dealingComplete(this.gameId);
      }
      return;
    }
    
    if (this.ctx) {
      this.renderTable();
    }

    requestAnimationFrame(() => this.animateDealing());
  }

  private renderTable(): void {
    if (!this.ctx || !this.cardImage || !this.game) return;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.TABLE_WIDTH, this.TABLE_HEIGHT);

    // Draw debug info at top center
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '14px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    
    let debugText = `Game State: ${this.game.state}`;
    
    // Add waiting player info based on game state
    if (this.game.state === 'bidding' && this.game.currentBidder) {
      debugText += ` | Waiting on: ${this.game.currentBidder}`;
    } else if ((this.game.state === 'selecting' || this.game.state === 'declaring_trump') && this.game.highBidder) {
      debugText += ` | Waiting on: ${this.game.highBidder}`;
    } else if (this.game.state === 'playing') {
      // Determine next player from current trick
      const currentTrick = this.game.gameState?.currentTrick;
      if (currentTrick) {
        if (currentTrick.cards.length === 0 && currentTrick.leadPlayer) {
          debugText += ` | Waiting on: ${currentTrick.leadPlayer}`;
        } else if (currentTrick.cards.length > 0) {
          // Get the last player who played and determine next
          const lastCard = currentTrick.cards[currentTrick.cards.length - 1];
          const nextPlayer = this.getNextPlayer(lastCard.player);
          debugText += ` | Waiting on: ${nextPlayer}`;
        }
      }
    }
    
    this.ctx.fillText(debugText, this.TABLE_WIDTH / 2, 8);

    // Show pre-game screen if game hasn't started
    if (this.game.state === 'new') {
      this.renderPreGameScreen();
      return;
    }

    // Show dealing animation if in dealing state
    if (this.game.state === 'dealing' || this.isDealingAnimation) {
      this.renderDealingAnimation();
      return;
    }

    const margin = 20;
    const cardOverlapVertical = 30;
    const cardOverlapHorizontal = this.CARD_WIDTH_DISPLAY * 0.875; // 7/8 width
    const cardOverlapTight = this.CARD_WIDTH_DISPLAY * 0.3; // Tight overlap for north

    // Sort the south (human) player's cards before rendering
    const sortedSouthCards = this.sortCards(this.game.gameState.hands.south);

    // Render each player's hand
    this.renderPlayerHand('south', sortedSouthCards, margin, cardOverlapHorizontal);
    this.renderPlayerHand('north', this.game.gameState.hands.north, margin, cardOverlapTight);
    this.renderPlayerHand('east', this.game.gameState.hands.east, margin, cardOverlapVertical);
    this.renderPlayerHand('west', this.game.gameState.hands.west, margin, cardOverlapVertical);

    // Render player names
    this.renderPlayerNames();

    // Render kitty if in initial state
    if (this.game.state === 'bidding' && (this.game.gameState.kitty.faceDown.length > 0 || this.game.gameState.kitty.faceUp)) {
      this.renderKitty();
      // Render bidding info above kitty
      this.renderBiddingInfo();
    }

    // Render current trick if playing
    if (this.game.state === 'playing' && this.game.gameState.currentTrick.cards.length > 0) {
      this.renderCurrentTrick();
    }
  }

  private renderPreGameScreen(): void {
    if (!this.ctx || !this.game) return;

    // Draw player icons at four positions
    const iconSize = 80;
    const positions = [
      { name: 'north', x: this.TABLE_WIDTH / 2 - iconSize / 2, y: 50 },
      { name: 'south', x: this.TABLE_WIDTH / 2 - iconSize / 2, y: this.TABLE_HEIGHT - 50 - iconSize },
      { name: 'east', x: this.TABLE_WIDTH - 50 - iconSize, y: this.TABLE_HEIGHT / 2 - iconSize / 2 },
      { name: 'west', x: 50, y: this.TABLE_HEIGHT / 2 - iconSize / 2 },
    ];

    positions.forEach(pos => {
      const playerType = this.game!.playerTypes[pos.name];
      const player = this.game!.table[`${pos.name}Player` as keyof typeof this.game.table];
      const isReady = this.playerReadyState[pos.name];

      // Draw icon background circle
      this.ctx!.beginPath();
      this.ctx!.arc(pos.x + iconSize / 2, pos.y + iconSize / 2, iconSize / 2, 0, 2 * Math.PI);
      this.ctx!.fillStyle = isReady ? '#4CAF50' : '#757575';
      this.ctx!.fill();
      this.ctx!.strokeStyle = '#ffffff';
      this.ctx!.lineWidth = 3;
      this.ctx!.stroke();

      // Draw icon (computer or user)
      const iconImage = new Image();
      iconImage.src = playerType === 'computer' ? '/images/computer.png' : '/images/user.png';
      if (iconImage.complete) {
        this.ctx!.drawImage(iconImage, pos.x + 10, pos.y + 10, iconSize - 20, iconSize - 20);
      } else {
        iconImage.onload = () => {
          this.ctx!.drawImage(iconImage, pos.x + 10, pos.y + 10, iconSize - 20, iconSize - 20);
        };
      }

      // Draw username for human players
      if (playerType === 'human' && player) {
        this.ctx!.fillStyle = '#ffffff';
        this.ctx!.font = '14px Arial';
        this.ctx!.textAlign = 'center';
        this.ctx!.fillText(player.username || player.email, pos.x + iconSize / 2, pos.y + iconSize + 20);
      }
    });

    // Draw start button in center
    const buttonWidth = 200;
    const buttonHeight = 60;
    const buttonX = this.TABLE_WIDTH / 2 - buttonWidth / 2;
    const buttonY = this.TABLE_HEIGHT / 2 - buttonHeight / 2;

    // Button background
    this.ctx!.fillStyle = this.isWaitingForPlayers ? '#FFC107' : '#2196F3';
    this.ctx!.fillRect(buttonX, buttonY, buttonWidth, buttonHeight);
    this.ctx!.strokeStyle = '#ffffff';
    this.ctx!.lineWidth = 2;
    this.ctx!.strokeRect(buttonX, buttonY, buttonWidth, buttonHeight);

    // Button text
    this.ctx!.fillStyle = '#ffffff';
    this.ctx!.font = 'bold 18px Arial';
    this.ctx!.textAlign = 'center';
    this.ctx!.textBaseline = 'middle';
    const buttonText = this.isWaitingForPlayers ? 'Waiting...' : 'Start Game';
    this.ctx!.fillText(buttonText, this.TABLE_WIDTH / 2, this.TABLE_HEIGHT / 2);

    // Draw Leave Table button below Start Game button
    const leaveButtonY = buttonY + buttonHeight + 20;
    this.ctx!.fillStyle = '#dc3545';
    this.ctx!.fillRect(buttonX, leaveButtonY, buttonWidth, buttonHeight);
    this.ctx!.strokeStyle = '#ffffff';
    this.ctx!.lineWidth = 2;
    this.ctx!.strokeRect(buttonX, leaveButtonY, buttonWidth, buttonHeight);

    // Leave button text
    this.ctx!.fillStyle = '#ffffff';
    this.ctx!.font = 'bold 18px Arial';
    this.ctx!.textAlign = 'center';
    this.ctx!.textBaseline = 'middle';
    this.ctx!.fillText('Leave Table', this.TABLE_WIDTH / 2, leaveButtonY + buttonHeight / 2);
  }

  private renderDealingAnimation(): void {
    if (!this.ctx || !this.cardImage || !this.game) return;

    // Calculate the total number of cards to deal (42 cards total)
    const totalCards = 42;
    const currentCardIndex = Math.floor(this.dealAnimationProgress * totalCards);

    // Dealer position
    const dealer = this.game.dealer;
    const dealerPositions = {
      south: { x: this.TABLE_WIDTH / 2 - this.CARD_WIDTH_DISPLAY / 2, y: this.TABLE_HEIGHT - 20 - this.CARD_HEIGHT_DISPLAY },
      north: { x: this.TABLE_WIDTH / 2 - this.CARD_WIDTH_DISPLAY / 2, y: 20 },
      east: { x: this.TABLE_WIDTH - 20 - this.CARD_WIDTH_DISPLAY, y: this.TABLE_HEIGHT / 2 - this.CARD_HEIGHT_DISPLAY / 2 },
      west: { x: 20, y: this.TABLE_HEIGHT / 2 - this.CARD_HEIGHT_DISPLAY / 2 },
    };

    const startPos = dealerPositions[dealer as keyof typeof dealerPositions] || dealerPositions.south;

    // Base positions for each player (top-left of their hand)
    const basePositions = {
      south: { x: this.TABLE_WIDTH / 2, y: this.TABLE_HEIGHT - 20 - this.CARD_HEIGHT_DISPLAY },
      north: { x: this.TABLE_WIDTH / 2, y: 20 },
      east: { x: this.TABLE_WIDTH - 20 - this.CARD_WIDTH_DISPLAY, y: this.TABLE_HEIGHT / 2 },
      west: { x: 20, y: this.TABLE_HEIGHT / 2 },
    };

    // Kitty center position
    const kittyCenter = { 
      x: this.TABLE_WIDTH / 2 - this.CARD_WIDTH_DISPLAY / 2, 
      y: this.TABLE_HEIGHT / 2 - this.CARD_HEIGHT_DISPLAY / 2 
    };

    // Draw text showing dealing in progress
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '24px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(`Dealing card ${currentCardIndex + 1} of ${totalCards}...`, this.TABLE_WIDTH / 2, 50);

    // Deal pattern: 5 rounds (4 players + kitty), 4 rounds (4 players), 1 to kitty face up
    // Total: 5*5=25, 4*4=16, 1=1 = 42 cards
    const dealOrder = ['south', 'west', 'north', 'east'] as const;
    const cardOverlapHorizontal = this.CARD_WIDTH_DISPLAY * 0.3;
    const cardOverlapVertical = 30;

    // Track card counts for each destination
    const cardCounts = { south: 0, west: 0, north: 0, east: 0, kitty: 0 };
    
    // Draw cards that have been dealt or are in flight
    for (let i = 0; i <= currentCardIndex; i++) {
      let destination: string;
      let isKitty = false;
      let isFaceUp = false;

      // Determine destination based on dealing pattern
      if (i < 25) {
        // First 5 rounds: 4 to players, 1 to kitty
        const roundCard = i % 5;
        if (roundCard < 4) {
          destination = dealOrder[roundCard];
        } else {
          destination = 'kitty';
          isKitty = true;
        }
      } else if (i < 41) {
        // Next 4 rounds: 4 to players
        const roundCard = (i - 25) % 4;
        destination = dealOrder[roundCard];
      } else {
        // Last card: face up to kitty
        destination = 'kitty';
        isKitty = true;
        isFaceUp = true;
      }

      // Calculate card position with overlap
      let targetX: number, targetY: number;
      
      if (isKitty) {
        // Stack kitty cards in center with slight offset
        targetX = kittyCenter.x + cardCounts.kitty * 2;
        targetY = kittyCenter.y + cardCounts.kitty * 2;
      } else {
        const pos = destination as 'south' | 'west' | 'north' | 'east';
        const basePos = basePositions[pos];
        const cardIndex = cardCounts[pos];
        
        if (pos === 'south' || pos === 'north') {
          // Horizontal overlap, centered
          const totalWidth = this.CARD_WIDTH_DISPLAY + cardIndex * cardOverlapHorizontal;
          targetX = basePos.x - totalWidth / 2 + cardIndex * cardOverlapHorizontal;
          targetY = basePos.y;
        } else {
          // Vertical overlap, centered
          const totalHeight = this.CARD_HEIGHT_DISPLAY + cardIndex * cardOverlapVertical;
          targetX = basePos.x;
          targetY = basePos.y - totalHeight / 2 + cardIndex * cardOverlapVertical;
        }
      }

      // Calculate animation progress for this card
      const cardStartProgress = i / totalCards;
      const cardEndProgress = (i + 1) / totalCards;
      const cardProgress = (this.dealAnimationProgress - cardStartProgress) / (cardEndProgress - cardStartProgress);
      const t = Math.min(1, Math.max(0, cardProgress));

      // Interpolate position
      const x = startPos.x + (targetX - startPos.x) * t;
      const y = startPos.y + (targetY - startPos.y) * t;

      // Draw card
      let sourceX: number;
      if (isFaceUp && t === 1) {
        // For the final face-up kitty card, we don't know which card it is
        // So show a generic card or use a placeholder
        sourceX = 0; // Could be any card, using first card for now
      } else {
        sourceX = 57 * this.CARD_WIDTH_SOURCE; // Card back
      }
      
      this.ctx.drawImage(
        this.cardImage,
        sourceX, 0,
        this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
        x, y,
        this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
      );

      // Increment count for this destination
      if (isKitty) {
        cardCounts.kitty++;
      } else {
        cardCounts[destination as 'south' | 'west' | 'north' | 'east']++;
      }
    }
  }

  onStartGame(): void {
    if (this.isWaitingForPlayers || !this.gameId || !this.myPosition) return;
    
    this.isWaitingForPlayers = true;
    this.socketService.playerReady(this.gameId, this.myPosition);
    
    if (this.ctx) {
      this.renderTable();
    }
  }

  onLeaveTable(): void {
    if (!this.game) {
      console.error('No game object');
      return;
    }
    
    if (!this.game.table) {
      console.error('No table in game object');
      return;
    }
    
    if (!this.game.table.id) {
      console.error('No table ID');
      return;
    }
    
    this.tableService.leaveTable(this.game.table.id).subscribe({
      next: () => {
        this.router.navigate(['/home']);
      },
      error: (error) => {
        console.error('Error leaving table:', error);
        // Navigate home anyway
        this.router.navigate(['/home']);
      }
    });
  }

  onCanvasClick(event: MouseEvent): void {
    if (!this.game || this.game.state !== 'new') return;

    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = this.TABLE_WIDTH / rect.width;
    const scaleY = this.TABLE_HEIGHT / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    const buttonWidth = 200;
    const buttonHeight = 60;
    const buttonX = this.TABLE_WIDTH / 2 - buttonWidth / 2;
    const buttonY = this.TABLE_HEIGHT / 2 - buttonHeight / 2;

    // Check if click is within the start button
    if (x >= buttonX && x <= buttonX + buttonWidth &&
        y >= buttonY && y <= buttonY + buttonHeight) {
      this.onStartGame();
      return;
    }

    // Check if click is within the leave table button
    const leaveButtonY = buttonY + buttonHeight + 20;
    if (x >= buttonX && x <= buttonX + buttonWidth &&
        y >= leaveButtonY && y <= leaveButtonY + buttonHeight) {
      this.onLeaveTable();
    }
  }

  private renderPlayerHand(position: string, cards: Card[], margin: number, overlap: number): void {
    if (!this.ctx || !this.cardImage || cards.length === 0) return;

    const isMyHand = position === this.myPosition;
    const cardCount = cards.length;

    if (position === 'south') {
      const bottomY = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin;
      const totalWidth = this.CARD_WIDTH_DISPLAY + (cardCount - 1) * overlap;
      const startX = (this.TABLE_WIDTH - totalWidth) / 2;

      for (let i = 0; i < cardCount; i++) {
        const card = cards[i];
        const sourceX = isMyHand && card.id ? this.getCardSourceX(card) : 57 * this.CARD_WIDTH_SOURCE; // Card back
        this.ctx.drawImage(
          this.cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          startX + i * overlap, bottomY,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
      }
    } else if (position === 'north') {
      const topY = margin;
      const totalWidth = this.CARD_WIDTH_DISPLAY + (cardCount - 1) * overlap;
      const startX = (this.TABLE_WIDTH - totalWidth) / 2;

      for (let i = 0; i < cardCount; i++) {
        const sourceX = 57 * this.CARD_WIDTH_SOURCE; // Card back
        this.ctx.drawImage(
          this.cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          startX + i * overlap, topY,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
      }
    } else if (position === 'west') {
      const leftX = margin;
      const totalHeight = this.CARD_HEIGHT_DISPLAY + (cardCount - 1) * overlap;
      const startY = (this.TABLE_HEIGHT - totalHeight) / 2;

      for (let i = 0; i < cardCount; i++) {
        const sourceX = 57 * this.CARD_WIDTH_SOURCE; // Card back
        this.ctx.drawImage(
          this.cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          leftX, startY + i * overlap,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
      }
    } else if (position === 'east') {
      const rightX = this.TABLE_WIDTH - this.CARD_WIDTH_DISPLAY - margin;
      const totalHeight = this.CARD_HEIGHT_DISPLAY + (cardCount - 1) * overlap;
      const startY = (this.TABLE_HEIGHT - totalHeight) / 2;

      for (let i = 0; i < cardCount; i++) {
        const sourceX = 57 * this.CARD_WIDTH_SOURCE; // Card back
        this.ctx.drawImage(
          this.cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          rightX, startY + i * overlap,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
      }
    }
  }

  private renderKitty(): void {
    if (!this.ctx || !this.cardImage || !this.game) return;

    const kittyCenter = { 
      x: this.TABLE_WIDTH / 2 - this.CARD_WIDTH_DISPLAY / 2, 
      y: this.TABLE_HEIGHT / 2 - this.CARD_HEIGHT_DISPLAY / 2 
    };

    const stackSourceX = 57 * this.CARD_WIDTH_SOURCE; // Card back

    // Draw 5 face-down cards stacked with offset
    const faceDownCount = Math.min(5, this.game.gameState.kitty.faceDown.length);
    for (let i = 0; i < faceDownCount; i++) {
      this.ctx.drawImage(
        this.cardImage,
        stackSourceX, 0,
        this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
        kittyCenter.x + i * 2, kittyCenter.y + i * 2,
        this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
      );
    }

    // Draw face-up card on top of the stack
    if (this.game.gameState.kitty.faceUp) {
      const faceUpSourceX = this.getCardSourceX(this.game.gameState.kitty.faceUp);
      this.ctx.drawImage(
        this.cardImage,
        faceUpSourceX, 0,
        this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
        kittyCenter.x + faceDownCount * 2, kittyCenter.y + faceDownCount * 2,
        this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
      );
    }
  }

  private renderPlayerNames(): void {
    if (!this.ctx || !this.game || !this.game.playerNames) return;

    this.ctx.font = '16px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#ffffff';

    const margin = 20;

    // South player (bottom): center, just above cards
    const southY = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin - 15;
    this.ctx.fillText(this.game.playerNames['south'], this.TABLE_WIDTH / 2, southY);

    // North player (top): to the right of the cards
    const northCardsEndX = this.TABLE_WIDTH / 2 + (this.CARD_WIDTH_DISPLAY * 0.3 * 9) / 2;
    const northY = margin + this.CARD_HEIGHT_DISPLAY / 2;
    this.ctx.textAlign = 'left';
    this.ctx.fillText(this.game.playerNames['north'], northCardsEndX + 10, northY);

    // West player (left): on top of the stack
    this.ctx.textAlign = 'center';
    const westX = margin + this.CARD_WIDTH_DISPLAY / 2;
    const westCardsStartY = (this.TABLE_HEIGHT - (this.CARD_HEIGHT_DISPLAY + 30 * 9)) / 2;
    this.ctx.fillText(this.game.playerNames['west'], westX, westCardsStartY - 10);

    // East player (right): on top of the stack
    const eastX = this.TABLE_WIDTH - margin - this.CARD_WIDTH_DISPLAY / 2;
    const eastCardsStartY = (this.TABLE_HEIGHT - (this.CARD_HEIGHT_DISPLAY + 30 * 9)) / 2;
    this.ctx.fillText(this.game.playerNames['east'], eastX, eastCardsStartY - 10);
  }

  private renderBiddingInfo(): void {
    if (!this.ctx || !this.game) return;

    // Only show during bidding phase
    if (this.game.state !== 'bidding') return;

    // Show high bidder and bid if available
    if (this.game.highBidder && this.game.highBid) {
      const bidderName = this.game.playerNames?.[this.game.highBidder] || this.game.highBidder;
      const bidText = `High Bid: ${bidderName} - ${this.game.highBid}`;
      
      this.ctx.font = '18px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'bottom';
      this.ctx.fillStyle = '#ffff00'; // Yellow for visibility
      
      // Position above the kitty
      const kittyY = this.TABLE_HEIGHT / 2 - this.CARD_HEIGHT_DISPLAY / 2;
      this.ctx.fillText(bidText, this.TABLE_WIDTH / 2, kittyY - 10);
    }
  }

  private renderCurrentTrick(): void {
    if (!this.ctx || !this.cardImage || !this.game) return;

    // Render cards played in current trick in center of table
    const centerX = this.TABLE_WIDTH / 2;
    const centerY = this.TABLE_HEIGHT / 2;
    const trickSpacing = 40;

    for (let i = 0; i < this.game.gameState.currentTrick.cards.length; i++) {
      const { card, player } = this.game.gameState.currentTrick.cards[i];
      const sourceX = this.getCardSourceX(card);
      
      // Position based on player position
      let x = centerX - this.CARD_WIDTH_DISPLAY / 2;
      let y = centerY - this.CARD_HEIGHT_DISPLAY / 2;

      if (player === 'north') y -= trickSpacing;
      if (player === 'south') y += trickSpacing;
      if (player === 'east') x += trickSpacing;
      if (player === 'west') x -= trickSpacing;

      this.ctx.drawImage(
        this.cardImage,
        sourceX, 0,
        this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
        x, y,
        this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
      );
    }
  }

  logout(): void {
    this.showLogoutDialog = true;
  }

  confirmLogout(): void {
    this.showLogoutDialog = false;
    
    // Remove player from table before logging out
    if (this.game?.table?.id) {
      this.tableService.leaveTable(this.game.table.id).subscribe({
        next: () => {
          this.authService.logout();
          this.router.navigate(['/login']);
        },
        error: (error) => {
          console.error('Error leaving table:', error);
          // Still logout even if leave table fails
          this.authService.logout();
          this.router.navigate(['/login']);
        }
      });
    } else {
      // No table to leave, just logout
      this.authService.logout();
      this.router.navigate(['/login']);
    }
  }

  cancelLogout(): void {
    this.showLogoutDialog = false;
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }
}
