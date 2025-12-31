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

  constructor(private router: Router) {
    // Don't initialize socket here - wait for explicit connection
  }

  connect(token?: string): void {
    if (this.socket?.connected) {
      console.log('Socket already connected');
      return; // Already connected
    }

    const auth = token ? { token } : {};
    
    this.socket = io(environment.wsUrl, {
      transports: ['websocket'],
      auth,
    });

    // Set up event listeners
    this.socket.on('connect', () => {
      console.log('Socket connected');
    });

    this.socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    this.socket.on('error', (error: any) => {
      console.error('Socket error:', error);
    });

    // Listen for game state updates
    this.socket.on('gameState', (data: any) => {
      console.log('Game state event received:', data);
      this.gameStateSubject.next(data);
    });

    // Listen for player ready updates
    this.socket.on('playerReadyUpdate', (data: { playerReady: Record<string, boolean>; allReady: boolean }) => {
      console.log('Player ready update event received:', data);
      this.playerReadyUpdateSubject.next(data);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // Table events
  onTableUpdated(): Observable<Table[]> {
    if (!this.socket) {
      throw new Error('Socket not connected');
    }
    return fromEvent<Table[]>(this.socket, 'tableUpdated');
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
    this.disconnect();
  }
}
