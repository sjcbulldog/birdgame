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
  private selectedTrumpSuit: Suit | null;
  private highBidder: PlayerPosition | null;
  private bidderRevealedSuits: Set<Suit>; // Track non-trump suits the bidder has played

  constructor(position: PlayerPosition) {
    this.position = position;
    this.hand = [];
    this.centerPileTopCard = null;
    this.discardedCards = [];
    this.completedTricks = [];
    this.trumpSuit = null;
    this.selectedTrumpSuit = null;
    this.highBidder = null;
    this.bidderRevealedSuits = new Set();
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
    // Track non-trump suits the bidder has played
    if (this.highBidder && this.trumpSuit) {
      for (const trick of tricks) {
        for (const cardPlay of trick.cards) {
          if (cardPlay.player === this.highBidder) {
            const card = cardPlay.card;
            // Track if bidder played a non-trump card
            if (!this.isTrumpCard(card) && card.color !== 'bird') {
              this.bidderRevealedSuits.add(card.color as Suit);
            }
          }
        }
      }
    }
  }

  /**
   * Set the trump suit (available after declaration)
   */
  setTrumpSuit(suit: Suit | null): void {
    this.trumpSuit = suit;
  }

  /**
   * Set the high bidder (player who won the bid)
   */
  setHighBidder(bidder: PlayerPosition | null): void {
    this.highBidder = bidder;
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
    if (maxBid < 70) {
      if (currentBid === null) {
        bid = 70 ;
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
        if (typeof currentBid === 'number' && currentBid + 5 <= maxBid) {
          bid = currentBid + 5 ;
        }
      }
    }

    return bid;
  }

  /**
   * Select which 9 cards to keep from 15 (9 in hand + 6 in centerPile)
   * Strategy:
   * 1. Keep ALL trump cards (including bird/red-1 if trump-colored)
   * 2. Keep ALL 14s (unbeatable when trumps exhausted)
   * 3. Keep maximum contiguous runs from 14 down in off-suits
   * 4. Aggressively void weak suits (1-3 cards if trump 6+, else 1-2 cards)
   * 5. Prefer non-point cards over point cards to stash points in discards for last trick
   */
  selectCards(centerPileCards: Card[]): string[] {
    const allCards = [...this.hand, ...centerPileCards];
    
    // Phase 1: Determine best trump suit
    const trumpPotentials = this.evaluateTrumpPotential(allCards);
    const bestTrumpSuit = trumpPotentials[0].suit;
    this.selectedTrumpSuit = bestTrumpSuit;
    
    const cardsToKeep: Card[] = [];
    const cardsRemaining: Card[] = [...allCards];
    
    // Phase 2: Keep ALL trump cards (including bird and red-1 if in trump color)
    const trumpCards = cardsRemaining.filter(card => 
      card.color === bestTrumpSuit || 
      card.color === 'bird' || 
      (card.color === 'red' && card.value === 1)
    );
    cardsToKeep.push(...trumpCards);
    trumpCards.forEach(card => {
      const idx = cardsRemaining.findIndex(c => c.id === card.id);
      if (idx >= 0) cardsRemaining.splice(idx, 1);
    });
    
    // Phase 3: Keep ALL 14s regardless of suit
    const fourteens = cardsRemaining.filter(card => card.value === 14);
    cardsToKeep.push(...fourteens);
    fourteens.forEach(card => {
      const idx = cardsRemaining.findIndex(c => c.id === card.id);
      if (idx >= 0) cardsRemaining.splice(idx, 1);
    });
    
    // Phase 4: Keep contiguous runs from 14 down in off-suits
    const offSuits = (['red', 'black', 'green', 'yellow'] as Suit[])
      .filter(suit => suit !== bestTrumpSuit);
    
    for (const suit of offSuits) {
      const run = this.findContiguousRunFromFourteen(cardsRemaining, suit);
      if (run.length > 0) {
        // Only keep runs if we have space, but prioritize longer runs
        const spaceLeft = 9 - cardsToKeep.length;
        const runToKeep = run.slice(0, Math.min(run.length, spaceLeft));
        cardsToKeep.push(...runToKeep);
        runToKeep.forEach(card => {
          const idx = cardsRemaining.findIndex(c => c.id === card.id);
          if (idx >= 0) cardsRemaining.splice(idx, 1);
        });
      }
    }
    
    // Phase 5: Fill remaining slots, voiding weak suits and preferring non-point cards
    const trumpCount = trumpCards.length;
    const voidThreshold = trumpCount >= 6 ? 3 : 2; // Void 1-3 cards if trump 6+, else 1-2
    
    // Analyze remaining cards by suit
    const suitGroups: Record<string, Card[]> = {};
    for (const card of cardsRemaining) {
      const suit = card.color;
      if (!suitGroups[suit]) suitGroups[suit] = [];
      suitGroups[suit].push(card);
    }
    
    // Separate cards into void candidates and keepers
    const voidCandidates: Card[] = [];
    const keeperCandidates: Card[] = [];
    
    for (const suit in suitGroups) {
      const suitCards = suitGroups[suit];
      if (suitCards.length <= voidThreshold) {
        // Void this weak suit - prefer discarding point cards
        voidCandidates.push(...suitCards.sort((a, b) => {
          const aPoints = this.isPointCard(a);
          const bPoints = this.isPointCard(b);
          if (aPoints && !bPoints) return -1; // Discard point cards first
          if (!aPoints && bPoints) return 1;
          return b.value - a.value; // Then by value
        }));
      } else {
        keeperCandidates.push(...suitCards);
      }
    }
    
    // Fill remaining slots with keeper candidates, preferring non-point cards
    const spaceLeft = 9 - cardsToKeep.length;
    if (spaceLeft > 0 && keeperCandidates.length > 0) {
      // Sort: non-point cards first, then by value
      keeperCandidates.sort((a, b) => {
        const aPoints = this.isPointCard(a);
        const bPoints = this.isPointCard(b);
        if (!aPoints && bPoints) return -1; // Keep non-point cards
        if (aPoints && !bPoints) return 1;
        return b.value - a.value; // Then by value
      });
      
      cardsToKeep.push(...keeperCandidates.slice(0, spaceLeft));
    }
    
    // If still need more cards, take from void candidates (shouldn't happen often)
    const finalSpaceLeft = 9 - cardsToKeep.length;
    if (finalSpaceLeft > 0 && voidCandidates.length > 0) {
      // Prefer keeping non-point cards even from void candidates
      voidCandidates.sort((a, b) => {
        const aPoints = this.isPointCard(a);
        const bPoints = this.isPointCard(b);
        if (!aPoints && bPoints) return -1;
        if (aPoints && !bPoints) return 1;
        return b.value - a.value;
      });
      cardsToKeep.push(...voidCandidates.slice(0, finalSpaceLeft));
    }
    
    return cardsToKeep.slice(0, 9).map(c => c.id);
  }

  /**
   * Declare trump based on hand composition
   * Uses the suit selected during card selection for consistency
   */
  declareTrump(): Suit {
    // If we already determined trump during card selection, use that
    if (this.selectedTrumpSuit) {
      return this.selectedTrumpSuit;
    }
    
    // Fallback: Count cards of each suit (treating bird and red-1 as trump candidates)
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
    
    // Add bird to all suits for consideration
    const hasBird = this.hand.some(c => c.color === 'bird');
    const hasRedOne = this.hand.some(c => c.color === 'red' && c.value === 1);
    if (hasBird || hasRedOne) {
      for (const suit in suitCounts) {
        suitCounts[suit as Suit]++;
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
   * Strategy varies based on role: bidder, partner of bidder, or opponent
   */
  playCard(currentTrick: CurrentTrick, positionInOrder: number): string {
    const playableCards = this.getPlayableCards(currentTrick);
    
    if (playableCards.length === 0) {
      return this.hand[0]?.id || '';
    }

    if (!this.highBidder || !this.trumpSuit) {
      // Fallback to simple strategy if context missing
      return this.playSimple(playableCards, positionInOrder);
    }

    // Determine my role
    const isBidder = this.position === this.highBidder;
    const isPartner = this.getPartner(this.position) === this.highBidder;
    const isOpponent = !isBidder && !isPartner;

    if (isBidder) {
      return this.playAsBidder(playableCards, currentTrick, positionInOrder);
    } else if (isPartner) {
      return this.playAsPartner(playableCards, currentTrick, positionInOrder);
    } else {
      return this.playAsOpponent(playableCards, currentTrick, positionInOrder);
    }
  }

  /**
   * Simple fallback strategy
   */
  private playSimple(playableCards: Card[], positionInOrder: number): string {
    if (positionInOrder === 0) {
      const sorted = playableCards.sort((a, b) => b.value - a.value);
      return sorted[0].id;
    } else {
      const sorted = playableCards.sort((a, b) => a.value - b.value);
      return sorted[0].id;
    }
  }

  /**
   * Strategy for the bidder (won the bid)
   * 1. Exhaust trumps from other players while minimizing point loss
   * 2. Play non-trump cards after exhausting trumps
   * 3. Regain control with trumps if opponents win a trick
   * 4. Save a trump for the last trick (unless no points in discard)
   */
  private playAsBidder(playableCards: Card[], currentTrick: CurrentTrick, positionInOrder: number): string {
    const tricksPlayed = this.completedTricks.length;
    const isLastTrick = tricksPlayed === 8;
    const hasDiscardPoints = this.hasPointsInDiscards();
    
    if (positionInOrder === 0) {
      // I'm leading
      const trumps = this.getTrumpCards(playableCards);
      const nonTrumps = playableCards.filter(c => !this.isTrumpCard(c));
      
      // Count total trumps in hand
      const totalTrumpsInHand = this.getTrumpCards(this.hand).length;
      const hasRedOne = this.hand.some(c => c.color === 'red' && c.value === 1);
      const hasBird = this.hand.some(c => c.color === 'bird');
      const has14Trump = this.hand.some(c => c.value === 14 && this.isTrumpCard(c));
      
      // Strong trump strategy: if red-1, bird, and 14, lead them in order to pull trumps
      if (hasRedOne && hasBird && has14Trump && trumps.length > 0) {
        // First, lead red 1 (highest trump)
        const redOne = trumps.find(c => c.color === 'red' && c.value === 1);
        if (redOne) {
          return redOne.id;
        }
        
        // Second, lead bird
        const bird = trumps.find(c => c.color === 'bird');
        if (bird) {
          return bird.id;
        }
        
        // Third, lead 14 of trump suit
        const trump14 = trumps.find(c => c.value === 14);
        if (trump14) {
          return trump14.id;
        }
        
        // After leading red-1, bird, and 14, continue with any other trumps
        // Lead highest non-point trump to pull remaining trumps
        const nonPointTrumps = trumps.filter(c => !this.isPointCard(c));
        if (nonPointTrumps.length > 0) {
          nonPointTrumps.sort((a, b) => this.trumpValue(b) - this.trumpValue(a));
          return nonPointTrumps[0].id;
        }
        
        // All remaining trumps are point cards, lead highest
        trumps.sort((a, b) => this.trumpValue(b) - this.trumpValue(a));
        return trumps[0].id;
      }
      
      // Early game: exhaust trumps with standard strategy
      if (tricksPlayed < 5 && trumps.length > 0) {
        // If we still have non-point trumps, continue leading them to exhaust opponents
        const nonPointTrumps = trumps.filter(c => !this.isPointCard(c));
        if (nonPointTrumps.length > 0) {
          // Lead lowest non-point trump to minimize loss
          nonPointTrumps.sort((a, b) => this.trumpValue(a) - this.trumpValue(b));
          return nonPointTrumps[0].id;
        }
        // All trumps are point cards, lead lowest
        trumps.sort((a, b) => this.trumpValue(a) - this.trumpValue(b));
        return trumps[0].id;
      }
      
      // Mid-late game: play non-trumps if we have them
      if (nonTrumps.length > 0) {
        // Play highest non-trump to win when trumps are exhausted
        nonTrumps.sort((a, b) => b.value - a.value);
        return nonTrumps[0].id;
      }
      
      // Only trumps left, play them
      if (isLastTrick || !hasDiscardPoints) {
        // Last trick or no discard points, play any trump
        trumps.sort((a, b) => this.trumpValue(b) - this.trumpValue(a));
        return trumps[0].id;
      }
      
      // Save trump for last trick, play lowest
      trumps.sort((a, b) => this.trumpValue(a) - this.trumpValue(b));
      return trumps[0].id;
    } else {
      // I'm following
      const trickWinner = this.getCurrentTrickWinner(currentTrick);
      const myTeamWinning = this.isMyTeam(trickWinner);
      
      if (myTeamWinning) {
        // My team is winning, dump 5/10 point cards to maximize points
        const fiveAndTenCards = playableCards.filter(c => c.value === 5 || c.value === 10);
        if (fiveAndTenCards.length > 0) {
          // Play highest value (10 over 5)
          fiveAndTenCards.sort((a, b) => b.value - a.value);
          return fiveAndTenCards[0].id;
        }
        // No 5/10 cards, play lowest valid card
        playableCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
        return playableCards[0].id;
      } else {
        // Opponents winning, try to take it back
        const winningCards = playableCards.filter(c => this.canBeatTrick(c, currentTrick));
        if (winningCards.length > 0) {
          // Take trick with lowest winning card
          winningCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
          return winningCards[0].id;
        }
        // Can't win, avoid points and play lowest non-point card
        const nonPointCards = playableCards.filter(c => !this.isPointCard(c));
        if (nonPointCards.length > 0) {
          nonPointCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
          return nonPointCards[0].id;
        }
        // Only point cards available, play lowest
        playableCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
        return playableCards[0].id;
      }
    }
  }

  /**
   * Strategy for partner of bidder
   * 1. Signal red-1 or bird early if I have it
   * 2. When partner exhausting trumps, play trumps lowest to highest
   * 3. When partner plays non-trump high card, play points
   * 4. Otherwise avoid points
   */
  private playAsPartner(playableCards: Card[], currentTrick: CurrentTrick, positionInOrder: number): string {
    const tricksPlayed = this.completedTricks.length;
    
    // Early signaling: if I have red-1 or bird, try to show it
    if (tricksPlayed < 2) {
      const redOne = playableCards.find(c => c.color === 'red' && c.value === 1);
      const bird = playableCards.find(c => c.color === 'bird');
      
      if (positionInOrder === 0) {
        // Leading, play red-1 or bird to signal
        if (redOne) return redOne.id;
        if (bird) return bird.id;
      } else {
        // Following, play red-1 or bird if I can
        const leadCard = currentTrick.cards[0].card;
        if (redOne && (leadCard.color === 'red' || leadCard.color === 'bird' || this.isTrumpCard(leadCard))) {
          return redOne.id;
        }
        if (bird && (leadCard.color === 'bird' || this.isTrumpCard(leadCard))) {
          return bird.id;
        }
      }
    }
    
    if (positionInOrder === 0) {
      // I'm leading - play highest non-trump card
      const nonTrumpCards = playableCards.filter(c => !this.isTrumpCard(c));
      if (nonTrumpCards.length > 0) {
        nonTrumpCards.sort((a, b) => this.cardValue(b) - this.cardValue(a));
        return nonTrumpCards[0].id;
      }
      // Only trump cards available, play lowest trump
      playableCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
      return playableCards[0].id;
    } else {
      // I'm following
      const partnerPlayed = this.hasPartnerPlayed(currentTrick);
      
      if (partnerPlayed) {
        const partnerCard = this.getPartnerCard(currentTrick);
        const leadCard = currentTrick.cards[0].card;
        const partnerLed = currentTrick.cards[0].player === this.getPartner(this.position);
        
        // If partner led trump, play trumps lowest to highest
        if (partnerLed && this.isTrumpCard(partnerCard)) {
          const trumps = this.getTrumpCards(playableCards);
          if (trumps.length > 0) {
            trumps.sort((a, b) => this.trumpValue(a) - this.trumpValue(b));
            return trumps[0].id;
          }
        }
        
        // If partner played non-trump and it's likely high card in suit
        if (!this.isTrumpCard(partnerCard) && partnerCard.color !== 'bird') {
          const isHighCard = this.isLikelyHighCard(partnerCard, currentTrick);
          if (isHighCard) {
            // Play point cards
            const pointCards = playableCards.filter(c => this.isPointCard(c));
            if (pointCards.length > 0) {
              pointCards.sort((a, b) => this.cardValue(b) - this.cardValue(a));
              return pointCards[0].id;
            }
          }
        }
        
        // If partner is winning, check if we should play 5/10 point cards or secure the trick
        const currentWinner = this.getCurrentTrickWinner(currentTrick);
        if (currentWinner === this.getPartner(this.position)) {
          const winningCard = currentTrick.cards.find(c => c.player === currentWinner)!.card;
          const leadSuit = currentTrick.leadSuit;
          
          // Check if we can play 5/10 point cards
          const fiveAndTenCards = playableCards.filter(c => c.value === 5 || c.value === 10);
          if (fiveAndTenCards.length > 0) {
            // Play highest value (10 over 5)
            fiveAndTenCards.sort((a, b) => b.value - a.value);
            return fiveAndTenCards[0].id;
          }
          
          // Only apply securing strategy for non-trump tricks if no 5/10 cards available
          if (leadSuit && leadSuit !== this.trumpSuit && !this.isTrumpCard(winningCard)) {
            // Check if we have cards that can beat the current winning card
            const higherCards = playableCards.filter(c => {
              // Must be same suit and higher value (or trump)
              if (this.isTrumpCard(c)) return true;
              if (c.color === leadSuit && c.value > winningCard.value) return true;
              return false;
            });
            
            if (higherCards.length > 0) {
              // Play the lowest card that's still higher to secure the trick
              higherCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
              return higherCards[0].id;
            }
          }
        }
      }
      
      // Check if opponents are winning and we can't beat them
      const currentWinnerFinal = this.getCurrentTrickWinner(currentTrick);
      const myTeamWinning = this.isMyTeam(currentWinnerFinal);
      
      if (!myTeamWinning) {
        // Opponents winning, check if we can beat them
        const canBeat = playableCards.some(c => this.canBeatTrick(c, currentTrick));
        if (!canBeat) {
          // Can't win, avoid points at all costs
          const nonPointCards = playableCards.filter(c => !this.isPointCard(c));
          if (nonPointCards.length > 0) {
            nonPointCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
            return nonPointCards[0].id;
          }
          // Only point cards available, play lowest
          playableCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
          return playableCards[0].id;
        }
      }
      
      // Default: avoid points, play lowest
      const nonPointCards = playableCards.filter(c => !this.isPointCard(c));
      if (nonPointCards.length > 0) {
        nonPointCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
        return nonPointCards[0].id;
      }
      
      playableCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
      return playableCards[0].id;
    }
  }

  /**
   * Strategy for opponents of bidding team
   * 1. Look for opportunities to take tricks
   * 2. Provide points if partner hasn't played and cards aren't high
   */
  private playAsOpponent(playableCards: Card[], currentTrick: CurrentTrick, positionInOrder: number): string {
    if (positionInOrder === 0) {
      // I'm leading, avoid leading trump suit
      const nonTrumpCards = playableCards.filter(c => !this.isTrumpCard(c));
      if (nonTrumpCards.length > 0) {
        // Play highest non-trump card
        nonTrumpCards.sort((a, b) => b.value - a.value);
        return nonTrumpCards[0].id;
      }
      // Only trump cards available, play lowest trump
      playableCards.sort((a, b) => this.trumpValue(a) - this.trumpValue(b));
      return playableCards[0].id;
    } else {
      // I'm following
      const partnerHasPlayed = this.hasPartnerPlayed(currentTrick);
      const currentWinner = this.getCurrentTrickWinner(currentTrick);
      const myTeamWinning = this.isMyTeam(currentWinner);
      
      if (!partnerHasPlayed) {
        // Partner hasn't played yet
        const canWin = playableCards.some(c => this.canBeatTrick(c, currentTrick));
        
        if (canWin) {
          // I can take the trick
          const winningCards = playableCards.filter(c => this.canBeatTrick(c, currentTrick));
          winningCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
          return winningCards[0].id;
        } else {
          // Can't win, check for special case: bidder pulling trumps in early rounds
          const tricksPlayed = this.completedTricks.length;
          const leadCard = currentTrick.cards[0].card;
          const leadPlayer = currentTrick.cards[0].player;
          const iAmOutOfTrump = !this.hand.some(c => this.isTrumpCard(c));
          
          // If first 3 rounds, bidder led trump, I'm out of trump, and it's not highest trump
          if (tricksPlayed < 3 && 
              leadPlayer === this.highBidder && 
              this.isTrumpCard(leadCard) &&
              iAmOutOfTrump &&
              !this.isHighestOutstandingTrump(leadCard, currentTrick)) {
            // Feed points hoping partner has higher trump to capture them
            const pointCards = playableCards.filter(c => 
              c.value === 10 || c.value === 5
            );
            if (pointCards.length > 0) {
              // Play highest point card (10 over 5)
              pointCards.sort((a, b) => b.value - a.value);
              return pointCards[0].id;
            }
          }
          
          // Check if cards played are likely not high cards
          const cardsNotHigh = !this.isLikelyHighCard(leadCard, currentTrick);
          
          // Check if bidding team is currently winning (opponents to us)
          const currentWinner = this.getCurrentTrickWinner(currentTrick);
          const biddingTeamWinning = currentWinner === this.highBidder || currentWinner === this.getPartner(this.highBidder!);
          
          if (cardsNotHigh && !biddingTeamWinning) {
            // Provide points for partner to collect only if bidding team isn't winning
            const pointCards = playableCards.filter(c => this.isPointCard(c));
            if (pointCards.length > 0) {
              pointCards.sort((a, b) => this.cardValue(b) - this.cardValue(a));
              return pointCards[0].id;
            }
          }
          
          // Check if we cannot follow suit and should apply smart discard logic
          const leadSuit = currentTrick.leadSuit;
          const canFollowSuit = leadSuit ? playableCards.some(c => 
            (leadSuit === this.trumpSuit && this.isTrumpCard(c)) ||
            (c.color === leadSuit && !(c.color === 'red' && c.value === 1))
          ) : true;
          
          if (!canFollowSuit) {
            // Cannot follow suit - apply smart discard logic
            const discardChoice = this.selectSmartDiscard(playableCards);
            if (discardChoice) {
              return discardChoice;
            }
          }
          
          // Default: avoid points, play lowest non-point card
          const nonPointCards = playableCards.filter(c => !this.isPointCard(c));
          if (nonPointCards.length > 0) {
            nonPointCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
            return nonPointCards[0].id;
          }
          // Only point cards available, play lowest
          playableCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
          return playableCards[0].id;
        }
      } else {
        // Partner has played
        if (myTeamWinning) {
          // Partner winning, dump 5/10 point cards to maximize points
          const fiveAndTenCards = playableCards.filter(c => c.value === 5 || c.value === 10);
          if (fiveAndTenCards.length > 0) {
            // Play highest value (10 over 5)
            fiveAndTenCards.sort((a, b) => b.value - a.value);
            return fiveAndTenCards[0].id;
          }
          // No 5/10 cards, throw lowest non-point card
          const nonPointCards = playableCards.filter(c => !this.isPointCard(c));
          if (nonPointCards.length > 0) {
            nonPointCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
            return nonPointCards[0].id;
          }
          playableCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
          return playableCards[0].id;
        } else {
          // Opponents winning, try to take it
          const winningCards = playableCards.filter(c => this.canBeatTrick(c, currentTrick));
          if (winningCards.length > 0) {
            winningCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
            return winningCards[0].id;
          }
          // Can't win, avoid points and play lowest non-point card
          const nonPointCards = playableCards.filter(c => !this.isPointCard(c));
          if (nonPointCards.length > 0) {
            nonPointCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
            return nonPointCards[0].id;
          }
          // Only point cards available, play lowest
          playableCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
          return playableCards[0].id;
        }
      }
    }
  }

  /**
   * Get partner position
   */
  private getPartner(position: PlayerPosition): PlayerPosition {
    const partnerships: Record<PlayerPosition, PlayerPosition> = {
      north: 'south',
      south: 'north',
      east: 'west',
      west: 'east',
    };
    return partnerships[position];
  }

  /**
   * Check if position is on my team
   */
  private isMyTeam(position: PlayerPosition): boolean {
    return position === this.position || position === this.getPartner(this.position);
  }

  /**
   * Check if partner has played in current trick
   */
  private hasPartnerPlayed(trick: CurrentTrick): boolean {
    const partner = this.getPartner(this.position);
    return trick.cards.some(c => c.player === partner);
  }

  /**
   * Get partner's card from current trick
   */
  private getPartnerCard(trick: CurrentTrick): Card {
    const partner = this.getPartner(this.position);
    return trick.cards.find(c => c.player === partner)!.card;
  }

  /**
   * Check if there are points in discarded cards
   */
  private hasPointsInDiscards(): boolean {
    return this.discardedCards.some(c => this.isPointCard(c));
  }

  /**
   * Get trump cards from a set of cards
   */
  private getTrumpCards(cards: Card[]): Card[] {
    return cards.filter(c => this.isTrumpCard(c));
  }

  /**
   * Check if a card is a trump card
   */
  private isTrumpCard(card: Card): boolean {
    if (!this.trumpSuit) return false;
    return card.color === this.trumpSuit || 
           card.color === 'bird' || 
           (card.color === 'red' && card.value === 1);
  }

  /**
   * Get trump value for comparison (red-1 > bird > regular trumps by value)
   */
  private trumpValue(card: Card): number {
    if (card.color === 'red' && card.value === 1) return 100;
    if (card.color === 'bird') return 90;
    return card.value;
  }

  /**
   * Get general card value for comparison
   */
  private cardValue(card: Card): number {
    if (this.isTrumpCard(card)) {
      return 1000 + this.trumpValue(card);
    }
    return card.value;
  }

  /**
   * Determine current trick winner
   */
  private getCurrentTrickWinner(trick: CurrentTrick): PlayerPosition {
    if (trick.cards.length === 0) return trick.leadPlayer!;
    
    let winningCard = trick.cards[0];
    
    for (let i = 1; i < trick.cards.length; i++) {
      const currentCard = trick.cards[i];
      if (this.cardBeats(currentCard.card, winningCard.card, trick.leadSuit)) {
        winningCard = currentCard;
      }
    }
    
    return winningCard.player;
  }

  /**
   * Check if cardA beats cardB
   */
  private cardBeats(cardA: Card, cardB: Card, leadSuit: Suit | null): boolean {
    const aIsTrump = this.isTrumpCard(cardA);
    const bIsTrump = this.isTrumpCard(cardB);
    
    // Both trump: compare trump values
    if (aIsTrump && bIsTrump) {
      return this.trumpValue(cardA) > this.trumpValue(cardB);
    }
    
    // Only A is trump: A wins
    if (aIsTrump) return true;
    
    // Only B is trump: B wins
    if (bIsTrump) return false;
    
    // Neither trump: must follow lead suit
    if (leadSuit && cardA.color === leadSuit && cardB.color === leadSuit) {
      return cardA.value > cardB.value;
    }
    
    // A follows lead, B doesn't: A wins
    if (leadSuit && cardA.color === leadSuit) return true;
    
    // B follows lead, A doesn't: B wins
    if (leadSuit && cardB.color === leadSuit) return false;
    
    // Neither follows lead: first card wins (B wins)
    return false;
  }

  /**
   * Check if a card can beat the current trick
   */
  private canBeatTrick(card: Card, trick: CurrentTrick): boolean {
    if (trick.cards.length === 0) return true;
    
    const currentWinner = this.getCurrentTrickWinner(trick);
    const winningCard = trick.cards.find(c => c.player === currentWinner)!.card;
    
    return this.cardBeats(card, winningCard, trick.leadSuit);
  }

  /**
   * Check if a card is likely a high card in its suit
   * (14 is always high, 13 if 14 seen, etc.)
   */
  private isLikelyHighCard(card: Card, trick: CurrentTrick): boolean {
    if (card.color === 'bird') return true;
    if (card.color === 'red' && card.value === 1) return true;
    if (card.value === 14) return true;
    
    // Check if higher cards in this suit have been played
    const suit = card.color as Suit;
    const seenCards = [...this.completedTricks.flatMap(t => t.cards.map(c => c.card)), 
                       ...trick.cards.map(c => c.card)];
    
    // Check if all higher cards in suit have been seen
    for (let v = card.value + 1; v <= 14; v++) {
      const higherCardSeen = seenCards.some(c => c.color === suit && c.value === v);
      if (!higherCardSeen) return false; // Higher card still out there
    }
    
    return true; // All higher cards have been played
  }

  /**
   * Select a smart discard when opponent cannot follow suit
   * Strategy:
   * - If we have 12+ in a suit the bidder has revealed, keep it and discard another suit
   * - If we only have low cards in a revealed suit, discard from that suit to void it
   */
  private selectSmartDiscard(playableCards: Card[]): string | null {
    if (this.bidderRevealedSuits.size === 0) {
      return null; // No information about bidder's suits yet
    }

    // Categorize our hand by suit
    const cardsBySuit = new Map<Suit, Card[]>();
    for (const card of playableCards) {
      if (!this.isTrumpCard(card) && card.color !== 'bird') {
        const suit = card.color as Suit;
        if (!cardsBySuit.has(suit)) {
          cardsBySuit.set(suit, []);
        }
        cardsBySuit.get(suit)!.push(card);
      }
    }

    // Check suits the bidder has revealed
    const revealedSuitsInHand: Array<{ suit: Suit; cards: Card[]; maxValue: number }> = [];
    const otherSuitsInHand: Array<{ suit: Suit; cards: Card[] }> = [];

    for (const [suit, cards] of cardsBySuit.entries()) {
      const maxValue = Math.max(...cards.map(c => c.value));
      if (this.bidderRevealedSuits.has(suit)) {
        revealedSuitsInHand.push({ suit, cards, maxValue });
      } else {
        otherSuitsInHand.push({ suit, cards });
      }
    }

    // Strategy: Keep high cards (12+) in revealed suits, void weak revealed suits
    for (const revealed of revealedSuitsInHand) {
      if (revealed.maxValue >= 12) {
        // We have high card(s) in this revealed suit - keep them
        // Try to discard from other suits instead
        for (const other of otherSuitsInHand) {
          // Prefer voiding short suits (1-3 cards)
          if (other.cards.length <= 3) {
            // Discard lowest card from this suit
            const sortedCards = [...other.cards].sort((a, b) => this.cardValue(a) - this.cardValue(b));
            // Prefer non-point cards
            const nonPoint = sortedCards.find(c => !this.isPointCard(c));
            if (nonPoint) return nonPoint.id;
            return sortedCards[0].id;
          }
        }
        // If no short suits in other colors, discard from any other suit
        if (otherSuitsInHand.length > 0) {
          const otherCards = otherSuitsInHand.flatMap(s => s.cards);
          otherCards.sort((a, b) => this.cardValue(a) - this.cardValue(b));
          const nonPoint = otherCards.find(c => !this.isPointCard(c));
          if (nonPoint) return nonPoint.id;
          return otherCards[0].id;
        }
      } else {
        // We only have low cards in this revealed suit - void it
        // Discard lowest card from this suit
        const sortedCards = [...revealed.cards].sort((a, b) => this.cardValue(a) - this.cardValue(b));
        // Prefer non-point cards
        const nonPoint = sortedCards.find(c => !this.isPointCard(c));
        if (nonPoint) return nonPoint.id;
        return sortedCards[0].id;
      }
    }

    return null; // No smart discard decision, use default logic
  }

  /**
   * Check if a trump card is the highest outstanding trump
   * (considers red-1 > bird > regular trumps, and what's been played)
   */
  private isHighestOutstandingTrump(card: Card, trick: CurrentTrick): boolean {
    if (!this.isTrumpCard(card)) return false;
    
    const cardTrumpValue = this.trumpValue(card);
    
    // Get all cards that have been played
    const seenCards = [...this.completedTricks.flatMap(t => t.cards.map(c => c.card)), 
                       ...trick.cards.map(c => c.card)];
    
    // Check if any higher trump is still outstanding (not seen and not in my hand)
    const allTrumpCards = [
      { color: 'red' as const, value: 1 },  // red-1 (trump value 100)
      { color: 'bird' as const, value: 0 }, // bird (trump value 90)
      ...Array.from({ length: 10 }, (_, i) => ({ color: this.trumpSuit!, value: 14 - i })) // 14 down to 5
    ];
    
    for (const potentialTrump of allTrumpCards) {
      const potentialValue = potentialTrump.color === 'red' && potentialTrump.value === 1 ? 100 :
                             potentialTrump.color === 'bird' ? 90 :
                             potentialTrump.value;
      
      if (potentialValue > cardTrumpValue) {
        // This is a higher trump - check if it's outstanding
        const hasBeenSeen = seenCards.some(c => 
          (potentialTrump.color === 'bird' && c.color === 'bird') ||
          (potentialTrump.color === 'red' && c.color === 'red' && c.value === 1) ||
          (potentialTrump.color !== 'bird' && potentialTrump.color !== 'red' && 
           c.color === potentialTrump.color && c.value === potentialTrump.value)
        );
        
        const inMyHand = this.hand.some(c =>
          (potentialTrump.color === 'bird' && c.color === 'bird') ||
          (potentialTrump.color === 'red' && c.color === 'red' && c.value === 1) ||
          (potentialTrump.color !== 'bird' && potentialTrump.color !== 'red' && 
           c.color === potentialTrump.color && c.value === potentialTrump.value)
        );
        
        if (!hasBeenSeen && !inMyHand) {
          // Higher trump is still outstanding
          return false;
        }
      }
    }
    
    return true; // No higher trump is outstanding
  }

  /**
   * Evaluate trump potential for each suit
   * Returns suits ordered by strength (length + high cards + special cards)
   */
  private evaluateTrumpPotential(cards: Card[]): Array<{ suit: Suit; score: number }> {
    const suitScores: Record<Suit, number> = {
      red: 0,
      black: 0,
      green: 0,
      yellow: 0,
    };
    
    // Count cards and evaluate strength for each suit
    for (const card of cards) {
      if (card.color === 'bird' || (card.color === 'red' && card.value === 1)) {
        // Bird and red-1 add to ALL suits since they're trump regardless
        for (const suit in suitScores) {
          suitScores[suit as Suit] += 5; // Strong bonus for special cards
        }
      } else if (card.color in suitScores) {
        const suit = card.color as Suit;
        suitScores[suit] += 3; // Base points for having a card
        
        // Bonus for high cards
        if (card.value >= 12) {
          suitScores[suit] += 2;
        }
        if (card.value === 14) {
          suitScores[suit] += 1; // Extra for 14
        }
      }
    }
    
    // Convert to array and sort by score descending
    return Object.entries(suitScores)
      .map(([suit, score]) => ({ suit: suit as Suit, score }))
      .sort((a, b) => b.score - a.score);
  }
  
  /**
   * Find contiguous run from 14 downward in a specific suit
   * Returns cards in descending order (14, 13, 12, ...)
   */
  private findContiguousRunFromFourteen(cards: Card[], suit: Suit): Card[] {
    const suitCards = cards
      .filter(card => card.color === suit)
      .sort((a, b) => b.value - a.value);
    
    if (suitCards.length === 0 || suitCards[0].value !== 14) {
      return []; // No 14 in this suit, no run
    }
    
    const run: Card[] = [suitCards[0]]; // Start with 14
    let expectedValue = 13;
    
    for (let i = 1; i < suitCards.length; i++) {
      if (suitCards[i].value === expectedValue) {
        run.push(suitCards[i]);
        expectedValue--;
      } else {
        break; // Run is broken
      }
    }
    
    return run;
  }
  
  /**
   * Check if a card is worth points in scoring
   */
  private isPointCard(card: Card): boolean {
    if (card.color === 'bird') return true; // 20 points
    if (card.color === 'red' && card.value === 1) return true; // 30 points
    if (card.value === 5) return true; // 5 points
    if (card.value === 10) return true; // 10 points
    if (card.value === 14) return true; // 10 points
    return false;
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
    if (!this.centerPileTopCard) {
      throw new Error('centerPileTopCard should not be null during bidding phase');
    }
    
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

    // Now lets assume our partner can help allievate some of our weakness
    let c14s = cards.filter(c => c?.color != suit[0].color && c.value === 14) ;
    maxbid += c14s.length * 10 ;

    // Assume some help from our partner
    maxbid += 10 ;

    if (maxbid > 110) {
      maxbid = 110 ;
    }

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
      // If lead suit is the trump suit, bird and red-1 are also valid
      if (leadSuit === this.trumpSuit) {
        const trumpCards = this.hand.filter(c => 
          c.color === this.trumpSuit || 
          c.color === 'bird' || 
          (c.color === 'red' && c.value === 1)
        );
        if (trumpCards.length > 0) {
          return trumpCards;
        }
      } else {
        // Note: red 1 is always trump, never red (unless red is the trump suit)
        const cardsOfLeadSuit = this.hand.filter(c => c.color === leadSuit);
        if (cardsOfLeadSuit.length > 0) {
          return cardsOfLeadSuit;
        }
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
