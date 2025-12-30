#!/usr/bin/env python3
"""
Quick demonstration of game setup and initial state
"""

from birdgame import BirdGame

# Create a game
print("="*60)
print("BIRD CARD GAME - SETUP DEMONSTRATION")
print("="*60)
print()

game = BirdGame(["Alice", "Bob"])

cards_dealt = 40 - game.deck.cards_remaining()

print("Game initialized!")
print(f"Total cards in deck: 40 (10 bird types × 4 seasons)")
print(f"Cards dealt to players: {cards_dealt} (7 per player for 2-player game)")
print(f"Cards remaining in deck: {game.deck.cards_remaining()}")
print()

for player in game.players:
    print(f"Player: {player.name}")
    print(f"  Cards in hand: {len(player.hand)}")
    print(f"  Starting sets: {len(player.sets)}")
    
    # Show hand grouped by bird type
    bird_groups = {}
    for card in player.hand:
        if card.bird_type not in bird_groups:
            bird_groups[card.bird_type] = []
        bird_groups[card.bird_type].append(card.suit)
    
    print(f"  Hand breakdown:")
    for bird, suits in sorted(bird_groups.items()):
        print(f"    {bird}: {', '.join(sorted(suits))}")
    
    if player.sets:
        print(f"  Completed sets: {', '.join(player.sets)}")
    print()

print("="*60)
print("To play the full game, run: python3 birdgame.py")
print("To see an automated game, run: python3 demo.py")
print("To run tests, run: python3 test_birdgame.py")
print("="*60)
