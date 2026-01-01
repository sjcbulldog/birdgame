import { Component, OnInit, AfterViewInit, OnDestroy, inject, ElementRef, ViewChild, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  selector: 'app-game',
  imports: [CommonModule, FormsModule],
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
  private cdr = inject(ChangeDetectorRef);
  private cardImage?: HTMLImageElement;
  private ctx?: CanvasRenderingContext2D;

  currentUser: User | null = null;
  game?: ServerGameState;
  gameId?: string;
  myPosition?: string; // north, east, south, west - the user's backend position
  playerReadyState: Record<string, boolean> = {};
  isWaitingForPlayers = false;
  private previousGameState?: string;
  private isDealingAnimation = false;
  private dealAnimationProgress = 0;
  private dealAnimationStartTime = 0;
  private dealAnimationTime = 10000; // Default value, will be loaded from server
  showLogoutDialog = false;
  showLeaveTableDialog = false;
  gameStateText = '';
  
  // Bidding UI state
  selectedBidAmount: number = 60;
  isSubmittingBid = false;
  
  // Scoring popup
  showScoringPopup = false;

  // Winner popup
  showWinnerPopup = false;
  winningTeam: 'northSouth' | 'eastWest' | null = null;

  // Selecting state - track selected cards for discard
  selectedCardsForDiscard: Set<string> = new Set();

  // Playing state - track selected card for playing
  selectedCardForPlay: string | null = null;
  private lastClickTime = 0;
  private lastClickedCardId: string | null = null;
  private readonly DOUBLE_CLICK_DELAY = 300; // ms

  // Completed trick display
  private displayingCompletedTrick: { cards: any[], winner: string } | null = null;
  private lastCompletedTrickCount = 0;
  private readonly TRICK_DISPLAY_DELAY = 2000; // 2 seconds to show completed trick
  
  // Trick animation to won pile
  private animatingTrickToWonPile: { cards: any[], winner: string, progress: number, startTime: number } | null = null;
  private readonly TRICK_TO_WON_PILE_DURATION = 1000; // 1 second animation

  // Position mapping: backend position -> display position
  // Display positions: bottom (current user), top, left, right
  private positionMap: Record<string, 'bottom' | 'top' | 'left' | 'right'> = {};

  private updateGameStateText(): void {
    if (!this.game) {
      this.gameStateText = '';
      return;
    }
    
    let text = `Game State: ${this.game.state}`;
    
    // Add dealer info for dealing state
    if (this.game.state === 'dealing' && this.game.dealer) {
      const dealerName = this.game.playerNames?.[this.game.dealer] || this.game.dealer;
      text += ` | Dealer: ${dealerName}`;
    }
    
    // Add waiting player info based on game state
    if (this.game.state === 'bidding' && this.game.currentBidder) {
      text += ` | Waiting on: ${this.game.currentBidder}`;
    } else if ((this.game.state === 'selecting' || this.game.state === 'declaring_trump') && this.game.highBidder) {
      text += ` | Waiting on: ${this.game.highBidder}`;
    } else if (this.game.state === 'playing') {
      // Determine next player from current trick
      const currentTrick = this.game.gameState?.currentTrick;
      if (currentTrick) {
        if (currentTrick.cards.length === 0 && currentTrick.leadPlayer) {
          text += ` | Waiting on: ${currentTrick.leadPlayer}`;
        } else if (currentTrick.cards.length > 0) {
          // Get the last player who played and determine next
          const lastCard = currentTrick.cards[currentTrick.cards.length - 1];
          const nextPlayer = this.getNextPlayer(lastCard.player);
          text += ` | Waiting on: ${nextPlayer}`;
        }
      }
    }
    
    this.gameStateText = text;
    this.cdr.detectChanges();
  }

  // Card dimensions
  private readonly CARD_WIDTH_SOURCE = 1024;
  private readonly CARD_HEIGHT_SOURCE = 1536;
  private readonly CARD_WIDTH_DISPLAY = 77;
  private readonly CARD_HEIGHT_DISPLAY = 115;
  private readonly TABLE_WIDTH = 1024;
  private readonly TABLE_HEIGHT = 819;

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });

    // Load deal animation time preference
    this.tableService.getPreferences().subscribe({
      next: (prefs) => {
        this.dealAnimationTime = prefs.dealAnimationTime;
      },
      error: (error) => {
        console.error('Error loading preferences:', error);
        this.dealAnimationTime = 10000; // Fallback to default
      }
    });

    // Subscribe to game state updates FIRST before joining
    this.socketService.onGameState().subscribe({
      next: (game: ServerGameState) => {
        // Log state transitions
        if (this.previousGameState && this.previousGameState !== game.state) {
          console.log(`%cGAME STATE CHANGED: ${this.previousGameState} → ${game.state}`, 
            'color: #00ff00; font-weight: bold; font-size: 14px;');
          
          // Show scoring popup when entering showscore state
          if (game.state === 'showscore' && game.lastHandResult) {
            this.showScoringPopup = true;
          }

          // Show winner popup when game is complete
          if (game.state === 'complete' && game.winningTeam) {
            this.showWinnerPopup = true;
            this.winningTeam = game.winningTeam;
          }
          
          // Start dealing animation when transitioning to dealing state
          if (game.state === 'dealing') {
            this.startDealingAnimation();
          }
        } else if (!this.previousGameState) {
          console.log(`%cGAME STATE INITIALIZED: ${game.state}`, 
            'color: #00ff00; font-weight: bold; font-size: 14px;');
          
          // Handle initial state - show popups if needed
          if (game.state === 'showscore' && game.lastHandResult) {
            this.showScoringPopup = true;
          }
          
          if (game.state === 'complete' && game.winningTeam) {
            this.showWinnerPopup = true;
            this.winningTeam = game.winningTeam;
          }
        }
        
        this.previousGameState = game.state;
        this.game = game;
        this.playerReadyState = game.playerReady || {};
        this.updateGameStateText();
        
        // Update selected bid amount when it's the player's turn to bid
        if (game.state === 'bidding' && game.currentBidder === this.myPosition) {
          this.selectedBidAmount = this.getMinBid();
        }
        
        // Check if a trick was just completed
        if (game.state === 'playing' && game.gameState.completedTricks.length > this.lastCompletedTrickCount) {
          const lastCompletedTrick = game.gameState.completedTricks[game.gameState.completedTricks.length - 1];
          this.displayingCompletedTrick = {
            cards: lastCompletedTrick.cards,
            winner: lastCompletedTrick.winner
          };
          this.lastCompletedTrickCount = game.gameState.completedTricks.length;
          
          // After 2 seconds, start animation to won pile
          setTimeout(() => {
            this.displayingCompletedTrick = null;
            this.animatingTrickToWonPile = {
              cards: lastCompletedTrick.cards,
              winner: lastCompletedTrick.winner,
              progress: 0,
              startTime: Date.now()
            };
            this.animateTrickToWonPile();
          }, this.TRICK_DISPLAY_DELAY);
        }
        
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

    // Get game ID from route
    this.route.params.subscribe(params => {
      this.gameId = params['gameId'];
      if (this.gameId) {
        console.log('Game ID set:', this.gameId);
        
        // Fetch initial game state via HTTP
        this.tableService.getGame(this.gameId).subscribe({
          next: (game: ServerGameState) => {
            console.log('Initial game state loaded:', game);
            
            // Determine user's position from table
            if (this.currentUser && game.table) {
              const userId = this.currentUser.id;
              if (game.table.northPlayer?.id === userId) {
                this.myPosition = 'north';
              } else if (game.table.southPlayer?.id === userId) {
                this.myPosition = 'south';
              } else if (game.table.eastPlayer?.id === userId) {
                this.myPosition = 'east';
              } else if (game.table.westPlayer?.id === userId) {
                this.myPosition = 'west';
              }

              // Set up position mapping
              if (this.myPosition) {
                this.updatePositionMapping();
                
                // Join the game via socket
                this.socketService.joinGame(this.gameId!, this.myPosition);
              }
            }
            
            // Set initial game state
            this.game = game;
            this.playerReadyState = game.playerReady || {};
            this.lastCompletedTrickCount = game.gameState?.completedTricks?.length || 0;
            this.updateGameStateText();
            if (this.ctx) {
              this.renderTable();
            }
          },
          error: (error) => {
            console.error('Error loading game:', error);
          }
        });
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

    // Check if we're in playing state and have a trump suit
    const isPlayingState = this.game?.state === 'playing';
    const trumpSuit = this.game?.trumpSuit;

    if (isPlayingState && trumpSuit) {
      // Playing state with trump: trump suit first, then others
      sortedCards.sort((a, b) => {
        const aIsTrump = a.color === trumpSuit || a.color === 'bird' || (a.color === 'red' && a.value === 1);
        const bIsTrump = b.color === trumpSuit || b.color === 'bird' || (b.color === 'red' && b.value === 1);

        // Trump cards come first
        if (aIsTrump && !bIsTrump) return -1;
        if (!aIsTrump && bIsTrump) return 1;

        // Both are trump or both are non-trump
        if (aIsTrump && bIsTrump) {
          // Within trumps: red 1 (highest), then bird, then regular trump cards
          if (a.color === 'red' && a.value === 1) return -1;
          if (b.color === 'red' && b.value === 1) return 1;
          if (a.color === 'bird') return -1;
          if (b.color === 'bird') return 1;
          // Both are regular trump cards - sort by value (high to low)
          return b.value - a.value;
        }

        // Both are non-trump - sort by color then value
        const colorOrder: Record<string, number> = {
          'red': 0,
          'black': 1,
          'green': 2,
          'yellow': 3
        };
        const colorDiff = colorOrder[a.color as keyof typeof colorOrder] - colorOrder[b.color as keyof typeof colorOrder];
        if (colorDiff !== 0) return colorDiff;

        // Same color - sort by value (high to low)
        return b.value - a.value;
      });
    } else {
      // Non-playing state: bird and red 1 at the far right
      const colorOrder: Record<string, number> = {
        'red': 0,
        'black': 1,
        'green': 2,
        'yellow': 3,
        'bird': 99
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
    }

    return sortedCards;
  }

  private getNextPlayer(currentPlayer: string): string {
    const order = ['south', 'west', 'north', 'east'];
    const currentIndex = order.indexOf(currentPlayer);
    return order[(currentIndex + 1) % 4];
  }

  /**
   * Updates the position mapping based on current user's backend position.
   * Current user is always displayed at 'bottom'.
   * Other positions are mapped clockwise: left, top, right.
   */
  private updatePositionMapping(): void {
    if (!this.myPosition) return;

    // Map backend positions to display positions
    // Current user is always at bottom
    this.positionMap[this.myPosition] = 'bottom';

    // Map other positions clockwise from current user
    const positions: Array<'north' | 'south' | 'east' | 'west'> = ['north', 'east', 'south', 'west'];
    const currentIndex = positions.indexOf(this.myPosition as any);
    
    // Next position (clockwise) goes to left
    this.positionMap[positions[(currentIndex + 1) % 4]] = 'left';
    
    // Opposite position goes to top
    this.positionMap[positions[(currentIndex + 2) % 4]] = 'top';
    
    // Previous position (counter-clockwise) goes to right
    this.positionMap[positions[(currentIndex + 3) % 4]] = 'right';
  }

  /**
   * Get the display position for a backend position.
   */
  private getDisplayPosition(backendPosition: string): 'bottom' | 'top' | 'left' | 'right' {
    return this.positionMap[backendPosition] || 'bottom';
  }

  /**
   * Get the backend position for a display position.
   */
  private getBackendPosition(displayPosition: 'bottom' | 'top' | 'left' | 'right'): string {
    for (const [backend, display] of Object.entries(this.positionMap)) {
      if (display === displayPosition) return backend;
    }
    return 'south'; // fallback
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
    const elapsedTime = Date.now() - this.dealAnimationStartTime;
    this.dealAnimationProgress = Math.min(1, elapsedTime / this.dealAnimationTime);

    if (this.dealAnimationProgress >= 1) {
      this.isDealingAnimation = false;
      this.dealAnimationProgress = 0;
      this.renderTable();
      
      // Notify backend that dealing animation is complete
      if (this.gameId) {
        this.socketService.dealingComplete(this.gameId);
      }
      return;
    }

    this.renderTable();
    requestAnimationFrame(() => this.animateDealing());
  }

  private animateTrickToWonPile(): void {
    if (!this.animatingTrickToWonPile) return;

    const currentTime = Date.now();
    const elapsed = currentTime - this.animatingTrickToWonPile.startTime;
    this.animatingTrickToWonPile.progress = Math.min(elapsed / this.TRICK_TO_WON_PILE_DURATION, 1);

    if (this.animatingTrickToWonPile.progress >= 1) {
      // Animation complete
      this.animatingTrickToWonPile = null;
      this.renderTable();
      return;
    }

    this.renderTable();
    requestAnimationFrame(() => this.animateTrickToWonPile());
  }

  private getWonPileLocation(winner: string): { x: number, y: number } {
    const margin = 12;
    
    // Determine team
    const isNorthSouthTeam = winner === 'north' || winner === 'south';
    
    if (isNorthSouthTeam) {
      // North/South team: to the left of north (top) player's hand
      const topCardsStartX = this.TABLE_WIDTH / 2 - (this.CARD_WIDTH_DISPLAY + (9 - 1) * (this.CARD_WIDTH_DISPLAY * 0.3)) / 2;
      return {
        x: topCardsStartX - this.CARD_WIDTH_DISPLAY - 20,
        y: margin + 10
      };
    } else {
      // East/West team: below right (east) player's hand
      const rightCardsStartY = (this.TABLE_HEIGHT - (this.CARD_HEIGHT_DISPLAY + 30 * 9)) / 2;
      const rightCardsEndY = rightCardsStartY + this.CARD_HEIGHT_DISPLAY + 30 * 9;
      return {
        x: this.TABLE_WIDTH - margin - this.CARD_WIDTH_DISPLAY,
        y: rightCardsEndY + 20
      };
    }
  }

  private renderWonPiles(): void {
    if (!this.ctx || !this.game || this.game.state !== 'playing') return;

    // Count tricks won by each team
    let northSouthTricks = this.game.gameState.completedTricks.filter(
      trick => trick.winner === 'north' || trick.winner === 'south'
    ).length;
    let eastWestTricks = this.game.gameState.completedTricks.filter(
      trick => trick.winner === 'east' || trick.winner === 'west'
    ).length;

    // If currently animating a trick to won pile, don't count it yet for card back display
    if (this.animatingTrickToWonPile) {
      const winner = this.animatingTrickToWonPile.winner;
      if (winner === 'north' || winner === 'south') {
        northSouthTricks = Math.max(0, northSouthTricks - 1);
      } else {
        eastWestTricks = Math.max(0, eastWestTricks - 1);
      }
    }

    // Render North/South team won pile
    const nsLocation = this.getWonPileLocation('north');
    if (northSouthTricks > 0) {
      // Draw card back
      if (this.cardImage && this.cardImage.complete) {
        const sourceX = 57 * this.CARD_WIDTH_SOURCE; // Card back
        this.ctx.drawImage(
          this.cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          nsLocation.x, nsLocation.y,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
      }
    } else {
      // Draw dotted rectangle
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([5, 5]);
      this.ctx.beginPath();
      this.ctx.roundRect(nsLocation.x, nsLocation.y, this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY, 8);
      this.ctx.stroke();
      this.ctx.setLineDash([]); // Reset to solid line
    }

    // Render East/West team won pile
    const ewLocation = this.getWonPileLocation('east');
    if (eastWestTricks > 0) {
      // Draw card back
      if (this.cardImage && this.cardImage.complete) {
        const sourceX = 57 * this.CARD_WIDTH_SOURCE; // Card back
        this.ctx.drawImage(
          this.cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          ewLocation.x, ewLocation.y,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
      }
    } else {
      // Draw dotted rectangle
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash([5, 5]);
      this.ctx.beginPath();
      this.ctx.roundRect(ewLocation.x, ewLocation.y, this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY, 8);
      this.ctx.stroke();
      this.ctx.setLineDash([]); // Reset to solid line
    }
  }

  private renderTable(): void {
    if (!this.ctx || !this.cardImage || !this.game) return;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.TABLE_WIDTH, this.TABLE_HEIGHT);

    // Game state display moved to header

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

    const margin = 12;
    const cardOverlapVertical = 18; // for left/right positions
    const cardOverlapHorizontal = this.CARD_WIDTH_DISPLAY * 0.875; // 7/8 width for opponents
    const cardOverlapTight = this.CARD_WIDTH_DISPLAY * 0.3; // Tight overlap for top position
    const cardSpacingBottom = this.CARD_WIDTH_DISPLAY + 2; // 2px gap between cards for bottom (current user)

    // Special handling for selecting state - current user has 15 cards
    const isSelectingState = this.game.state === 'selecting';
    const isCurrentUserHighBidder = isSelectingState && this.game.highBidder === this.myPosition;

    // Render each player's hand with appropriate overlap based on display position
    const positions: Array<'north' | 'south' | 'east' | 'west'> = ['north', 'south', 'east', 'west'];
    
    for (const backendPos of positions) {
      const displayPos = this.getDisplayPosition(backendPos);
      const isCurrentUser = backendPos === this.myPosition;
      let cards = this.game.gameState.hands[backendPos];
      let overlap: number;
      
      // Skip rendering current user's hand if in selecting state - will render specially
      if (isCurrentUserHighBidder && isCurrentUser) {
        continue;
      }
      
      // Determine overlap based on display position
      if (displayPos === 'bottom') {
        // Current user at bottom: sort cards and use wider spacing
        cards = this.sortCards(cards);
        overlap = cardSpacingBottom;
      } else if (displayPos === 'top') {
        // Top position: tight overlap
        overlap = cardOverlapTight;
      } else {
        // Left/right positions: vertical overlap
        overlap = cardOverlapVertical;
      }
      
      this.renderPlayerHand(backendPos, cards, margin, overlap);
    }

    // Render selecting state for current user
    if (isCurrentUserHighBidder) {
      this.renderSelectingState(margin, cardSpacingBottom);
    }

    // Render player icons with names for all players
    this.renderPlayerIcons();

    // Render won piles during playing state
    if (this.game.state === 'playing') {
      this.renderWonPiles();
    }

    // Render centerPile if in initial state
    if (this.game.state === 'bidding' && (this.game.gameState.centerPile.faceDown.length > 0 || this.game.gameState.centerPile.faceUp)) {
      this.renderCenterPile();
      // Render bidding info above centerPile
      this.renderBiddingInfo();
    }

    // Render current trick if playing (or if displaying completed trick or animating to won pile)
    // Allow rendering during scoring state if we're displaying the completed trick or animating
    if ((this.game.state === 'playing' || this.game.state === 'scoring') && (this.game.gameState.currentTrick.cards.length > 0 || this.displayingCompletedTrick || this.animatingTrickToWonPile)) {
      this.renderCurrentTrick();
    }

    // Render trump indicator if trump has been declared
    if (this.game.trumpSuit && this.game.state === 'playing') {
      this.renderTrumpIndicator();
    }

    // Render bid info during playing state
    if (this.game.state === 'playing' && this.game.highBidder && this.game.highBid) {
      this.renderBidInfo();
    }

    // Render scores in all game states
    this.renderScores();
  }

  private renderPreGameScreen(): void {
    if (!this.ctx || !this.game) return;

    // Render scores
    this.renderScores();

    // Draw player icons at four display positions based on position mapping
    const iconSize = 48;
    const backendPositions: Array<'north' | 'south' | 'east' | 'west'> = ['north', 'south', 'east', 'west'];

    backendPositions.forEach(backendPos => {
      const displayPos = this.getDisplayPosition(backendPos);
      const playerType = this.game!.playerTypes[backendPos];
      const player = this.game!.table[`${backendPos}Player` as keyof typeof this.game.table];
      const isReady = this.playerReadyState[backendPos];

      // Calculate position based on display position
      let x: number, y: number;
      if (displayPos === 'bottom') {
        x = this.TABLE_WIDTH / 2 - iconSize / 2;
        y = this.TABLE_HEIGHT - 50 - iconSize;
      } else if (displayPos === 'top') {
        x = this.TABLE_WIDTH / 2 - iconSize / 2;
        y = 50;
      } else if (displayPos === 'right') {
        x = this.TABLE_WIDTH - 50 - iconSize;
        y = this.TABLE_HEIGHT / 2 - iconSize / 2;
      } else { // left
        x = 50;
        y = this.TABLE_HEIGHT / 2 - iconSize / 2;
      }

      // Draw icon background circle
      this.ctx!.beginPath();
      this.ctx!.arc(x + iconSize / 2, y + iconSize / 2, iconSize / 2, 0, 2 * Math.PI);
      this.ctx!.fillStyle = isReady ? '#4CAF50' : '#757575';
      this.ctx!.fill();
      this.ctx!.strokeStyle = '#ffffff';
      this.ctx!.lineWidth = 3;
      this.ctx!.stroke();

      // Draw icon (computer or user)
      const iconImage = new Image();
      iconImage.src = playerType === 'computer' ? '/images/computer.png' : '/images/user.png';
      if (iconImage.complete) {
        this.ctx!.drawImage(iconImage, x + 10, y + 10, iconSize - 20, iconSize - 20);
      } else {
        iconImage.onload = () => {
          this.ctx!.drawImage(iconImage, x + 10, y + 10, iconSize - 20, iconSize - 20);
        };
      }

      // Draw username for human players or computer name for computer players
      if (playerType === 'human' && player) {
        this.ctx!.fillStyle = '#ffffff';
        this.ctx!.font = '14px Arial';
        this.ctx!.textAlign = 'center';
        this.ctx!.fillText(player.username || player.email, x + iconSize / 2, y + iconSize + 20);
      } else if (playerType === 'computer' && this.game!.playerNames) {
        const computerName = this.game!.playerNames[backendPos];
        if (computerName) {
          this.ctx!.fillStyle = '#ffffff';
          this.ctx!.font = '14px Arial';
          this.ctx!.textAlign = 'center';
          this.ctx!.fillText(computerName, x + iconSize / 2, y + iconSize + 20);
        }
      }
    });

    // Draw start button in center with modern styling
    const buttonWidth = 220;
    const buttonHeight = 65;
    const buttonX = this.TABLE_WIDTH / 2 - buttonWidth / 2;
    const buttonY = this.TABLE_HEIGHT / 2 - buttonHeight / 2;
    const borderRadius = 12;

    // Start button with gradient and shadow
    this.ctx!.save();
    
    // Shadow
    this.ctx!.shadowColor = 'rgba(0, 0, 0, 0.3)';
    this.ctx!.shadowBlur = 15;
    this.ctx!.shadowOffsetX = 0;
    this.ctx!.shadowOffsetY = 4;

    // Rounded rectangle helper
    const roundRect = (x: number, y: number, width: number, height: number, radius: number) => {
      this.ctx!.beginPath();
      this.ctx!.moveTo(x + radius, y);
      this.ctx!.lineTo(x + width - radius, y);
      this.ctx!.quadraticCurveTo(x + width, y, x + width, y + radius);
      this.ctx!.lineTo(x + width, y + height - radius);
      this.ctx!.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      this.ctx!.lineTo(x + radius, y + height);
      this.ctx!.quadraticCurveTo(x, y + height, x, y + height - radius);
      this.ctx!.lineTo(x, y + radius);
      this.ctx!.quadraticCurveTo(x, y, x + radius, y);
      this.ctx!.closePath();
    };

    // Start button background with gradient
    const startGradient = this.ctx!.createLinearGradient(buttonX, buttonY, buttonX, buttonY + buttonHeight);
    if (this.isWaitingForPlayers) {
      startGradient.addColorStop(0, '#FFD54F');
      startGradient.addColorStop(1, '#FFA726');
    } else {
      startGradient.addColorStop(0, '#42A5F5');
      startGradient.addColorStop(1, '#1976D2');
    }
    
    roundRect(buttonX, buttonY, buttonWidth, buttonHeight, borderRadius);
    this.ctx!.fillStyle = startGradient;
    this.ctx!.fill();

    this.ctx!.restore();

    // Button text with better typography
    this.ctx!.fillStyle = '#ffffff';
    this.ctx!.font = 'bold 20px Arial';
    this.ctx!.textAlign = 'center';
    this.ctx!.textBaseline = 'middle';
    this.ctx!.shadowColor = 'rgba(0, 0, 0, 0.3)';
    this.ctx!.shadowBlur = 3;
    this.ctx!.shadowOffsetX = 0;
    this.ctx!.shadowOffsetY = 1;
    const buttonText = this.isWaitingForPlayers ? 'Waiting...' : 'Start Game';
    this.ctx!.fillText(buttonText, this.TABLE_WIDTH / 2, this.TABLE_HEIGHT / 2);
    this.ctx!.shadowColor = 'transparent';
  }

  private renderDealingAnimation(): void {
    if (!this.ctx || !this.cardImage || !this.game) return;

    // Calculate the total number of cards to deal (42 cards total)
    const totalCards = 42;
    const currentCardIndex = Math.floor(this.dealAnimationProgress * totalCards);

    // Dealer display position (mapped from backend position)
    const dealer = this.game.dealer;
    const dealerDisplayPos = this.getDisplayPosition(dealer);
    
    let startPos: { x: number; y: number };
    if (dealerDisplayPos === 'bottom') {
      startPos = { x: this.TABLE_WIDTH / 2 - this.CARD_WIDTH_DISPLAY / 2, y: this.TABLE_HEIGHT - 20 - this.CARD_HEIGHT_DISPLAY };
    } else if (dealerDisplayPos === 'top') {
      startPos = { x: this.TABLE_WIDTH / 2 - this.CARD_WIDTH_DISPLAY / 2, y: 20 };
    } else if (dealerDisplayPos === 'right') {
      startPos = { x: this.TABLE_WIDTH - 20 - this.CARD_WIDTH_DISPLAY, y: this.TABLE_HEIGHT / 2 - this.CARD_HEIGHT_DISPLAY / 2 };
    } else { // left
      startPos = { x: 20, y: this.TABLE_HEIGHT / 2 - this.CARD_HEIGHT_DISPLAY / 2 };
    }

    // CenterPile center position
    const centerPileCenter = { 
      x: this.TABLE_WIDTH / 2 - this.CARD_WIDTH_DISPLAY / 2, 
      y: this.TABLE_HEIGHT / 2 - this.CARD_HEIGHT_DISPLAY / 2 
    };

    // Deal pattern: 5 rounds (4 players + centerPile), 4 rounds (4 players), 1 to centerPile face up
    // Total: 5*5=25, 4*4=16, 1=1 = 42 cards
    const dealOrder = ['south', 'west', 'north', 'east'] as const;
    const margin = 20;
    
    // Use same overlap values as in bidding state
    const cardOverlapHorizontalBottom = this.CARD_WIDTH_DISPLAY; // Bottom player (current user)
    const cardOverlapTightTop = this.CARD_WIDTH_DISPLAY * 0.3; // Top player (opposite)
    const cardOverlapVertical = 30; // Left and right players
    const finalCardCount = 9; // Each player gets 9 cards

    // Helper function to get display-position-based coordinates for a backend position
    const getPositionCoords = (backendPos: string, cardIndex: number, isStartPos: boolean) => {
      const displayPos = this.getDisplayPosition(backendPos);
      
      if (displayPos === 'bottom') {
        const finalWidth = this.CARD_WIDTH_DISPLAY + (finalCardCount - 1) * cardOverlapHorizontalBottom;
        const startX = (this.TABLE_WIDTH - finalWidth) / 2;
        const y = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin;
        return { x: isStartPos ? startX : startX + cardIndex * cardOverlapHorizontalBottom, y };
      } else if (displayPos === 'top') {
        const finalWidth = this.CARD_WIDTH_DISPLAY + (finalCardCount - 1) * cardOverlapTightTop;
        const startX = (this.TABLE_WIDTH - finalWidth) / 2;
        const y = margin;
        return { x: isStartPos ? startX : startX + cardIndex * cardOverlapTightTop, y };
      } else if (displayPos === 'left') {
        const x = margin;
        const finalHeight = this.CARD_HEIGHT_DISPLAY + (finalCardCount - 1) * cardOverlapVertical;
        const startY = (this.TABLE_HEIGHT - finalHeight) / 2;
        return { x, y: isStartPos ? startY : startY + cardIndex * cardOverlapVertical };
      } else { // right
        const x = this.TABLE_WIDTH - this.CARD_WIDTH_DISPLAY - margin;
        const finalHeight = this.CARD_HEIGHT_DISPLAY + (finalCardCount - 1) * cardOverlapVertical;
        const startY = (this.TABLE_HEIGHT - finalHeight) / 2;
        return { x, y: isStartPos ? startY : startY + cardIndex * cardOverlapVertical };
      }
    };

    // Track card counts for each destination
    const cardCounts = { south: 0, west: 0, north: 0, east: 0, centerPile: 0 };
    
    // Build list of cards dealt to each player so far
    const dealtCards: { south: Card[], west: Card[], north: Card[], east: Card[] } = {
      south: [],
      west: [],
      north: [],
      east: []
    };
    
    // First pass: collect all dealt cards and their destinations
    for (let i = 0; i <= currentCardIndex; i++) {
      let destination: string;
      let isCenterPile = false;

      if (i < 25) {
        const roundCard = i % 5;
        if (roundCard < 4) {
          destination = dealOrder[roundCard];
          if (destination === 'south' && this.game.gameState.hands.south[dealtCards.south.length]) {
            dealtCards.south.push(this.game.gameState.hands.south[dealtCards.south.length]);
          } else if (destination === 'west') {
            dealtCards.west.push({ color: 'red', value: 0, id: `card-${i}` });
          } else if (destination === 'north') {
            dealtCards.north.push({ color: 'red', value: 0, id: `card-${i}` });
          } else if (destination === 'east') {
            dealtCards.east.push({ color: 'red', value: 0, id: `card-${i}` });
          }
        } else {
          isCenterPile = true;
        }
      } else if (i < 41) {
        const roundCard = (i - 25) % 4;
        destination = dealOrder[roundCard];
        if (destination === 'south' && this.game.gameState.hands.south[dealtCards.south.length]) {
          dealtCards.south.push(this.game.gameState.hands.south[dealtCards.south.length]);
        } else if (destination === 'west') {
          dealtCards.west.push({ color: 'red', value: 0, id: `card-${i}` });
        } else if (destination === 'north') {
          dealtCards.north.push({ color: 'red', value: 0, id: `card-${i}` });
        } else if (destination === 'east') {
          dealtCards.east.push({ color: 'red', value: 0, id: `card-${i}` });
        }
      } else {
        isCenterPile = true;
      }
      
      if (isCenterPile) {
        cardCounts.centerPile++;
      }
    }
    
    // Sort south cards
    const sortedSouthCards = this.sortCards(dealtCards.south);
    
    // Draw cards that have been dealt
    for (let i = 0; i <= currentCardIndex; i++) {
      let destination: string;
      let isCenterPile = false;
      let isFaceUp = false;

      if (i < 25) {
        const roundCard = i % 5;
        if (roundCard < 4) {
          destination = dealOrder[roundCard];
        } else {
          destination = 'centerPile';
          isCenterPile = true;
        }
      } else if (i < 41) {
        const roundCard = (i - 25) % 4;
        destination = dealOrder[roundCard];
      } else {
        destination = 'centerPile';
        isCenterPile = true;
        isFaceUp = true;
      }

      // Calculate card position based on final layout positions
      let targetX: number, targetY: number;
      let cardToRender: Card | null = null;
      
      if (isCenterPile) {
        targetX = centerPileCenter.x + (cardCounts.centerPile - 1) * 2;
        targetY = centerPileCenter.y + (cardCounts.centerPile - 1) * 2;
        if (i === 41 && this.game.gameState.centerPile.faceUp) {
          cardToRender = this.game.gameState.centerPile.faceUp;
          isFaceUp = true;
        }
      } else {
        const backendPos = destination as 'south' | 'west' | 'north' | 'east';
        const cardIndex = cardCounts[backendPos];
        const isCurrentUser = backendPos === this.myPosition;
        const displayPos = this.getDisplayPosition(backendPos);
        
        // For current user (displayed at bottom), use progressive sorting
        if (isCurrentUser && displayPos === 'bottom') {
          const originalCard = this.game.gameState.hands[backendPos][cardIndex];
          if (originalCard) {
            // Sort only the cards dealt SO FAR (progressive sorting)
            const sortedDealtCards = this.sortCards([...dealtCards[backendPos]]);
            const sortedIndex = sortedDealtCards.findIndex(c => c.id === originalCard?.id);
            const currentCardCount = dealtCards[backendPos].length;
            
            // Center the current group of cards
            const currentGroupWidth = this.CARD_WIDTH_DISPLAY + (currentCardCount - 1) * cardOverlapHorizontalBottom;
            const groupStartX = (this.TABLE_WIDTH - currentGroupWidth) / 2;
            
            targetX = groupStartX + (sortedIndex >= 0 ? sortedIndex : cardIndex) * cardOverlapHorizontalBottom;
            targetY = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin;
            
            cardToRender = originalCard;
            isFaceUp = true;
          } else {
            // Fallback if card not found
            const coords = getPositionCoords(backendPos, cardIndex, false);
            targetX = coords.x;
            targetY = coords.y;
          }
        } else {
          // For other players or positions, use normal positioning
          const coords = getPositionCoords(backendPos, cardIndex, false);
          targetX = coords.x;
          targetY = coords.y;
        }
        
        cardCounts[backendPos]++;
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
      if (isFaceUp && t === 1 && cardToRender) {
        // Show actual card face for south and final centerPile card
        sourceX = this.getCardSourceX(cardToRender);
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
    }

    // Render player icons during dealing
    this.renderPlayerIcons();

    // Render scores during dealing
    this.renderScores();
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
    this.showLeaveTableDialog = true;
  }

  confirmLeaveTable(): void {
    this.showLeaveTableDialog = false;
    
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

  cancelLeaveTable(): void {
    this.showLeaveTableDialog = false;
  }

  // Bidding methods
  canBid(): boolean {
    return this.game?.state === 'bidding' && 
           this.game?.currentBidder === this.myPosition;
  }

  canCheck(): boolean {
    if (!this.canBid() || !this.game?.highBidder || !this.myPosition) return false;
    const partner = this.getPartner(this.myPosition);
    return this.game.highBidder === partner;
  }

  getMinBid(): number {
    return this.game?.highBid ? this.game.highBid + 5 : 60;
  }

  getMaxBid(): number {
    return 150;
  }

  getBidOptions(): number[] {
    const min = this.getMinBid();
    const max = this.getMaxBid();
    const options: number[] = [];
    for (let bid = min; bid <= max; bid += 5) {
      options.push(bid);
    }
    return options;
  }

  placeBid(bid: number | 'pass' | 'check'): void {
    if (!this.gameId || !this.myPosition || this.isSubmittingBid) return;
    
    this.isSubmittingBid = true;
    this.socketService.placeBid(this.gameId, this.myPosition, bid);
    
    // Reset after a short delay to prevent double-clicking
    setTimeout(() => {
      this.isSubmittingBid = false;
    }, 1000);
  }

  onBidAmountChange(): void {
    // Ensure selected bid is within valid range
    const min = this.getMinBid();
    const max = this.getMaxBid();
    
    if (this.selectedBidAmount < min) {
      this.selectedBidAmount = min;
    } else if (this.selectedBidAmount > max) {
      this.selectedBidAmount = max;
    } else {
      // Round to nearest multiple of 5
      this.selectedBidAmount = Math.round(this.selectedBidAmount / 5) * 5;
    }
  }

  // Trump declaration methods
  canDeclareTrump(): boolean {
    return this.game?.state === 'declaring_trump' && 
           this.game?.highBidder === this.myPosition;
  }

  declareTrump(suit: 'red' | 'black' | 'green' | 'yellow'): void {
    if (!this.gameId || !this.myPosition) return;
    this.socketService.declareTrump(this.gameId, this.myPosition, suit);
  }

  // Scoring methods
  closeScoringPopup(): void {
    this.showScoringPopup = false;
    // Mark this player as ready for next hand
    if (this.gameId && this.myPosition) {
      this.socketService.scoringReady(this.gameId, this.myPosition);
    }
  }

  getTeamNames(team: 'northSouth' | 'eastWest'): string {
    if (!this.game?.playerNames) return team === 'northSouth' ? 'North / South' : 'East / West';
    
    if (team === 'northSouth') {
      const northName = this.game.playerNames['north'] || 'North';
      const southName = this.game.playerNames['south'] || 'South';
      return `${northName} / ${southName}`;
    } else {
      const eastName = this.game.playerNames['east'] || 'East';
      const westName = this.game.playerNames['west'] || 'West';
      return `${eastName} / ${westName}`;
    }
  }

  // Winner popup methods
  closeWinnerPopup(): void {
    this.showWinnerPopup = false;
    // Leave table and go to home
    if (this.game?.table?.id) {
      this.tableService.leaveTable(this.game.table.id).subscribe({
        next: () => {
          this.router.navigate(['/']);
        },
        error: (error) => {
          console.error('Error leaving table:', error);
          // Navigate anyway
          this.router.navigate(['/']);
        }
      });
    } else {
      this.router.navigate(['/']);
    }
  }

  getWinnerTeamName(): string {
    if (!this.winningTeam || !this.game?.playerNames) return '';
    return this.getTeamNames(this.winningTeam);
  }

  getWinnerScore(): number {
    if (!this.winningTeam || !this.game) return 0;
    return this.winningTeam === 'northSouth' ? this.game.northSouthScore : this.game.eastWestScore;
  }

  getLoserTeamName(): string {
    if (!this.winningTeam || !this.game?.playerNames) return '';
    const losingTeam = this.winningTeam === 'northSouth' ? 'eastWest' : 'northSouth';
    return this.getTeamNames(losingTeam);
  }

  getLoserScore(): number {
    if (!this.winningTeam || !this.game) return 0;
    return this.winningTeam === 'northSouth' ? this.game.eastWestScore : this.game.northSouthScore;
  }

  private getPartner(position: string): string {
    const partners: Record<string, string> = {
      'north': 'south',
      'south': 'north',
      'east': 'west',
      'west': 'east'
    };
    return partners[position];
  }

  private getCurrentPlayer(): string | null {
    if (!this.game || this.game.state !== 'playing') return null;
    
    const currentTrick = this.game.gameState.currentTrick;
    if (currentTrick.cards.length === 0) {
      return currentTrick.leadPlayer;
    } else if (currentTrick.cards.length < 4) {
      const lastPlayer = currentTrick.cards[currentTrick.cards.length - 1].player;
      return this.getNextPlayer(lastPlayer);
    }
    return null;
  }

  onCanvasClick(event: MouseEvent): void {
    if (!this.game || !this.canvasRef) return;

    const canvas = this.canvasRef.nativeElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = this.TABLE_WIDTH / rect.width;
    const scaleY = this.TABLE_HEIGHT / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;

    // Handle start button in 'new' state
    if (this.game.state === 'new') {
      const buttonWidth = 200;
      const buttonHeight = 60;
      const buttonX = this.TABLE_WIDTH / 2 - buttonWidth / 2;
      const buttonY = this.TABLE_HEIGHT / 2 - buttonHeight / 2;

      if (x >= buttonX && x <= buttonX + buttonWidth &&
          y >= buttonY && y <= buttonY + buttonHeight) {
        this.onStartGame();
      }
      return;
    }

    // Handle card selection in 'selecting' state
    if (this.game.state === 'selecting' && this.game.highBidder === this.myPosition) {
      // Check discard button first (if 6 cards selected)
      if (this.selectedCardsForDiscard.size === 6) {
        const buttonWidth = 120;
        const buttonHeight = 50;
        const buttonX = this.TABLE_WIDTH - buttonWidth - 20;
        const buttonY = this.TABLE_HEIGHT - buttonHeight - 20;

        if (x >= buttonX && x <= buttonX + buttonWidth &&
            y >= buttonY && y <= buttonY + buttonHeight) {
          this.onDiscardCards();
          return;
        }
      }

      // Handle card selection
      this.handleCardSelectionClick(x, y);
      return;
    }

    // Handle card playing in 'playing' state
    if (this.game.state === 'playing' && this.myPosition) {
      this.handleCardPlayClick(x, y);
      return;
    }
  }

  private handleCardSelectionClick(x: number, y: number): void {
    if (!this.game || !this.myPosition) return;

    const margin = 12;
    const cardSpacingBottom = this.CARD_WIDTH_DISPLAY + 2;
    const backendPos = this.myPosition as 'north' | 'south' | 'east' | 'west';
    const allCards = this.game.gameState.hands[backendPos];
    const topRowCount = 6;
    const bottomRowCount = 9;
    const rowGap = 10;

    // Split cards BEFORE sorting - same as renderSelectingState
    const bottomRowCards = this.sortCards(allCards.slice(0, bottomRowCount)); // Original 9 cards, sorted
    const topRowCards = this.sortCards(allCards.slice(bottomRowCount)); // CenterPile 6 cards, sorted

    // Calculate positions
    const bottomRowY = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin;
    const bottomRowWidth = this.CARD_WIDTH_DISPLAY + (bottomRowCount - 1) * cardSpacingBottom;
    const bottomRowStartX = (this.TABLE_WIDTH - bottomRowWidth) / 2;
    const topRowY = bottomRowY - this.CARD_HEIGHT_DISPLAY - rowGap;
    const topRowWidth = this.CARD_WIDTH_DISPLAY + (topRowCount - 1) * cardSpacingBottom;
    const topRowStartX = (this.TABLE_WIDTH - topRowWidth) / 2;

    // Check top row
    for (let i = 0; i < topRowCount; i++) {
      const cardX = topRowStartX + i * cardSpacingBottom;
      if (x >= cardX && x <= cardX + this.CARD_WIDTH_DISPLAY &&
          y >= topRowY && y <= topRowY + this.CARD_HEIGHT_DISPLAY) {
        this.toggleCardSelection(topRowCards[i].id);
        return;
      }
    }

    // Check bottom row
    for (let i = 0; i < bottomRowCount; i++) {
      const cardX = bottomRowStartX + i * cardSpacingBottom;
      if (x >= cardX && x <= cardX + this.CARD_WIDTH_DISPLAY &&
          y >= bottomRowY && y <= bottomRowY + this.CARD_HEIGHT_DISPLAY) {
        this.toggleCardSelection(bottomRowCards[i].id);
        return;
      }
    }
  }

  private toggleCardSelection(cardId: string): void {
    if (this.selectedCardsForDiscard.has(cardId)) {
      this.selectedCardsForDiscard.delete(cardId);
    } else {
      if (this.selectedCardsForDiscard.size < 6) {
        this.selectedCardsForDiscard.add(cardId);
      }
    }
    this.renderTable();
  }

  private onDiscardCards(): void {
    if (!this.gameId || !this.myPosition || this.selectedCardsForDiscard.size !== 6) return;

    // Get all 15 cards
    const backendPos = this.myPosition as 'north' | 'south' | 'east' | 'west';
    const allCards = this.game!.gameState.hands[backendPos];
    
    // Backend expects the 9 cards to KEEP, not the 6 to discard
    const cardsToKeep = allCards.filter(card => !this.selectedCardsForDiscard.has(card.id));
    const cardsToKeepIds = cardsToKeep.map(card => card.id);

    this.socketService.selectCards(this.gameId, this.myPosition as PlayerPosition, cardsToKeepIds);
    this.selectedCardsForDiscard.clear();
  }

  private handleCardPlayClick(x: number, y: number): void {
    if (!this.game || !this.myPosition) return;

    const margin = 12;
    const cardSpacingBottom = this.CARD_WIDTH_DISPLAY + 2;
    const backendPos = this.myPosition as 'north' | 'south' | 'east' | 'west';
    const cards = this.game.gameState.hands[backendPos];
    
    if (cards.length === 0) return;

    // Sort cards same way as rendering
    const sortedCards = this.sortCards(cards);
    const cardCount = sortedCards.length;
    const bottomY = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin;
    const totalWidth = this.CARD_WIDTH_DISPLAY + (cardCount - 1) * cardSpacingBottom;
    const startX = (this.TABLE_WIDTH - totalWidth) / 2;

    // Check each card
    for (let i = 0; i < cardCount; i++) {
      const card = sortedCards[i];
      const cardX = startX + i * cardSpacingBottom;
      const isSelected = this.selectedCardForPlay === card.id;
      const cardY = isSelected ? bottomY - this.CARD_HEIGHT_DISPLAY / 4 : bottomY;

      if (x >= cardX && x <= cardX + this.CARD_WIDTH_DISPLAY &&
          y >= cardY && y <= cardY + this.CARD_HEIGHT_DISPLAY) {
        
        const currentTime = Date.now();
        const isDoubleClick = 
          this.lastClickedCardId === card.id && 
          (currentTime - this.lastClickTime) < this.DOUBLE_CLICK_DELAY;

        if (isDoubleClick || isSelected) {
          // Double-click or clicking already selected card - play it
          this.playCard(card.id);
        } else {
          // Single click - select/deselect the card
          this.selectedCardForPlay = this.selectedCardForPlay === card.id ? null : card.id;
          this.lastClickedCardId = card.id;
          this.lastClickTime = currentTime;
          this.renderTable();
        }
        return;
      }
    }

    // Clicked outside any card - deselect
    if (this.selectedCardForPlay) {
      this.selectedCardForPlay = null;
      this.renderTable();
    }
  }

  private playCard(cardId: string): void {
    if (!this.gameId || !this.myPosition) return;
    
    this.socketService.playCard(this.gameId, this.myPosition as PlayerPosition, cardId);
    this.selectedCardForPlay = null;
  }

  private renderPlayerHand(backendPosition: string, cards: Card[], margin: number, overlap: number): void {
    if (!this.ctx || !this.cardImage || cards.length === 0) return;

    const displayPosition = this.getDisplayPosition(backendPosition);
    const isMyHand = backendPosition === this.myPosition;
    const cardCount = cards.length;
    
    // Determine if this player is active (needs to play or bid)
    const isActivePlayer = (this.game?.state === 'playing' && this.getCurrentPlayer() === backendPosition) ||
                          (this.game?.state === 'bidding' && this.game?.currentBidder === backendPosition);
    const padding = 8; // Padding around hand for yellow rectangle

    if (displayPosition === 'bottom') {
      const bottomY = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin;
      const totalWidth = this.CARD_WIDTH_DISPLAY + (cardCount - 1) * overlap;
      const startX = (this.TABLE_WIDTH - totalWidth) / 2;
      const isPlayingState = this.game?.state === 'playing';
      
      // Draw yellow rectangle around active player's hand
      if (isActivePlayer) {
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 4;
        this.ctx.strokeRect(
          startX - padding,
          bottomY - padding,
          totalWidth + padding * 2,
          this.CARD_HEIGHT_DISPLAY + padding * 2
        );
      }

      for (let i = 0; i < cardCount; i++) {
        const card = cards[i];
        const sourceX = isMyHand && card.id ? this.getCardSourceX(card) : 57 * this.CARD_WIDTH_SOURCE; // Card back
        
        // Offset selected card up by 1/4 card height in playing state
        const isSelected = isPlayingState && this.selectedCardForPlay === card.id;
        const cardY = isSelected ? bottomY - this.CARD_HEIGHT_DISPLAY / 4 : bottomY;
        
        this.ctx.drawImage(
          this.cardImage,
          sourceX, 0,
          this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
          startX + i * overlap, cardY,
          this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
        );
      }
    } else if (displayPosition === 'top') {
      const topY = margin;
      const totalWidth = this.CARD_WIDTH_DISPLAY + (cardCount - 1) * overlap;
      const startX = (this.TABLE_WIDTH - totalWidth) / 2;
      
      // Draw yellow rectangle around active player's hand
      if (isActivePlayer) {
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 4;
        this.ctx.strokeRect(
          startX - padding,
          topY - padding,
          totalWidth + padding * 2,
          this.CARD_HEIGHT_DISPLAY + padding * 2
        );
      }

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
    } else if (displayPosition === 'left') {
      const leftX = margin;
      const totalHeight = this.CARD_HEIGHT_DISPLAY + (cardCount - 1) * overlap;
      const startY = (this.TABLE_HEIGHT - totalHeight) / 2;
      
      // Draw yellow rectangle around active player's hand
      if (isActivePlayer) {
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 4;
        this.ctx.strokeRect(
          leftX - padding,
          startY - padding,
          this.CARD_WIDTH_DISPLAY + padding * 2,
          totalHeight + padding * 2
        );
      }

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
    } else if (displayPosition === 'right') {
      const rightX = this.TABLE_WIDTH - this.CARD_WIDTH_DISPLAY - margin;
      const totalHeight = this.CARD_HEIGHT_DISPLAY + (cardCount - 1) * overlap;
      const startY = (this.TABLE_HEIGHT - totalHeight) / 2;
      
      // Draw yellow rectangle around active player's hand
      if (isActivePlayer) {
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 4;
        this.ctx.strokeRect(
          rightX - padding,
          startY - padding,
          this.CARD_WIDTH_DISPLAY + padding * 2,
          totalHeight + padding * 2
        );
      }

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

  private renderSelectingState(margin: number, cardSpacing: number): void {
    if (!this.ctx || !this.cardImage || !this.game || !this.myPosition) return;

    const backendPos = this.myPosition as 'north' | 'south' | 'east' | 'west';
    const allCards = this.game.gameState.hands[backendPos];
    const totalCards = allCards.length; // Should be 15 (9 original + 6 from centerPile)
    
    // Split into two rows BEFORE sorting: first 9 are original, last 6 are from centerPile
    const topRowCount = 6;
    const bottomRowCount = 9;
    
    // Split cards: first 9 are original hand, last 6 are from centerPile
    const bottomRowCards = this.sortCards(allCards.slice(0, bottomRowCount)); // Original 9 cards, sorted
    const topRowCards = this.sortCards(allCards.slice(bottomRowCount)); // CenterPile 6 cards, sorted
    
    // Calculate positions
    const iconSize = 50;
    const iconMargin = 20;
    const rowGap = 10; // Gap between the two rows of cards
    
    // Bottom row (original 9 cards) - positioned at bottom of screen
    const bottomRowY = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin;
    const bottomRowWidth = this.CARD_WIDTH_DISPLAY + (bottomRowCount - 1) * cardSpacing;
    const bottomRowStartX = (this.TABLE_WIDTH - bottomRowWidth) / 2;
    
    // Top row (6 centerPile cards) - positioned above bottom row
    const topRowY = bottomRowY - this.CARD_HEIGHT_DISPLAY - rowGap;
    const topRowWidth = this.CARD_WIDTH_DISPLAY + (topRowCount - 1) * cardSpacing;
    const topRowStartX = (this.TABLE_WIDTH - topRowWidth) / 2;
    
    // Icon and username positioned above top row (centered above the 6 centerPile cards)
    const iconX = this.TABLE_WIDTH / 2 - iconSize / 2;
    const iconY = topRowY - iconSize - iconMargin;
    
    // Draw top row (centerPile cards)
    for (let i = 0; i < topRowCount; i++) {
      const card = topRowCards[i];
      const sourceX = this.getCardSourceX(card);
      const cardX = topRowStartX + i * cardSpacing;
      
      // Draw card
      this.ctx.drawImage(
        this.cardImage,
        sourceX, 0,
        this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
        cardX, topRowY,
        this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
      );
      
      // Draw selection highlight if selected
      if (this.selectedCardsForDiscard.has(card.id)) {
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 4;
        this.ctx.strokeRect(cardX, topRowY, this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY);
        
        // Add semi-transparent yellow overlay
        this.ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
        this.ctx.fillRect(cardX, topRowY, this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY);
      }
    }
    
    // Draw bottom row (original hand)
    for (let i = 0; i < bottomRowCount; i++) {
      const card = bottomRowCards[i];
      const sourceX = this.getCardSourceX(card);
      const cardX = bottomRowStartX + i * cardSpacing;
      
      // Draw card
      this.ctx.drawImage(
        this.cardImage,
        sourceX, 0,
        this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
        cardX, bottomRowY,
        this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
      );
      
      // Draw selection highlight if selected
      if (this.selectedCardsForDiscard.has(card.id)) {
        this.ctx.strokeStyle = '#FFD700';
        this.ctx.lineWidth = 4;
        this.ctx.strokeRect(cardX, bottomRowY, this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY);
        
        // Add semi-transparent yellow overlay
        this.ctx.fillStyle = 'rgba(255, 215, 0, 0.3)';
        this.ctx.fillRect(cardX, bottomRowY, this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY);
      }
    }
    
    // Draw "Discard" button when 6 cards are selected
    if (this.selectedCardsForDiscard.size === 6) {
      const buttonWidth = 120;
      const buttonHeight = 50;
      const buttonX = this.TABLE_WIDTH - buttonWidth - 20;
      const buttonY = this.TABLE_HEIGHT - buttonHeight - 20;
      const borderRadius = 10;

      // Button shadow
      this.ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
      this.ctx.shadowBlur = 8;
      this.ctx.shadowOffsetX = 2;
      this.ctx.shadowOffsetY = 2;

      // Button background
      this.ctx.fillStyle = '#4CAF50';
      this.ctx.beginPath();
      this.ctx.moveTo(buttonX + borderRadius, buttonY);
      this.ctx.lineTo(buttonX + buttonWidth - borderRadius, buttonY);
      this.ctx.quadraticCurveTo(buttonX + buttonWidth, buttonY, buttonX + buttonWidth, buttonY + borderRadius);
      this.ctx.lineTo(buttonX + buttonWidth, buttonY + buttonHeight - borderRadius);
      this.ctx.quadraticCurveTo(buttonX + buttonWidth, buttonY + buttonHeight, buttonX + buttonWidth - borderRadius, buttonY + buttonHeight);
      this.ctx.lineTo(buttonX + borderRadius, buttonY + buttonHeight);
      this.ctx.quadraticCurveTo(buttonX, buttonY + buttonHeight, buttonX, buttonY + buttonHeight - borderRadius);
      this.ctx.lineTo(buttonX, buttonY + borderRadius);
      this.ctx.quadraticCurveTo(buttonX, buttonY, buttonX + borderRadius, buttonY);
      this.ctx.closePath();
      this.ctx.fill();

      // Reset shadow
      this.ctx.shadowColor = 'transparent';
      this.ctx.shadowBlur = 0;
      this.ctx.shadowOffsetX = 0;
      this.ctx.shadowOffsetY = 0;

      // Button border
      this.ctx.strokeStyle = '#388E3C';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      // Button text
      this.ctx.fillStyle = 'white';
      this.ctx.font = 'bold 18px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText('Discard', buttonX + buttonWidth / 2, buttonY + buttonHeight / 2);
    }
    
    // Draw icon for current user (the selecting player) above the centerPile cards
    const playerType = this.game.playerTypes[this.myPosition];
    const isDealer = this.game.dealer === this.myPosition;
    const iconColor = isDealer ? '#ffa500' : '#4CAF50';
    
    this.ctx.beginPath();
    this.ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
    this.ctx.fillStyle = iconColor;
    this.ctx.fill();
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    
    // Draw icon (computer or user)
    const iconImage = new Image();
    iconImage.src = playerType === 'computer' ? '/images/computer.png' : '/images/user.png';
    if (iconImage.complete) {
      this.ctx.drawImage(iconImage, iconX + 8, iconY + 8, iconSize - 16, iconSize - 16);
    } else {
      iconImage.onload = () => {
        if (this.ctx) {
          this.ctx.drawImage(iconImage, iconX + 8, iconY + 8, iconSize - 16, iconSize - 16);
        }
      };
    }
    
    // Draw username
    const playerName = this.game.playerNames?.[this.myPosition] || this.myPosition;
    const displayText = this.currentUser?.userType === 'admin' && this.myPosition
      ? `${playerName} (${this.myPosition})` 
      : playerName;
    this.ctx.font = isDealer ? 'bold 14px Arial' : '13px Arial';
    this.ctx.fillStyle = isDealer ? '#ffa500' : '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    this.ctx.shadowBlur = 3;
    this.ctx.shadowOffsetX = 1;
    this.ctx.shadowOffsetY = 1;
    this.ctx.fillText(displayText, iconX + iconSize / 2, iconY + iconSize + 5);
    
    // Reset shadow
    this.ctx.shadowColor = 'transparent';
    this.ctx.shadowBlur = 0;
    this.ctx.shadowOffsetX = 0;
    this.ctx.shadowOffsetY = 0;
  }

  private renderCenterPile(): void {
    if (!this.ctx || !this.cardImage || !this.game) return;

    const centerPileCenter = { 
      x: this.TABLE_WIDTH / 2 - this.CARD_WIDTH_DISPLAY / 2, 
      y: this.TABLE_HEIGHT / 2 - this.CARD_HEIGHT_DISPLAY / 2 
    };

    const stackSourceX = 57 * this.CARD_WIDTH_SOURCE; // Card back

    // Draw 5 face-down cards stacked with offset
    const faceDownCount = Math.min(5, this.game.gameState.centerPile.faceDown.length);
    for (let i = 0; i < faceDownCount; i++) {
      this.ctx.drawImage(
        this.cardImage,
        stackSourceX, 0,
        this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
        centerPileCenter.x + i * 2, centerPileCenter.y + i * 2,
        this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
      );
    }

    // Draw face-up card on top of the stack
    if (this.game.gameState.centerPile.faceUp) {
      const faceUpSourceX = this.getCardSourceX(this.game.gameState.centerPile.faceUp);
      this.ctx.drawImage(
        this.cardImage,
        faceUpSourceX, 0,
        this.CARD_WIDTH_SOURCE, this.CARD_HEIGHT_SOURCE,
        centerPileCenter.x + faceDownCount * 2, centerPileCenter.y + faceDownCount * 2,
        this.CARD_WIDTH_DISPLAY, this.CARD_HEIGHT_DISPLAY
      );
    }
  }

  private renderPlayerIcons(): void {
    if (!this.ctx || !this.game) return;

    const margin = 20;
    const iconSize = 50;
    const positions: Array<'north' | 'south' | 'east' | 'west'> = ['north', 'south', 'east', 'west'];
    
    // Check if we're in selecting state and if current user is the high bidder
    const isSelectingState = this.game.state === 'selecting';
    const isCurrentUserHighBidder = isSelectingState && this.game.highBidder === this.myPosition;

    for (const backendPos of positions) {
      // Skip rendering the current user's icon in selecting state - it's rendered above centerPile cards
      if (isCurrentUserHighBidder && backendPos === this.myPosition) {
        continue;
      }
      
      const displayPos = this.getDisplayPosition(backendPos);
      const playerType = this.game.playerTypes[backendPos];
      const player = this.game.table[`${backendPos}Player` as keyof typeof this.game.table];
      const playerName = this.game.playerNames?.[backendPos] || backendPos;
      const isDealer = this.game.dealer === backendPos;
      
      // Determine if this player is active (needs to play)
      const isActivePlayer = this.game.state === 'playing' && this.getCurrentPlayer() === backendPos;

      let iconX: number, iconY: number;

      // Position icon based on display position
      if (displayPos === 'bottom') {
        // Bottom player: just above cards, centered
        iconX = this.TABLE_WIDTH / 2 - iconSize / 2;
        iconY = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin - iconSize - 35;
      } else if (displayPos === 'top') {
        // Top player: to the right of cards
        const topCardsEndX = this.TABLE_WIDTH / 2 + (this.CARD_WIDTH_DISPLAY + (9 - 1) * (this.CARD_WIDTH_DISPLAY * 0.3)) / 2;
        iconX = topCardsEndX + 20;
        iconY = margin + 10;
      } else if (displayPos === 'left') {
        // Left player: above stack
        iconX = margin + this.CARD_WIDTH_DISPLAY / 2 - iconSize / 2;
        const leftCardsStartY = (this.TABLE_HEIGHT - (this.CARD_HEIGHT_DISPLAY + 30 * 9)) / 2;
        iconY = leftCardsStartY - iconSize - 45;
      } else { // right
        // Right player: above stack
        iconX = this.TABLE_WIDTH - margin - this.CARD_WIDTH_DISPLAY / 2 - iconSize / 2;
        const rightCardsStartY = (this.TABLE_HEIGHT - (this.CARD_HEIGHT_DISPLAY + 30 * 9)) / 2;
        iconY = rightCardsStartY - iconSize - 45;
      }

      // Draw icon background circle
      this.ctx.beginPath();
      this.ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, iconSize / 2, 0, 2 * Math.PI);
      // Always green icon
      this.ctx.fillStyle = '#4CAF50';
      this.ctx.fill();
      this.ctx.strokeStyle = '#ffffff';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      // Draw icon (computer or user)
      const iconImage = new Image();
      iconImage.src = playerType === 'computer' ? '/images/computer.png' : '/images/user.png';
      if (iconImage.complete) {
        this.ctx.drawImage(iconImage, iconX + 8, iconY + 8, iconSize - 16, iconSize - 16);
      } else {
        iconImage.onload = () => {
          if (this.ctx) {
            this.ctx.drawImage(iconImage, iconX + 8, iconY + 8, iconSize - 16, iconSize - 16);
          }
        };
      }

      // Draw username below icon
      // Dealer: orange text, bold
      // Others (including active player): white text
      this.ctx.fillStyle = isDealer ? '#ffa500' : '#ffffff';
      this.ctx.font = isDealer ? 'bold 14px Arial' : '13px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'top';
      this.ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      this.ctx.shadowBlur = 3;
      this.ctx.shadowOffsetX = 1;
      this.ctx.shadowOffsetY = 1;
      
      // Add position in parentheses if current user is admin
      const displayText = this.currentUser?.userType === 'admin' 
        ? `${playerName} (${backendPos})` 
        : playerName;
      this.ctx.fillText(displayText, iconX + iconSize / 2, iconY + iconSize + 5);
      
      // Reset shadow
      this.ctx.shadowColor = 'transparent';
      this.ctx.shadowBlur = 0;
      this.ctx.shadowOffsetX = 0;
      this.ctx.shadowOffsetY = 0;
    }
  }

  private renderPlayerNames(): void {
    if (!this.ctx || !this.game || !this.game.playerNames) return;

    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    const margin = 20;

    // Helper function to render a player's name with dealer highlighting
    const renderName = (position: string, x: number, y: number) => {
      const isDealer = this.game!.dealer === position;
      const playerName = this.game!.playerNames[position];
      
      if (isDealer) {
        // Dealer style: bold orange/gold with shadow
        this.ctx!.font = 'bold 18px Arial';
        this.ctx!.fillStyle = '#ffa500'; // Orange/gold color
        this.ctx!.shadowColor = 'rgba(0, 0, 0, 0.8)';
        this.ctx!.shadowBlur = 4;
        this.ctx!.shadowOffsetX = 2;
        this.ctx!.shadowOffsetY = 2;
      } else {
        // Regular player style
        this.ctx!.font = '16px Arial';
        this.ctx!.fillStyle = '#ffffff';
        this.ctx!.shadowColor = 'transparent';
        this.ctx!.shadowBlur = 0;
        this.ctx!.shadowOffsetX = 0;
        this.ctx!.shadowOffsetY = 0;
      }
      
      this.ctx!.fillText(playerName, x, y);
      
      // Reset shadow
      this.ctx!.shadowColor = 'transparent';
      this.ctx!.shadowBlur = 0;
      this.ctx!.shadowOffsetX = 0;
      this.ctx!.shadowOffsetY = 0;
    };

    // Render each backend position at its mapped display position
    const positions: Array<'north' | 'south' | 'east' | 'west'> = ['north', 'south', 'east', 'west'];
    
    for (const backendPos of positions) {
      const displayPos = this.getDisplayPosition(backendPos);
      
      if (displayPos === 'bottom') {
        // Bottom player: center, just above cards
        const bottomY = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin - 15;
        renderName(backendPos, this.TABLE_WIDTH / 2, bottomY);
      } else if (displayPos === 'top') {
        // Top player: center, just below the cards
        const topY = margin + this.CARD_HEIGHT_DISPLAY + 15;
        renderName(backendPos, this.TABLE_WIDTH / 2, topY);
      } else if (displayPos === 'left') {
        // Left player: on top of the stack
        const leftX = margin + this.CARD_WIDTH_DISPLAY / 2;
        const leftCardsStartY = (this.TABLE_HEIGHT - (this.CARD_HEIGHT_DISPLAY + 30 * 9)) / 2;
        renderName(backendPos, leftX, leftCardsStartY - 10);
      } else if (displayPos === 'right') {
        // Right player: on top of the stack
        const rightX = this.TABLE_WIDTH - margin - this.CARD_WIDTH_DISPLAY / 2;
        const rightCardsStartY = (this.TABLE_HEIGHT - (this.CARD_HEIGHT_DISPLAY + 30 * 9)) / 2;
        renderName(backendPos, rightX, rightCardsStartY - 10);
      }
    }
  }

  private renderScores(): void {
    if (!this.ctx || !this.game || !this.game.playerNames) return;

    const padding = 10;
    const boxPadding = 12;
    const lineHeight = 28;
    const boxX = padding;
    const boxY = padding;

    // Get player names
    const northName = this.game.playerNames['north'] || 'North';
    const southName = this.game.playerNames['south'] || 'South';
    const eastName = this.game.playerNames['east'] || 'East';
    const westName = this.game.playerNames['west'] || 'West';

    // Create team names and scores separately
    const nsTeam = `${northName} & ${southName}`;
    const ewTeam = `${eastName} & ${westName}`;

    // Measure text to size the box
    this.ctx.font = '16px Arial';
    const nsTeamWidth = this.ctx.measureText(nsTeam).width;
    const ewTeamWidth = this.ctx.measureText(ewTeam).width;
    const maxTeamWidth = Math.max(nsTeamWidth, ewTeamWidth);
    
    // Add space for colon, gap, and score (assume max 4 digits)
    const colonWidth = this.ctx.measureText(': ').width;
    const scoreWidth = this.ctx.measureText('0000').width;
    const boxWidth = maxTeamWidth + colonWidth + scoreWidth + boxPadding * 2;
    const boxHeight = lineHeight * 2 + boxPadding * 2;

    // Draw modern box with gradient background
    const gradient = this.ctx.createLinearGradient(boxX, boxY, boxX, boxY + boxHeight);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
    gradient.addColorStop(1, 'rgba(30, 30, 30, 0.85)');
    
    this.ctx.fillStyle = gradient;
    this.ctx.strokeStyle = '#667eea';
    this.ctx.lineWidth = 2;
    
    // Draw rounded rectangle
    const radius = 8;
    this.ctx.beginPath();
    this.ctx.moveTo(boxX + radius, boxY);
    this.ctx.lineTo(boxX + boxWidth - radius, boxY);
    this.ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
    this.ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
    this.ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
    this.ctx.lineTo(boxX + radius, boxY + boxHeight);
    this.ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
    this.ctx.lineTo(boxX, boxY + radius);
    this.ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    // Draw score text with aligned columns
    this.ctx.font = '16px Arial';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillStyle = '#ffffff';
    
    // Calculate column positions
    const teamColumnX = boxX + boxPadding + maxTeamWidth; // Right edge of team names column
    const scoreColumnX = teamColumnX + colonWidth; // Left edge of scores column
    
    // Calculate Y positions (centered in each line)
    const firstLineY = boxY + boxPadding + lineHeight / 2;
    const secondLineY = boxY + boxPadding + lineHeight + lineHeight / 2;
    
    // Draw team names (right-aligned)
    this.ctx.textAlign = 'right';
    this.ctx.fillText(nsTeam, teamColumnX, firstLineY);
    this.ctx.fillText(ewTeam, teamColumnX, secondLineY);
    
    // Draw colons
    this.ctx.textAlign = 'left';
    this.ctx.fillText(':', teamColumnX, firstLineY);
    this.ctx.fillText(':', teamColumnX, secondLineY);
    
    // Draw scores (left-aligned)
    this.ctx.fillText(String(this.game.northSouthScore), scoreColumnX, firstLineY);
    this.ctx.fillText(String(this.game.eastWestScore), scoreColumnX, secondLineY);
  }

  private renderTrumpIndicator(): void {
    if (!this.ctx || !this.game || !this.game.trumpSuit) return;

    const margin = 12;
    const boxWidth = 100;
    const boxHeight = 50;
    const boxX = margin;
    const boxY = this.TABLE_HEIGHT - boxHeight - margin;
    const radius = 8;

    // Draw rounded rectangle background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    
    this.ctx.beginPath();
    this.ctx.moveTo(boxX + radius, boxY);
    this.ctx.lineTo(boxX + boxWidth - radius, boxY);
    this.ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
    this.ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
    this.ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
    this.ctx.lineTo(boxX + radius, boxY + boxHeight);
    this.ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
    this.ctx.lineTo(boxX, boxY + radius);
    this.ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    // Draw "Trump:" label
    this.ctx.font = '12px Arial';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText('Trump:', boxX + boxWidth / 2, boxY + 6);

    // Draw colored circle for trump suit
    const circleRadius = 12;
    const circleY = boxY + boxHeight - circleRadius - 8;
    
    // Map suit to color
    const colorMap: { [key: string]: string } = {
      'red': '#dc143c',
      'black': '#2c2c2c',
      'green': '#228b22',
      'yellow': '#ffd700'
    };
    
    this.ctx.fillStyle = colorMap[this.game.trumpSuit] || '#ffffff';
    this.ctx.beginPath();
    this.ctx.arc(boxX + boxWidth / 2, circleY, circleRadius, 0, Math.PI * 2);
    this.ctx.fill();
    
    // Add white border to circle
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
  }

  private renderBidInfo(): void {
    if (!this.ctx || !this.game || !this.game.highBidder || !this.game.highBid) return;

    // Position: lower left, next to trump indicator
    const margin = 12;
    const trumpBoxWidth = 100;
    const spacing = 12;
    const boxX = margin + trumpBoxWidth + spacing;
    const boxHeight = 50;
    const boxY = this.TABLE_HEIGHT - boxHeight - margin;
    const radius = 8;

    // Determine bidding team
    const biddingTeam = (this.game.highBidder === 'north' || this.game.highBidder === 'south') 
      ? 'northSouth' 
      : 'eastWest';
    const teamName = this.getTeamNames(biddingTeam);

    // Measure text to determine box width
    this.ctx.font = '12px Arial';
    const bidText = `Bid: ${this.game.highBid}`;
    this.ctx.font = '11px Arial';
    const teamTextWidth = this.ctx.measureText(teamName).width;
    this.ctx.font = '12px Arial';
    const bidTextWidth = this.ctx.measureText(bidText).width;
    const maxTextWidth = Math.max(teamTextWidth, bidTextWidth);
    const boxWidth = maxTextWidth + 24; // 12px padding on each side

    // Draw rounded rectangle background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = 2;
    
    this.ctx.beginPath();
    this.ctx.moveTo(boxX + radius, boxY);
    this.ctx.lineTo(boxX + boxWidth - radius, boxY);
    this.ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
    this.ctx.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
    this.ctx.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
    this.ctx.lineTo(boxX + radius, boxY + boxHeight);
    this.ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
    this.ctx.lineTo(boxX, boxY + radius);
    this.ctx.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();

    // Draw team name
    this.ctx.font = '11px Arial';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(teamName, boxX + boxWidth / 2, boxY + 6);

    // Draw bid amount
    this.ctx.font = 'bold 14px Arial';
    this.ctx.fillStyle = '#ffd700'; // Gold color for bid
    this.ctx.textBaseline = 'bottom';
    this.ctx.fillText(bidText, boxX + boxWidth / 2, boxY + boxHeight - 6);
  }

  private renderBiddingInfo(): void {
    if (!this.ctx || !this.game) return;

    // Only show during bidding phase
    if (this.game.state !== 'bidding') return;

    this.ctx.font = '18px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillStyle = '#ffff00'; // Yellow for visibility
    
    // Position relative to centerPile
    const centerPileY = this.TABLE_HEIGHT / 2 - this.CARD_HEIGHT_DISPLAY / 2;
    const centerPileBottomY = this.TABLE_HEIGHT / 2 + this.CARD_HEIGHT_DISPLAY / 2;

    // Show high bidder and bid above the centerPile (only if there's a bid)
    if (this.game.highBidder && this.game.highBid) {
      this.ctx.textBaseline = 'bottom';
      const bidderName = this.game.playerNames?.[this.game.highBidder] || this.game.highBidder;
      const bidText = `High Bid: ${bidderName} - ${this.game.highBid}`;
      this.ctx.fillText(bidText, this.TABLE_WIDTH / 2, centerPileY - 10);
    }

    // Render speech bubbles for recent bids
    this.renderBidSpeechBubbles();
  }

  private renderBidSpeechBubbles(): void {
    if (!this.ctx || !this.game || !this.game.gameState.biddingHistory) return;

    const margin = 20;
    const iconSize = 50;
    const bubblePadding = 12;
    const bubbleHeight = 40;
    const triangleSize = 8;

    // Show only the last 4 bids (one per player)
    const recentBids = this.game.gameState.biddingHistory.slice(-4);

    for (const bid of recentBids) {
      const backendPos = bid.player as 'north' | 'south' | 'east' | 'west';
      const displayPos = this.getDisplayPosition(backendPos);
      
      // Determine icon position (same as in renderPlayerIcons)
      let iconX: number, iconY: number;

      if (displayPos === 'bottom') {
        iconX = this.TABLE_WIDTH / 2 - iconSize / 2;
        iconY = this.TABLE_HEIGHT - this.CARD_HEIGHT_DISPLAY - margin - iconSize - 35;
      } else if (displayPos === 'top') {
        const topCardsEndX = this.TABLE_WIDTH / 2 + (this.CARD_WIDTH_DISPLAY + (9 - 1) * (this.CARD_WIDTH_DISPLAY * 0.3)) / 2;
        iconX = topCardsEndX + 20;
        iconY = margin + 10;
      } else if (displayPos === 'left') {
        iconX = margin + this.CARD_WIDTH_DISPLAY / 2 - iconSize / 2;
        const leftCardsStartY = (this.TABLE_HEIGHT - (this.CARD_HEIGHT_DISPLAY + 30 * 9)) / 2;
        iconY = leftCardsStartY - iconSize - 45;
      } else { // right
        iconX = this.TABLE_WIDTH - margin - this.CARD_WIDTH_DISPLAY / 2 - iconSize / 2;
        const rightCardsStartY = (this.TABLE_HEIGHT - (this.CARD_HEIGHT_DISPLAY + 30 * 9)) / 2;
        iconY = rightCardsStartY - iconSize - 45;
      }

      // Format bid text
      const bidText = typeof bid.bid === 'number' ? String(bid.bid) : bid.bid.toUpperCase();
      
      // Measure text for bubble size
      this.ctx.font = 'bold 22px Arial';
      const textWidth = this.ctx.measureText(bidText).width;
      const bubbleWidth = textWidth + bubblePadding * 2;

      // Position bubble from inside edge of icon
      let bubbleX: number, bubbleY: number;
      let trianglePoints: { x: number; y: number }[];

      if (displayPos === 'bottom') {
        // Bubble above icon
        bubbleX = iconX + iconSize / 2 - bubbleWidth / 2;
        bubbleY = iconY - bubbleHeight - triangleSize - 5;
        trianglePoints = [
          { x: iconX + iconSize / 2, y: iconY - 5 },
          { x: iconX + iconSize / 2 - triangleSize, y: bubbleY + bubbleHeight },
          { x: iconX + iconSize / 2 + triangleSize, y: bubbleY + bubbleHeight }
        ];
      } else if (displayPos === 'top') {
        // Bubble to the left of icon
        bubbleX = iconX - bubbleWidth - triangleSize - 5;
        bubbleY = iconY + iconSize / 2 - bubbleHeight / 2;
        trianglePoints = [
          { x: iconX - 5, y: iconY + iconSize / 2 },
          { x: bubbleX + bubbleWidth, y: iconY + iconSize / 2 - triangleSize },
          { x: bubbleX + bubbleWidth, y: iconY + iconSize / 2 + triangleSize }
        ];
      } else if (displayPos === 'left') {
        // Bubble to the right of icon
        bubbleX = iconX + iconSize + triangleSize + 5;
        bubbleY = iconY + iconSize / 2 - bubbleHeight / 2;
        trianglePoints = [
          { x: iconX + iconSize + 5, y: iconY + iconSize / 2 },
          { x: bubbleX, y: iconY + iconSize / 2 - triangleSize },
          { x: bubbleX, y: iconY + iconSize / 2 + triangleSize }
        ];
      } else { // right
        // Bubble to the left of icon
        bubbleX = iconX - bubbleWidth - triangleSize - 5;
        bubbleY = iconY + iconSize / 2 - bubbleHeight / 2;
        trianglePoints = [
          { x: iconX - 5, y: iconY + iconSize / 2 },
          { x: bubbleX + bubbleWidth, y: iconY + iconSize / 2 - triangleSize },
          { x: bubbleX + bubbleWidth, y: iconY + iconSize / 2 + triangleSize }
        ];
      }

      // Draw bubble background
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      this.ctx.strokeStyle = '#333';
      this.ctx.lineWidth = 2;
      
      const radius = 6;
      this.ctx.beginPath();
      this.ctx.moveTo(bubbleX + radius, bubbleY);
      this.ctx.lineTo(bubbleX + bubbleWidth - radius, bubbleY);
      this.ctx.quadraticCurveTo(bubbleX + bubbleWidth, bubbleY, bubbleX + bubbleWidth, bubbleY + radius);
      this.ctx.lineTo(bubbleX + bubbleWidth, bubbleY + bubbleHeight - radius);
      this.ctx.quadraticCurveTo(bubbleX + bubbleWidth, bubbleY + bubbleHeight, bubbleX + bubbleWidth - radius, bubbleY + bubbleHeight);
      this.ctx.lineTo(bubbleX + radius, bubbleY + bubbleHeight);
      this.ctx.quadraticCurveTo(bubbleX, bubbleY + bubbleHeight, bubbleX, bubbleY + bubbleHeight - radius);
      this.ctx.lineTo(bubbleX, bubbleY + radius);
      this.ctx.quadraticCurveTo(bubbleX, bubbleY, bubbleX + radius, bubbleY);
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();

      // Draw triangle pointer
      this.ctx.beginPath();
      this.ctx.moveTo(trianglePoints[0].x, trianglePoints[0].y);
      this.ctx.lineTo(trianglePoints[1].x, trianglePoints[1].y);
      this.ctx.lineTo(trianglePoints[2].x, trianglePoints[2].y);
      this.ctx.closePath();
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      this.ctx.fill();
      this.ctx.strokeStyle = '#333';
      this.ctx.stroke();

      // Draw bid text
      this.ctx.fillStyle = bid.bid === 'pass' ? '#ff5555' : '#333';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(bidText, bubbleX + bubbleWidth / 2, bubbleY + bubbleHeight / 2);
    }
  }

  private renderCurrentTrick(): void {
    if (!this.ctx || !this.cardImage || !this.game) return;

    // Render cards played in current trick in center of table
    const centerX = this.TABLE_WIDTH / 2;
    const centerY = this.TABLE_HEIGHT / 2;
    const trickSpacing = 70;

    // Determine which cards to render and if we're animating
    let cardsToRender;
    let isAnimatingToWonPile = false;
    
    if (this.animatingTrickToWonPile) {
      cardsToRender = this.animatingTrickToWonPile.cards;
      isAnimatingToWonPile = true;
    } else if (this.displayingCompletedTrick) {
      cardsToRender = this.displayingCompletedTrick.cards;
    } else {
      cardsToRender = this.game.gameState.currentTrick.cards;
    }

    for (let i = 0; i < cardsToRender.length; i++) {
      const { card, player } = cardsToRender[i];
      const sourceX = this.getCardSourceX(card);
      
      // Position based on display position
      const displayPos = this.getDisplayPosition(player);
      let x = centerX - this.CARD_WIDTH_DISPLAY / 2;
      let y = centerY - this.CARD_HEIGHT_DISPLAY / 2;

      if (displayPos === 'top') y -= trickSpacing;
      if (displayPos === 'bottom') y += trickSpacing;
      if (displayPos === 'right') x += trickSpacing;
      if (displayPos === 'left') x -= trickSpacing;

      // If animating to won pile, interpolate position
      if (isAnimatingToWonPile && this.animatingTrickToWonPile) {
        const wonPileLocation = this.getWonPileLocation(this.animatingTrickToWonPile.winner);
        const progress = this.animatingTrickToWonPile.progress;
        
        // Ease-in interpolation for smoother animation
        const easeProgress = progress * progress;
        
        // Calculate target position - all cards converge to same point
        const targetX = wonPileLocation.x;
        const targetY = wonPileLocation.y;
        
        // Interpolate position
        x = x + (targetX - x) * easeProgress;
        y = y + (targetY - y) * easeProgress;
        
        // As cards move, they stack on top of each other
        // Add slight offset that decreases over time to show stacking
        const stackOffset = (3 - i) * 2 * (1 - easeProgress);
        x += stackOffset;
        y += stackOffset;
      }

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
