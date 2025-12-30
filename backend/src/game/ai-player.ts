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
  private kittyTopCard: Card | null;
  private discardedCards: Card[];
  private completedTricks: CompletedTrick[];
  private trumpSuit: Suit | null;

  constructor(position: PlayerPosition) {
    this.position = position;
    this.hand = [];
    this.kittyTopCard = null;
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
   * Set the top card of the kitty (visible to all players)
   */
  setKittyTopCard(card: Card | null): void {
    this.kittyTopCard = card;
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
    // Count high value cards and trump potential
    const handStrength = this.evaluateHandStrength();
    
    // Simple strategy for now
    if (currentBid === null) {
      // First bid - can check or bid
      if (handStrength >= 60) {
        return 60;
      }
      return 'check';
    }

    // Someone has bid
    if (handStrength >= currentBid + 10) {
      return currentBid + 5;
    }

    return 'pass';
  }

  /**
   * Select which 9 cards to keep from 15 (9 in hand + 6 in kitty)
   */
  selectCards(kittyCards: Card[]): string[] {
    // Combine hand with kitty
    const allCards = [...this.hand, ...kittyCards];
    
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

  /**
   * Evaluate hand strength for bidding
   */
  private evaluateHandStrength(): number {
    let strength = 0;

    for (const card of this.hand) {
      // Point cards
      if (card.value === 5) strength += 5;
      else if (card.value === 10) strength += 10;
      else if (card.value === 14) strength += 10;
      else if (card.color === 'bird') strength += 20;
      else if (card.color === 'red' && card.value === 1) strength += 30;
      
      // High cards add to strength
      if (card.value >= 12) strength += 5;
    }

    // Consider kitty top card
    if (this.kittyTopCard) {
      if (this.kittyTopCard.value === 5) strength += 2;
      else if (this.kittyTopCard.value === 10) strength += 5;
      else if (this.kittyTopCard.value === 14) strength += 5;
      else if (this.kittyTopCard.color === 'bird') strength += 10;
      else if (this.kittyTopCard.color === 'red' && this.kittyTopCard.value === 1) strength += 15;
    }

    return strength;
  }

  /**
   * Get valid cards that can be played
   */
  private getPlayableCards(currentTrick: CurrentTrick): Card[] {
    // If leading, can play any card
    if (currentTrick.cards.length === 0) {
      return [...this.hand];
    }

    const leadSuit = currentTrick.leadSuit;
    
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
    kittyTopCard: Card | null;
    discardedCardsCount: number;
    completedTricksCount: number;
    trumpSuit: Suit | null;
  } {
    return {
      position: this.position,
      handSize: this.hand.length,
      kittyTopCard: this.kittyTopCard,
      discardedCardsCount: this.discardedCards.length,
      completedTricksCount: this.completedTricks.length,
      trumpSuit: this.trumpSuit,
    };
  }
}
