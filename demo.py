#!/usr/bin/env python3
"""
Demo script to show the game in action with automated players
"""

from birdgame import BirdGame
import random


def simulate_game():
    """Simulate a quick game with automated decisions"""
    print("="*60)
    print("BIRD CARD GAME - AUTOMATED DEMO")
    print("="*60)
    print("\nSimulating a game between Alice and Bob...\n")
    
    # Create game
    game = BirdGame(["Alice", "Bob"])
    
    turn_count = 0
    max_turns = 20  # Limit turns for demo
    
    while not game.check_game_over() and turn_count < max_turns:
        turn_count += 1
        current_player = game.get_current_player()
        
        print(f"\n--- Turn {turn_count}: {current_player.name} ---")
        print(f"Deck: {game.deck.cards_remaining()} cards")
        
        for player in game.players:
            print(f"{player.name}: {len(player.hand)} cards, {player.score()} sets")
        
        if not current_player.hand:
            print(f"{current_player.name} has no cards, skipping turn")
            game.next_turn()
            continue
        
        # Choose random target
        other_players = [p for p in game.players if p != current_player]
        target = random.choice(other_players)
        
        # Choose random bird type from hand
        available_birds = current_player.get_available_birds()
        if not available_birds:
            game.next_turn()
            continue
            
        bird_type = random.choice(available_birds)
        
        print(f"{current_player.name} asks {target.name} for {bird_type}...")
        
        # Ask for cards
        cards_received = game.ask_for_cards(current_player, target, bird_type)
        
        if cards_received > 0:
            print(f"  ✓ Got {cards_received} card(s)!")
        else:
            print(f"  ✗ Go Fish!")
            card = game.draw_card(current_player)
            if card:
                print(f"  Drew: {card}")
        
        # Check for sets
        new_sets = current_player.check_for_sets()
        if new_sets:
            print(f"  🎉 Completed set: {', '.join(new_sets)}")
        
        game.next_turn()
    
    # Show final results
    print("\n" + "="*60)
    print("GAME OVER!")
    print("="*60)
    print("\nFinal Scores:")
    for player in sorted(game.players, key=lambda p: p.score(), reverse=True):
        print(f"  {player.name}: {player.score()} sets")
        if player.sets:
            print(f"    Sets: {', '.join(player.sets)}")
    
    winner = game.get_winner()
    if winner:
        print(f"\n🏆 {winner.name} WINS! 🏆")
    else:
        print("\n🏆 TIE GAME! 🏆")
    
    print("\n" + "="*60)
    print("Demo complete! To play interactively, run: python3 birdgame.py")
    print("="*60)


if __name__ == "__main__":
    simulate_game()
