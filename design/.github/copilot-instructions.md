# Birds Card Game - System Design Instructions

You are working on a multiplayer card game called "Birds" with a full-stack architecture. Always reference the game rules and design documents when implementing features.

## Project Overview

This is a web-based implementation of a four-player card game called "Birds" (also known as "Oh Hell" or "Wizard"). The system consists of:

- **Backend**: NestJS/TypeScript REST API + WebSocket server
- **Frontend**: Angular 18+ standalone components with Canvas-based rendering
- **Database**: MySQL with TypeORM
- **Real-time**: Socket.io for game state synchronization

**CRITICAL**: Consult 'design/LAYOUT.md' for the layout of the players in the frontend and backend.

## Game Rules Reference

**CRITICAL**: Always consult `design/RULES.md` before implementing any game logic. The rules document is the source of truth for:

- Card deck composition (42 cards: red/black/green/yellow 5-14, plus bird card and red 1)
- Player partnerships (N/S vs E/W)
- Dealing sequence (specific 5-round + 4-round + 1-card pattern)
- Bidding rules (70 minimum, 5-point increments, "check" only if partner is high bidder)
- Trump mechanics
- Trick-taking rules
- Scoring system (card point values, team scoring, 500-point win condition)

## System Architecture

### Communication Patterns

1. **REST API**: User authentication, table management, game creation
2. **WebSocket**: Real-time game state updates, player actions during gameplay
3. **State Synchronization**: Server is authoritative; clients receive updates via WebSocket

### Data Flow

```
Player Action → Frontend → WebSocket/REST → Backend Service → Database
                                                    ↓
                                    Game State Update → WebSocket Broadcast
                                                    ↓
                                            All Connected Clients
```

### Database Schema

**Tables**:
- `users`: Player accounts and authentication
- `tables`: Game tables with 4 positions (N/S/E/W) + watchers
- `games`: Game instances with state machine, scores, and JSON game state
- `table_watchers`: Many-to-many relationship for spectators

**Key Relationships**:
- Table → Users (4 ManyToOne relations for positions)
- Game → Table (ManyToOne)
- Game stores full game state as JSON including hands, centerPile, tricks, bidding history

## Game State Machine

```
NEW → DEALING → BIDDING → SELECTING → DECLARING_TRUMP → PLAYING → SCORING → COMPLETE
                                                                      ↑            ↓
                                                                      └── (loop) ──┘
```

States cycle through DEALING → BIDDING → ... → SCORING for each hand until a team reaches 500 points.

## Computer Players (AI)

- Automatically fill empty positions when a game starts
- Marked as `playerType: 'computer'` vs `'human'`
- Have basic strategy stubs (TODO: enhance AI logic)
- Always marked as "ready" in pre-game lobby

## Design Principles

### Multiplayer Consistency

- **Server Authority**: All game logic executes on the server
- **Optimistic Updates**: Frontend can show immediate feedback but server state is truth
- **Personalized State**: Each player only sees their own cards face-up
- **Atomic Operations**: Use database transactions (QueryRunner) for all game state changes

### Security

- JWT authentication required for all game actions
- Position assignment validated server-side
- Card plays validated against game rules server-side
- No trust of client-provided game state

### User Experience

- WebSocket provides instant feedback for all player actions
- Pre-game lobby with player ready tracking
- Visual feedback for game state transitions
- Card sorting and display optimized for human player

### Performance Considerations

- JSON storage for flexible game state
- Eager loading of relations where needed
- Room-based WebSocket broadcasting (game:{gameId}, table:{tableId})
- Canvas rendering for efficient card display

## Common Patterns

### Creating a New Game Feature

1. **Check RULES.md** for official rules
2. **Update Game State**: Modify game.entity.ts if needed
3. **Add Service Method**: Implement logic in game.service.ts with QueryRunner transaction
4. **Create API Endpoint**: Add REST or WebSocket handler
5. **Update Frontend**: Add UI and socket event handling
6. **Test with Computer Players**: Ensure AI can participate

### State Transitions

1. Validate current state allows the transition
2. Perform game logic (deal cards, resolve tricks, etc.)
3. Update state and relevant fields
4. Save to database within transaction
5. Broadcast update via WebSocket

### Adding New Card Rules

1. Reference specific rule in RULES.md
2. Implement validation in game.service.ts
3. Add helper methods for rule checking
4. Test with edge cases (e.g., bird card, red 1, trump suit)

## Testing Considerations

- Test with 1 human + 3 computer players for solo testing
- Verify state transitions follow the state machine
- Ensure score calculations match RULES.md point values
- Test partnership mechanics (N/S vs E/W)
- Verify game ends when team reaches 500 points

## Code Organization

**Backend** (`backend/src/`):
- `auth/`: User authentication (JWT)
- `users/`: User management
- `tables/`: Table creation and player seating
- `game/`: Core game logic, state machine, AI
- `gateway/`: WebSocket real-time communication

**Frontend** (`frontend/src/app/`):
- `components/`: UI components (home, game, login, etc.)
- `services/`: HTTP and WebSocket services
- `models/`: TypeScript interfaces
- `guards/`: Route protection

## Important Reminders

- Game scores are updated only after scoring phase, not during hand
- Scores displayed throughout game but not modified mid-hand
- Computer players participate in all game phases automatically
- Pre-game lobby requires all human players to click "Start Game"
- Cards dealt in specific pattern per RULES.md - don't deviate
- Bidding increments are exactly 5 points, minimum 70
- "Check" bid only valid if partner is current high bidder
