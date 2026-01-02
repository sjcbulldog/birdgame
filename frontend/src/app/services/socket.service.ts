import { Injectable, OnDestroy } from '@angular/core';
import { Observable, fromEvent, EMPTY, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { Table } from '../models/table.model';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SocketService implements OnDestroy {
  private socket: Socket | null = null;
  private gameStateSubject = new Subject<any>();
  private playerReadyUpdateSubject = new Subject<{ playerReady: Record<string, boolean>; allReady: boolean }>();
  private loggedInUsersSubject = new Subject<Array<{ id: string; username: string }>>();
  private heartbeatInterval: any = null;
  private userId: string | null = null;

  constructor(private router: Router) {
    // Don't initialize socket here - wait for explicit connection
  }

  connect(token?: string, userId?: string): void {
    if (this.socket?.connected) {
      return; // Already connected
    }

    if (userId) {
      this.userId = userId;
    }

    const auth = token ? { token } : {};
    
    this.socket = io(environment.wsUrl, {
      transports: ['websocket'],
      auth,
    });

    // Set up event listeners
    this.socket.on('connect', () => {
      this.startHeartbeat();
    });

    this.socket.on('disconnect', () => {
      this.stopHeartbeat();
    });

    this.socket.on('error', (error: any) => {
      console.error('Socket error:', error);
    });

    // Listen for game state updates
    this.socket.on('gameState', (data: any) => {
      this.gameStateSubject.next(data);
    });

    // Listen for player ready updates
    this.socket.on('playerReadyUpdate', (data: { playerReady: Record<string, boolean>; allReady: boolean }) => {
      this.playerReadyUpdateSubject.next(data);
    });

    // Listen for logged-in users updates
    this.socket.on('loggedInUsersUpdated', (data: Array<{ id: string; username: string }>) => {
      this.loggedInUsersSubject.next(data);
    });
  }

  private startHeartbeat(): void {
    // Clear any existing interval
    this.stopHeartbeat();
    
    // Send heartbeat every 15 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected && this.userId) {
        this.socket.emit('heartbeat', { userId: this.userId });
      }
    }, 15000);

    // Send initial heartbeat immediately
    if (this.socket?.connected && this.userId) {
      this.socket.emit('heartbeat', { userId: this.userId });
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  disconnect(): void {
    this.stopHeartbeat();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.userId = null;
  }

  // Generic emit for custom events
  emit(event: string, data: any): void {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit(event, data);
  }

  // Table events
  onTableUpdated(): Observable<Table[]> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<Table[]>(this.socket, 'tableUpdated');
  }

  onLoggedInUsersUpdated(): Observable<Array<{ id: string; username: string }>> {
    return this.loggedInUsersSubject.asObservable();
  }

  // Game events
  joinGame(gameId: string, player: string) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('joinGame', { gameId, player });
  }

  placeBid(gameId: string, player: string, bid: number | 'pass' | 'check') {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('placeBid', { gameId, player, bid });
  }

  selectCards(gameId: string, player: string, selectedCardIds: string[]) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('selectCards', { gameId, player, selectedCardIds });
  }

  declareTrump(gameId: string, player: string, trumpSuit: string) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('declareTrump', { gameId, player, trumpSuit });
  }

  startNextHand(gameId: string) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('startNextHand', { gameId });
  }

  scoringReady(gameId: string, player: string) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('scoringReady', { gameId, player });
  }

  playCard(gameId: string, player: string, cardId: string) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('playCard', { gameId, player, cardId });
  }

  playerReady(gameId: string, player: string) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('playerReady', { gameId, player });
  }

  dealingComplete(gameId: string) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('dealingComplete', { gameId });
  }

  toggleBRB(gameId: string, player: string) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('toggleBRB', { gameId, player });
  }

  sayMessage(gameId: string, player: string, message: string) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('sayMessage', { gameId, player, message });
  }

  claimGotTheRest(gameId: string, player: string) {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    this.socket.emit('claimGotTheRest', { gameId, player });
  }

  // Game state listeners
  onGameState(): Observable<any> {
    return this.gameStateSubject.asObservable();
  }

  onGameStarted(): Observable<{ tableId: string; gameId: string }> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<{ tableId: string; gameId: string }>(this.socket, 'gameStarted');
  }

  onDealingComplete(): Observable<any> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<any>(this.socket, 'dealingComplete');
  }

  onBiddingStarted(): Observable<any> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<any>(this.socket, 'biddingStarted');
  }

  onBidPlaced(): Observable<any> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<any>(this.socket, 'bidPlaced');
  }

  onBiddingComplete(): Observable<any> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<any>(this.socket, 'biddingComplete');
  }

  onTrumpDeclared(): Observable<any> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<any>(this.socket, 'trumpDeclared');
  }

  onCardPlayed(): Observable<any> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<any>(this.socket, 'cardPlayed');
  }

  onTrickComplete(): Observable<any> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<any>(this.socket, 'trickComplete');
  }

  onHandScored(): Observable<any> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<any>(this.socket, 'handScored');
  }

  onPlayerReadyUpdate(): Observable<{ playerReady: Record<string, boolean>; allReady: boolean }> {
    return this.playerReadyUpdateSubject.asObservable();
  }

  ngOnDestroy() {
    this.stopHeartbeat();
    this.disconnect();
  }
}
