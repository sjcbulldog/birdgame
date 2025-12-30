#!/usr/bin/env python3
"""
Test suite for Bird Card Game

Tests the core game mechanics to ensure everything works correctly.
"""

import sys
from birdgame import Card, Deck, Player, BirdGame


def test_card_creation():
    """Test creating cards"""
    print("Testing card creation...")
    card = Card("Robin", "Spring")
    assert card.bird_type == "Robin"
    assert card.suit == "Spring"
    assert str(card) == "Robin (Spring)"
    print("✓ Card creation works")


def test_card_equality():
    """Test card equality"""
    print("Testing card equality...")
    card1 = Card("Robin", "Spring")
    card2 = Card("Robin", "Spring")
    card3 = Card("Robin", "Summer")
    assert card1 == card2
    assert card1 != card3
    print("✓ Card equality works")


def test_deck_creation():
    """Test deck creation and size"""
    print("Testing deck creation...")
    deck = Deck()
    # 10 bird types * 4 suits = 40 cards
    assert deck.cards_remaining() == 40
    assert not deck.is_empty()
    print("✓ Deck creation works")


def test_deck_shuffle_and_draw():
    """Test shuffling and drawing cards"""
    print("Testing deck shuffle and draw...")
    deck = Deck()
    initial_count = deck.cards_remaining()
    
    deck.shuffle()
    card = deck.draw()
    assert card is not None
    assert deck.cards_remaining() == initial_count - 1
    
    # Draw all cards
    while not deck.is_empty():
        deck.draw()
    
    assert deck.cards_remaining() == 0
    assert deck.is_empty()
    assert deck.draw() is None
    print("✓ Deck shuffle and draw works")


def test_player_creation():
    """Test creating a player"""
    print("Testing player creation...")
    player = Player("Alice")
    assert player.name == "Alice"
    assert len(player.hand) == 0
    assert len(player.sets) == 0
    assert player.score() == 0
    print("✓ Player creation works")


def test_player_add_remove_cards():
    """Test adding and removing cards from player hand"""
    print("Testing player add/remove cards...")
    player = Player("Bob")
    card1 = Card("Robin", "Spring")
    card2 = Card("Robin", "Summer")
    
    player.add_card(card1)
    assert len(player.hand) == 1
    
    player.add_card(card2)
    assert len(player.hand) == 2
    
    assert player.has_bird("Robin")
    assert not player.has_bird("Eagle")
    
    cards = player.get_cards_of_type("Robin")
    assert len(cards) == 2
    
    removed = player.remove_card(card1)
    assert removed
    assert len(player.hand) == 1
    print("✓ Player add/remove cards works")


def test_player_sets():
    """Test player set detection"""
    print("Testing player set detection...")
    player = Player("Charlie")
    
    # Add 4 cards of same bird type (complete set)
    player.add_card(Card("Eagle", "Spring"))
    player.add_card(Card("Eagle", "Summer"))
    player.add_card(Card("Eagle", "Fall"))
    player.add_card(Card("Eagle", "Winter"))
    
    # Check for sets
    new_sets = player.check_for_sets()
    assert len(new_sets) == 1
    assert "Eagle" in new_sets
    assert player.score() == 1
    assert len(player.hand) == 0  # Cards removed after set completion
    print("✓ Player set detection works")


def test_game_initialization():
    """Test game initialization"""
    print("Testing game initialization...")
    game = BirdGame(["Alice", "Bob"])
    
    assert len(game.players) == 2
    assert game.players[0].name == "Alice"
    assert game.players[1].name == "Bob"
    
    # Each player should be dealt cards (7 each for 2-player game)
    # Some cards might have been immediately formed into sets
    total_alice_cards = len(game.players[0].hand) + len(game.players[0].sets) * 4
    total_bob_cards = len(game.players[1].hand) + len(game.players[1].sets) * 4
    assert total_alice_cards == 7
    assert total_bob_cards == 7
    
    # Deck should have fewer cards after dealing
    assert game.deck.cards_remaining() < 40
    print("✓ Game initialization works")


def test_game_ask_for_cards():
    """Test asking for cards mechanic"""
    print("Testing ask for cards...")
    player1 = Player("Alice")
    player2 = Player("Bob")
    
    # Give Alice a Robin card
    player1.add_card(Card("Robin", "Spring"))
    
    # Give Bob some Robin cards
    player2.add_card(Card("Robin", "Summer"))
    player2.add_card(Card("Robin", "Fall"))
    
    game = BirdGame(["Alice", "Bob"])
    game.players = [player1, player2]
    
    initial_alice_cards = len(player1.hand)
    initial_bob_cards = len(player2.hand)
    
    # Alice asks Bob for Robin cards
    cards_transferred = game.ask_for_cards(player1, player2, "Robin")
    
    assert cards_transferred == 2  # Bob had 2 Robin cards
    assert len(player1.hand) == initial_alice_cards + 2  # Got 2 cards from Bob
    assert len(player2.hand) == initial_bob_cards - 2  # Lost 2 cards
    print("✓ Ask for cards works")


def test_game_draw_card():
    """Test drawing a card"""
    print("Testing draw card...")
    game = BirdGame(["Alice", "Bob"])
    player = game.players[0]
    
    initial_hand_size = len(player.hand)
    initial_deck_size = game.deck.cards_remaining()
    
    if initial_deck_size > 0:
        card = game.draw_card(player)
        assert card is not None
        assert len(player.hand) == initial_hand_size + 1
        assert game.deck.cards_remaining() == initial_deck_size - 1
    print("✓ Draw card works")


def test_game_over_condition():
    """Test game over detection"""
    print("Testing game over condition...")
    game = BirdGame(["Alice", "Bob"])
    
    # Initially game should not be over
    assert not game.game_over
    
    # Empty the deck
    while not game.deck.is_empty():
        game.deck.draw()
    
    # Clear one player's hand
    game.players[0].hand = []
    
    # Now game should be over
    is_over = game.check_game_over()
    assert is_over
    assert game.game_over
    print("✓ Game over condition works")


def run_all_tests():
    """Run all tests"""
    print("="*60)
    print("RUNNING BIRD CARD GAME TESTS")
    print("="*60)
    print()
    
    tests = [
        test_card_creation,
        test_card_equality,
        test_deck_creation,
        test_deck_shuffle_and_draw,
        test_player_creation,
        test_player_add_remove_cards,
        test_player_sets,
        test_game_initialization,
        test_game_ask_for_cards,
        test_game_draw_card,
        test_game_over_condition,
    ]
    
    failed = 0
    for test in tests:
        try:
            test()
        except AssertionError as e:
            print(f"✗ Test failed: {test.__name__}")
            print(f"  Error: {e}")
            failed += 1
        except Exception as e:
            print(f"✗ Test error: {test.__name__}")
            print(f"  Error: {e}")
            failed += 1
    
    print()
    print("="*60)
    if failed == 0:
        print("✓ ALL TESTS PASSED!")
    else:
        print(f"✗ {failed} TEST(S) FAILED")
    print("="*60)
    
    return failed


if __name__ == "__main__":
    failed_count = run_all_tests()
    sys.exit(failed_count)
