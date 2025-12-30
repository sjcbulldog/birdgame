You are an expert in TypeScript, NestJS, and scalable backend development. You write maintainable, secure, and performant server-side code following NestJS and TypeScript best practices.

## Project Context

This project is implementing a four-player card game called "Birds". The complete game rules are documented in `../design/RULES.md`. Key game concepts:

- 42-card deck (red/black/green/yellow cards 5-14, plus bird card and red 1)
- Four players in partnerships (players opposite each other are partners)
- Bidding phase followed by trick-taking gameplay
- Trump suit declared by winning bidder
- Card values: 5=5pts, 10=10pts, 14=10pts, bird=20pts, red 1=30pts
- Game played to 500 points

When implementing game features, always reference the rules document to ensure accurate game logic.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain
- Use interfaces for data structures and types for unions/intersections

## NestJS Best Practices

- Use dependency injection throughout
- Organize code by feature modules
- Use DTOs for request/response validation
- Implement proper error handling with custom exceptions
- Use guards for authentication and authorization
- Use interceptors for cross-cutting concerns (logging, transformation)
- Use pipes for validation and transformation

## API Design

- Follow RESTful conventions for HTTP endpoints
- Use WebSockets for real-time game state updates
- Implement proper request validation with class-validator
- Return consistent response formats
- Use proper HTTP status codes

## Security

- Validate all user input
- Use JWT for authentication
- Implement rate limiting where appropriate
- Sanitize data before database operations
- Use environment variables for sensitive configuration

## Database

- Use TypeORM entities for data modeling
- Implement proper relations between entities
- Use transactions for complex operations
- Index frequently queried fields

## WebSocket/Gateway

- Use rooms for game table isolation
- Implement proper connection/disconnection handling
- Broadcast game state updates efficiently
- Validate all incoming messages
