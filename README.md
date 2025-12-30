# Bird Card Game 🐦

A card game I played growing up as a kid - now implemented as a playable Python game!

## About

Bird Card Game is a matching and collection card game similar to "Go Fish". Players take turns asking each other for specific bird cards, trying to collect complete sets of 4 matching cards (one from each season). The player with the most complete sets at the end of the game wins!

## Game Rules

1. **Setup**: Each player is dealt 7 cards (for 2 players) or 5 cards (for 3-4 players) from a deck of 40 bird cards
2. **Card Types**: There are 10 different bird types, each with 4 seasonal variants (Spring, Summer, Fall, Winter)
3. **Turns**: On your turn, you must ask another player for cards of a specific bird type
4. **Requirements**: You must have at least one card of the bird type you're asking for
5. **Success**: If the other player has cards of that type, they must give you ALL of them
6. **Go Fish**: If they don't have any, you draw a card from the deck
7. **Scoring**: When you collect all 4 cards (all seasons) of a bird type, you score a set
8. **Game End**: The game ends when the deck is empty and at least one player has no cards
9. **Winner**: The player with the most complete sets wins!

## Bird Types

The game includes these 10 bird types:
- Robin
- Eagle
- Sparrow
- Owl
- Hawk
- Cardinal
- Bluejay
- Crow
- Parrot
- Finch

Each bird has 4 seasonal cards: Spring, Summer, Fall, and Winter.

## Requirements

- Python 3.6 or higher
- No additional dependencies required (uses only standard library)

## How to Play

1. Make sure you have Python 3 installed:
   ```bash
   python3 --version
   ```

2. Run the game:
   ```bash
   python3 birdgame.py
   ```
   
   Or make it executable and run directly:
   ```bash
   chmod +x birdgame.py
   ./birdgame.py
   ```

3. Follow the on-screen prompts:
   - Enter the number of players (2-4)
   - Enter each player's name
   - Take turns asking for bird cards
   - Try to collect complete sets!

## Gameplay Example

```
WELCOME TO BIRD CARD GAME!

Your hand (5 cards):
  Robin: Spring, Summer
  Eagle: Fall
  Owl: Winter
  Hawk: Spring

Choose a player to ask (1 for Alice): 1
Choose a bird type to ask for:
  1. Eagle
  2. Hawk
  3. Owl
  4. Robin

Alice asks Bob for Robin cards...
Success! Bob gave you 1 Robin card(s)!

🎉 Alice completed a set: Robin!
```

## Strategy Tips

- Remember which birds other players have asked for
- Try to complete sets quickly before others can
- Pay attention to how many cards each player has
- Ask for birds you already have multiple cards of

## Development

The game is implemented in pure Python with no external dependencies. The code includes:
- `Card`: Represents individual bird cards
- `Deck`: Manages the card deck
- `Player`: Handles player hands and scoring
- `BirdGame`: Main game logic and turn management

## License

This is a personal project implementing a childhood card game.

## Contributing

Feel free to fork and modify for your own use!
