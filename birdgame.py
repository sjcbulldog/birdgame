#!/usr/bin/env python3
"""
Bird Card Game - A simple matching card game with birds

This is a card game where players try to collect sets of matching bird cards.
Players take turns asking each other for specific bird cards. If the other player
has the requested card, they must give it. If not, the asking player draws a card.
When a player collects all 4 cards of the same bird type, they score a point.
"""

import random
from typing import List, Dict, Optional


class Card:
    """Represents a single bird card"""
    
    def __init__(self, bird_type: str, suit: str):
        self.bird_type = bird_type
        self.suit = suit
    
    def __repr__(self):
        return f"{self.bird_type} ({self.suit})"
    
    def __eq__(self, other):
        if not isinstance(other, Card):
            return False
        return self.bird_type == other.bird_type and self.suit == other.suit


class Deck:
    """Represents a deck of bird cards"""
    
    BIRD_TYPES = [
        "Robin", "Eagle", "Sparrow", "Owl", "Hawk",
        "Cardinal", "Bluejay", "Crow", "Parrot", "Finch"
    ]
    
    SUITS = ["Spring", "Summer", "Fall", "Winter"]
    
    def __init__(self):
        self.cards: List[Card] = []
        self._create_deck()
    
    def _create_deck(self):
        """Create a full deck of bird cards"""
        for bird in self.BIRD_TYPES:
            for suit in self.SUITS:
                self.cards.append(Card(bird, suit))
    
    def shuffle(self):
        """Shuffle the deck"""
        random.shuffle(self.cards)
    
    def draw(self) -> Optional[Card]:
        """Draw a card from the deck"""
        if self.cards:
            return self.cards.pop()
        return None
    
    def is_empty(self) -> bool:
        """Check if deck is empty"""
        return len(self.cards) == 0
    
    def cards_remaining(self) -> int:
        """Get number of cards remaining in deck"""
        return len(self.cards)


class Player:
    """Represents a player in the game"""
    
    def __init__(self, name: str):
        self.name = name
        self.hand: List[Card] = []
        self.sets: List[str] = []
    
    def add_card(self, card: Card):
        """Add a card to the player's hand"""
        self.hand.append(card)
    
    def remove_card(self, card: Card) -> bool:
        """Remove a specific card from hand"""
        if card in self.hand:
            self.hand.remove(card)
            return True
        return False
    
    def has_bird(self, bird_type: str) -> bool:
        """Check if player has any cards of a specific bird type"""
        return any(card.bird_type == bird_type for card in self.hand)
    
    def get_cards_of_type(self, bird_type: str) -> List[Card]:
        """Get all cards of a specific bird type"""
        return [card for card in self.hand if card.bird_type == bird_type]
    
    def remove_cards_of_type(self, bird_type: str) -> List[Card]:
        """Remove and return all cards of a specific bird type"""
        cards = self.get_cards_of_type(bird_type)
        for card in cards:
            self.hand.remove(card)
        return cards
    
    def check_for_sets(self) -> List[str]:
        """Check if player has complete sets (all 4 suits of a bird)"""
        new_sets = []
        bird_counts = {}
        
        for card in self.hand:
            bird_counts[card.bird_type] = bird_counts.get(card.bird_type, 0) + 1
        
        for bird_type, count in bird_counts.items():
            if count == 4 and bird_type not in self.sets:
                new_sets.append(bird_type)
                self.sets.append(bird_type)
                self.remove_cards_of_type(bird_type)
        
        return new_sets
    
    def get_available_birds(self) -> List[str]:
        """Get list of unique bird types in hand"""
        return list(set(card.bird_type for card in self.hand))
    
    def score(self) -> int:
        """Get player's current score"""
        return len(self.sets)


class BirdGame:
    """Main game class"""
    
    def __init__(self, player_names: List[str]):
        self.deck = Deck()
        self.deck.shuffle()
        self.players = [Player(name) for name in player_names]
        self.current_player_idx = 0
        self.game_over = False
        
        # Deal initial hands
        cards_per_player = 7 if len(self.players) == 2 else 5
        for _ in range(cards_per_player):
            for player in self.players:
                card = self.deck.draw()
                if card:
                    player.add_card(card)
        
        # Check for initial sets
        for player in self.players:
            player.check_for_sets()
    
    def get_current_player(self) -> Player:
        """Get the current player"""
        return self.players[self.current_player_idx]
    
    def next_turn(self):
        """Move to the next player's turn"""
        self.current_player_idx = (self.current_player_idx + 1) % len(self.players)
    
    def ask_for_cards(self, asker: Player, target: Player, bird_type: str) -> int:
        """
        Player asks another player for cards of a specific bird type
        Returns number of cards transferred (0 if none)
        """
        if not asker.has_bird(bird_type):
            return 0
        
        cards = target.remove_cards_of_type(bird_type)
        
        if cards:
            for card in cards:
                asker.add_card(card)
            return len(cards)
        
        return 0
    
    def draw_card(self, player: Player) -> Optional[Card]:
        """Player draws a card from the deck"""
        card = self.deck.draw()
        if card:
            player.add_card(card)
        return card
    
    def check_game_over(self) -> bool:
        """Check if the game is over"""
        # Game is over when deck is empty and at least one player has no cards
        if self.deck.is_empty():
            for player in self.players:
                if len(player.hand) == 0:
                    self.game_over = True
                    return True
        return False
    
    def get_winner(self) -> Optional[Player]:
        """Get the player with the highest score"""
        if not self.game_over:
            return None
        
        max_score = max(player.score() for player in self.players)
        winners = [p for p in self.players if p.score() == max_score]
        
        return winners[0] if len(winners) == 1 else None
    
    def display_game_state(self):
        """Display the current game state"""
        print("\n" + "="*60)
        print("GAME STATE")
        print("="*60)
        print(f"Cards remaining in deck: {self.deck.cards_remaining()}")
        print("\nPlayers:")
        for player in self.players:
            print(f"  {player.name}: {len(player.hand)} cards, {player.score()} sets")
            if player.sets:
                print(f"    Sets: {', '.join(player.sets)}")
        print("="*60 + "\n")


def play_game():
    """Main game loop"""
    print("="*60)
    print("WELCOME TO BIRD CARD GAME!")
    print("="*60)
    print("\nRules:")
    print("- Players take turns asking each other for specific bird cards")
    print("- You must have at least one card of the bird type you're asking for")
    print("- If the other player has cards of that type, they give them all to you")
    print("- If not, you draw a card from the deck")
    print("- When you collect all 4 cards of the same bird type, you score a set")
    print("- The game ends when the deck is empty and a player has no cards")
    print("- The player with the most sets wins!")
    print()
    
    # Get player names
    num_players = 2
    while True:
        try:
            num_input = input("How many players? (2-4): ").strip()
            num_players = int(num_input)
            if 2 <= num_players <= 4:
                break
            print("Please enter a number between 2 and 4")
        except ValueError:
            print("Please enter a valid number")
    
    player_names = []
    for i in range(num_players):
        while True:
            name = input(f"Enter name for Player {i+1}: ").strip()
            if name:
                player_names.append(name)
                break
            print("Name cannot be empty")
    
    # Create and start game
    game = BirdGame(player_names)
    
    print("\n" + "="*60)
    print("GAME STARTING!")
    print("="*60)
    
    # Main game loop
    while not game.check_game_over():
        current_player = game.get_current_player()
        
        game.display_game_state()
        
        print(f"\n{current_player.name}'s turn!")
        print(f"Your hand ({len(current_player.hand)} cards):")
        
        # Group cards by bird type for display
        bird_groups = {}
        for card in current_player.hand:
            if card.bird_type not in bird_groups:
                bird_groups[card.bird_type] = []
            bird_groups[card.bird_type].append(card)
        
        for bird_type, cards in sorted(bird_groups.items()):
            suits = [card.suit for card in cards]
            print(f"  {bird_type}: {', '.join(suits)}")
        
        if not current_player.hand:
            print("  (No cards)")
            game.next_turn()
            continue
        
        # Choose target player
        print(f"\nOther players:")
        other_players = [p for p in game.players if p != current_player]
        for idx, player in enumerate(other_players, 1):
            print(f"  {idx}. {player.name} ({len(player.hand)} cards)")
        
        target_idx = -1
        while target_idx < 0 or target_idx >= len(other_players):
            try:
                target_input = input("Choose a player to ask (number): ").strip()
                target_idx = int(target_input) - 1
            except ValueError:
                print("Please enter a valid number")
        
        target_player = other_players[target_idx]
        
        # Choose bird type to ask for
        available_birds = current_player.get_available_birds()
        print(f"\nYour bird types:")
        for idx, bird in enumerate(sorted(available_birds), 1):
            print(f"  {idx}. {bird}")
        
        bird_idx = -1
        while bird_idx < 0 or bird_idx >= len(available_birds):
            try:
                bird_input = input("Choose a bird type to ask for (number): ").strip()
                bird_idx = int(bird_input) - 1
            except ValueError:
                print("Please enter a valid number")
        
        bird_type = sorted(available_birds)[bird_idx]
        
        # Ask for cards
        print(f"\n{current_player.name} asks {target_player.name} for {bird_type} cards...")
        
        cards_received = game.ask_for_cards(current_player, target_player, bird_type)
        
        if cards_received > 0:
            print(f"Success! {target_player.name} gave you {cards_received} {bird_type} card(s)!")
        else:
            print(f"Go Fish! {target_player.name} doesn't have any {bird_type} cards.")
            card = game.draw_card(current_player)
            if card:
                print(f"You drew a card: {card}")
            else:
                print("The deck is empty!")
        
        # Check for new sets
        new_sets = current_player.check_for_sets()
        if new_sets:
            print(f"\n🎉 {current_player.name} completed a set: {', '.join(new_sets)}!")
        
        # Check for new sets for target player too (in case they lost cards)
        target_new_sets = target_player.check_for_sets()
        if target_new_sets:
            print(f"\n🎉 {target_player.name} completed a set: {', '.join(target_new_sets)}!")
        
        input("\nPress Enter to continue...")
        
        # Next turn
        game.next_turn()
    
    # Game over
    print("\n" + "="*60)
    print("GAME OVER!")
    print("="*60)
    
    game.display_game_state()
    
    print("\nFinal Scores:")
    for player in sorted(game.players, key=lambda p: p.score(), reverse=True):
        print(f"  {player.name}: {player.score()} sets")
        if player.sets:
            print(f"    Sets collected: {', '.join(player.sets)}")
    
    winner = game.get_winner()
    if winner:
        print(f"\n🏆 {winner.name} WINS! 🏆")
    else:
        max_score = max(player.score() for player in game.players)
        winners = [p for p in game.players if p.score() == max_score]
        print(f"\n🏆 TIE between: {', '.join(p.name for p in winners)}! 🏆")


if __name__ == "__main__":
    play_game()
