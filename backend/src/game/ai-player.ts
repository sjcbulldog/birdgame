import { PlayerPosition, Suit } from './entities/game.entity';

export interface Card {
  color: Suit | 'bird';
  value: number;
  id: string;
}

export interface CompletedTrick {
  winner: PlayerPosition;
  cards: Array<{ player: PlayerPosition; card: Card }>;
  points: number;
}

export interface CurrentTrick {
  cards: Array<{ player: PlayerPosition; card: Card }>;
  leadPlayer: PlayerPosition | null;
  leadSuit: Suit | null;
}

export class AIPlayer {
  private position: PlayerPosition;
  private hand: Card[];
  private centerPileTopCard: Card | null;
  private discardedCards: Card[];
  private completedTricks: CompletedTrick[];
  private trumpSuit: Suit | null;

  constructor(position: PlayerPosition) {
    this.position = position;
    this.hand = [];
    this.centerPileTopCard = null;
    this.discardedCards = [];
    this.completedTricks = [];
    this.trumpSuit = null;
  }

  /**
   * Update the AI player's hand
   */
  updateHand(cards: Card[]): void {
    this.hand = [...cards];
  }

  /**
   * Set the top card of the centerPile (visible to all players)
   */
  setCenterPileTopCard(card: Card | null): void {
    this.centerPileTopCard = card;
  }

  /**
   * Set the discarded cards (only known if this AI won the bid)
   */
  setDiscardedCards(cards: Card[]): void {
    this.discardedCards = [...cards];
  }

  /**
   * Update completed tricks
   */
  updateCompletedTricks(tricks: CompletedTrick[]): void {
    this.completedTricks = [...tricks];
  }

  /**
   * Set the trump suit (available after declaration)
   */
  setTrumpSuit(suit: Suit | null): void {
    this.trumpSuit = suit;
  }

  /**
   * Get the AI's position
   */
  getPosition(): PlayerPosition {
    return this.position;
  }

  /**
   * Get the AI's current hand
   */
  getHand(): Card[] {
    return [...this.hand];
  }

  /**
   * Decide on a bid based on hand strength
   */
  placeBid(currentBid: number | null, biddingHistory: Array<{ player: PlayerPosition; bid: number | 'pass' | 'check' }>): number | 'pass' | 'check' {
    let bid : number | 'pass' | 'check' = 'pass' ;

    const maxBid = this.findMaxBid();
    if (maxBid < 60) {
      if (currentBid === null) {
        bid = 60 ;
      }
      else if (typeof currentBid === 'number' && currentBid < 80) {
        bid = 80 ;
      }
      else {
        bid = 'pass' ;
      }
    }
    else {
      if (currentBid === null) {
        bid = maxBid ;
      }
      else {
        console.log('currentBid', currentBid, 'maxBid', maxBid, biddingHistory);
        if (typeof currentBid === 'number' && currentBid + 5 <= maxBid) {
          bid = currentBid + 5 ;
        }
      }
    }

    return bid;
  }

  /**
   * Select which 9 cards to keep from 15 (9 in hand + 6 in centerPile)
   */
  selectCards(centerPileCards: Card[]): string[] {
    // Combine hand with centerPile
    const allCards = [...this.hand, ...centerPileCards];
    
    // Sort by value (keep high value cards)
    const sorted = allCards.sort((a, b) => {
      // Prioritize special cards
      if (a.color === 'bird') return -1;
      if (b.color === 'bird') return 1;
      if (a.color === 'red' && a.value === 1) return -1;
      if (b.color === 'red' && b.value === 1) return 1;
      
      // Then by value
      return b.value - a.value;
    });

    // Keep best 9 cards
    return sorted.slice(0, 9).map(c => c.id);
  }

  /**
   * Declare trump based on hand composition
   */
  declareTrump(): Suit {
    // Count cards of each suit
    const suitCounts: Record<Suit, number> = {
      red: 0,
      black: 0,
      green: 0,
      yellow: 0,
    };

    for (const card of this.hand) {
      if (card.color !== 'bird') {
        suitCounts[card.color as Suit]++;
      }
    }

    // Choose suit with most cards
    let maxSuit: Suit = 'red';
    let maxCount = suitCounts.red;

    for (const suit of ['black', 'green', 'yellow'] as Suit[]) {
      if (suitCounts[suit] > maxCount) {
        maxCount = suitCounts[suit];
        maxSuit = suit;
      }
    }

    return maxSuit;
  }

  /**
   * Play a card from hand given current trick state
   */
  playCard(currentTrick: CurrentTrick, positionInOrder: number): string {
    const playableCards = this.getPlayableCards(currentTrick);
    
    if (playableCards.length === 0) {
      // Should never happen, but fallback to first card
      return this.hand[0]?.id || '';
    }

    // Simple strategy: 
    // - If leading, play highest card
    // - If following, play lowest valid card
    if (positionInOrder === 0) {
      // Leading - play highest card
      const sorted = playableCards.sort((a, b) => b.value - a.value);
      return sorted[0].id;
    } else {
      // Following - play lowest valid card
      const sorted = playableCards.sort((a, b) => a.value - b.value);
      return sorted[0].id;
    }
  }

  private longestSuitInHand(cards: Card[]): Card[] {
    const suitMap: Record<Suit, Card[]> = {
      red: [],
      black: [],
      green: [],
      yellow: [],
    };
    for (const card of cards) {
      if (card.color === 'bird') {
        continue;
      }

      if (card.color === 'red' && card.value === 1) {
        continue;
      }

      if (card.color in suitMap) {
        suitMap[card.color as Suit].push(card);
      }
    }
    let longestSuit: Suit = 'red';
    for (const suit of Object.keys(suitMap) as Suit[]) {
      if (suitMap[suit].length > suitMap[longestSuit].length) {
        longestSuit = suit;
      }
    }
    return suitMap[longestSuit];
  }

  /**
   * Evaluate hand strength for bidding
   */
  private findMaxBid(): number {
    let maxbid = 150 ;
    let c: Card ;

    let cards = [...this.hand, this.centerPileTopCard] ;
    c = cards.find(c => c?.color === 'red' && c?.value === 1) ;
    if (c === undefined) {
      maxbid -= 40 ;
    }

    c = cards.find(c => c?.color === 'bird') ;
    if (c === undefined) {
      maxbid -= 30 ;
    }

    let suit = this.longestSuitInHand(cards as Card[]) ;
    maxbid -= (9 - suit.length) * 10 ;

    console.log('AIPlayer.findMaxBid', cards, '=>', maxbid) ;

    return maxbid ;
  }

  /**
   * Get valid cards that can be played
   */
  private getPlayableCards(currentTrick: CurrentTrick): Card[] {
    // If leading, can play any card
    if (currentTrick.cards.length === 0) {
      return [...this.hand];
    }

    const leadCard = currentTrick.cards[0].card;
    const leadSuit = currentTrick.leadSuit;
    
    // Special case: If red 1 or bird is led, must follow with trump suit if you have it
    if (((leadCard.color === 'red' && leadCard.value === 1) || leadCard.color === 'bird') && this.trumpSuit) {
      const trumpCards = this.hand.filter(c => 
        c.color === this.trumpSuit || 
        c.color === 'bird' || 
        (c.color === 'red' && c.value === 1)
      );
      if (trumpCards.length > 0) {
        return trumpCards;
      }
    }
    
    // Must follow suit if possible
    if (leadSuit) {
      const cardsOfLeadSuit = this.hand.filter(c => c.color === leadSuit);
      if (cardsOfLeadSuit.length > 0) {
        return cardsOfLeadSuit;
      }
    }

    // Can't follow suit, can play any card
    return [...this.hand];
  }

  /**
   * Get knowledge state for debugging
   */
  getKnowledge(): {
    position: PlayerPosition;
    handSize: number;
    centerPileTopCard: Card | null;
    discardedCardsCount: number;
    completedTricksCount: number;
    trumpSuit: Suit | null;
  } {
    return {
      position: this.position,
      handSize: this.hand.length,
      centerPileTopCard: this.centerPileTopCard,
      discardedCardsCount: this.discardedCards.length,
      completedTricksCount: this.completedTricks.length,
      trumpSuit: this.trumpSuit,
    };
  }
}
