import { Component, OnInit, signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { TableService } from '../../services/table.service';
import { SocketService } from '../../services/socket.service';
import { User } from '../../models/auth.model';
import { Table, Position } from '../../models/table.model';

@Component({
  selector: 'app-home',
  imports: [FormsModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  private authService = inject(AuthService);
  private tableService = inject(TableService);
  private socketService = inject(SocketService);
  private router = inject(Router);

  currentUser: User | null = null;
  tables = signal<Table[]>([]);
  errorMessage = signal<string | null>(null);
  showMenu = false;
  showPreferencesDialog = false;
  tableCount = 3;
  dealAnimationTime = 10000;

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.currentUser = user;
    });

    // Load initial tables
    this.loadTables();

    // Subscribe to real-time updates
    this.socketService.onTableUpdated().subscribe(tables => {
      this.tables.set(tables);
    });

    // Subscribe to game started events - navigate all players when game starts
    this.socketService.onGameStarted().subscribe(data => {
      this.router.navigate(['/game', data.gameId]);
    });
  }

  loadTables(): void {
    this.tableService.getTables().subscribe({
      next: (tables) => {
        this.tables.set(tables);
      },
      error: (error) => {
        console.error('Error loading tables:', error);
        this.errorMessage.set('Failed to load tables: ' + (error.error?.message || error.message));
      }
    });
  }

  onPositionClick(tableId: string, position: Position, isOccupied: boolean): void {
    if (isOccupied) {
      // Check if the occupied position is the current user
      const table = this.tables().find(t => t.id === tableId);
      if (table && this.currentUser) {
        const occupiedPlayer = table.positions[position];
        if (occupiedPlayer?.id === this.currentUser.id) {
          // User clicked on their own position - leave the table
          this.tableService.leaveTable(tableId).subscribe({
            next: () => {
              // WebSocket will update the view
            },
            error: (error) => {
              console.error('Error leaving table:', error);
              this.errorMessage.set('Failed to leave table');
              setTimeout(() => this.errorMessage.set(null), 3000);
            }
          });
          return;
        }
      }
      
      // Position is occupied by another player
      this.errorMessage.set('This position is already taken');
      setTimeout(() => this.errorMessage.set(null), 3000);
      return;
    }

    this.tableService.joinTable(tableId, position).subscribe({
      next: () => {
        // Success - WebSocket will update the view
      },
      error: (error) => {
        if (error.status === 409) {
          this.errorMessage.set('This position was just taken by another player');
          // Auto-refresh to show current state
          this.loadTables();
        } else {
          this.errorMessage.set('An error occurred. Please try again.');
        }
        setTimeout(() => this.errorMessage.set(null), 3000);
      }
    });
  }

  onCardImageClick(event: MouseEvent, tableId: string): void {
    // Check if user is at this table
    const table = this.tables().find(t => t.id === tableId);
    if (table && this.currentUser && this.isUserAtTable(table)) {
      // Remove user from table
      this.tableService.leaveTable(tableId).subscribe({
        next: () => {
          // WebSocket will update the view
        },
        error: (error) => {
          console.error('Error leaving table:', error);
          this.errorMessage.set('Failed to leave table');
          setTimeout(() => this.errorMessage.set(null), 3000);
        }
      });
    }
  }

  onWatchTable(tableId: string): void {
    this.tableService.watchTable(tableId).subscribe({
      next: () => {
        // Success - WebSocket will update the view
      },
      error: (error) => {
        console.error('Error watching table:', error);
        this.errorMessage.set('Failed to watch table');
        setTimeout(() => this.errorMessage.set(null), 3000);
      }
    });
  }

  isUserAtTable(table: Table): boolean {
    if (!this.currentUser) return false;
    
    const userId = this.currentUser.id;
    return table.positions.north?.id === userId ||
           table.positions.south?.id === userId ||
           table.positions.east?.id === userId ||
           table.positions.west?.id === userId;
  }

  hasPlayers(table: Table): boolean {
    return !!(table.positions.north || table.positions.south || table.positions.east || table.positions.west);
  }

  startGame(tableId: string): void {
    this.tableService.startGame(tableId).subscribe({
      next: (response) => {
        // Don't navigate directly - let the gameStarted socket event handle navigation
        // This ensures all players at the table are navigated together
      },
      error: (error) => {
        console.error('Error starting game:', error);
        this.errorMessage.set('Failed to start game: ' + (error.error?.message || error.message));
        setTimeout(() => this.errorMessage.set(null), 3000);
      }
    });
  }

  hasActiveGame(table: Table): boolean {
    return !!table.activeGameId && this.isUserAtTable(table);
  }

  getButtonText(table: Table): string {
    return this.hasActiveGame(table) ? 'Continue' : 'Start';
  }

  logout(): void {
    this.showMenu = false;
    this.authService.logout();
    this.router.navigate(['/login']);
  }

  toggleMenu(): void {
    this.showMenu = !this.showMenu;
  }

  openPreferences(): void {
    this.showMenu = false;
    this.showPreferencesDialog = true;
    // Load current preferences
    this.tableService.getPreferences().subscribe({
      next: (prefs) => {
        this.tableCount = prefs.tableCount;
        this.dealAnimationTime = prefs.dealAnimationTime;
      },
      error: (error) => {
        console.error('Error loading preferences:', error);
        this.tableCount = this.tables().length;
        this.dealAnimationTime = 10000;
      }
    });
  }

  cancelPreferences(): void {
    this.showPreferencesDialog = false;
  }

  savePreferences(): void {
    if (this.tableCount < 3 || this.tableCount > 36) {
      this.errorMessage.set('Table count must be between 3 and 36');
      setTimeout(() => this.errorMessage.set(null), 3000);
      return;
    }

    if (this.dealAnimationTime < 1000 || this.dealAnimationTime > 42000) {
      this.errorMessage.set('Deal animation time must be between 1000 and 42000 milliseconds');
      setTimeout(() => this.errorMessage.set(null), 3000);
      return;
    }

    this.tableService.setPreferences({
      tableCount: this.tableCount,
      dealAnimationTime: this.dealAnimationTime
    }).subscribe({
      next: () => {
        this.showPreferencesDialog = false;
        // Tables will be updated via WebSocket
      },
      error: (error) => {
        console.error('Error setting preferences:', error);
        this.errorMessage.set('Failed to update preferences');
        setTimeout(() => this.errorMessage.set(null), 3000);
      }
    });
  }
}
