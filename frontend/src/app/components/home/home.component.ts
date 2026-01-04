import { Component, OnInit, signal, inject, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { TableService } from '../../services/table.service';
import { SocketService } from '../../services/socket.service';
import { UserService, User as UserProfile } from '../../services/user.service';
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
  private userService = inject(UserService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  currentUser: User | null = null;
  tables = signal<Table[]>([]);
  loggedInUsers = signal<Array<{ id: string; username: string }>>([]);
  errorMessage = signal<string | null>(null);
  showMenu = false;
  showPreferencesDialog = false;
  showAttributionsDialog = false;
  showUsersDialog = false;
  showTableCountWarningDialog = false;
  tableCount = 3;
  originalTableCount = 3;
  dealAnimationTime = 10000;
  trickAnimationTime = 1000;
  trickDisplayDelay = 2000;
  bidWinnerMessageTime = 1000;
  
  // User management
  allUsers: UserProfile[] = [];
  filteredUsers: UserProfile[] = [];
  userSearchText = '';

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

    // Subscribe to logged-in users updates
    this.socketService.onLoggedInUsersUpdated().subscribe(users => {
      this.loggedInUsers.set(users);
    });

    // Subscribe to game started events - navigate only if the user is part of that table
    this.socketService.onGameStarted().subscribe(data => {
      // Check if current user is part of the table that started the game
      const table = this.tables().find(t => t.id === data.tableId);
      if (table && this.currentUser) {
        const isPlayerAtTable = Object.values(table.positions).some(
          player => player?.id === this.currentUser?.id
        );
        
        // Check if user is watching this table
        const isWatchingTable = table.watchers?.some(
          watcher => watcher.id === this.currentUser?.id
        );
        
        // Navigate player to game
        if (isPlayerAtTable) {
          this.router.navigate(['/game', data.gameId]);
        } else if (isWatchingTable) {
          // Navigate watcher to watch mode
          this.router.navigate(['/watch', data.gameId]);
        }
      }
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
    const table = this.tables().find(t => t.id === tableId);
    
    if (isOccupied) {
      // Check if this is a computer player in an active game
      if (table && this.isComputerPlayer(table, position)) {
        this.errorMessage.set('Game is already in progress. Cannot join this position.');
        setTimeout(() => this.errorMessage.set(null), 3000);
        return;
      }
      
      // Check if the occupied position is the current user
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
        // If the table has a game in 'new' state, navigate to it immediately
        if (table && table.activeGameId && table.gameState === 'new') {
          this.router.navigate(['/game', table.activeGameId]);
        }
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
    const table = this.tables().find(t => t.id === tableId);
    
    // If table has an active game, navigate to watcher view
    if (table && table.activeGameId) {
      this.router.navigate(['/watch', table.activeGameId]);
    } else {
      // Otherwise just add as watcher to the table
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
    return this.hasActiveGame(table) ? 'Rejoin' : 'Start';
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
    // Load current preferences before showing dialog
    this.tableService.getPreferences().subscribe({
      next: (prefs) => {
        this.tableCount = prefs.tableCount;
        this.originalTableCount = prefs.tableCount;
        this.dealAnimationTime = prefs.dealAnimationTime;
        this.trickAnimationTime = prefs.trickAnimationTime;
        this.trickDisplayDelay = prefs.trickDisplayDelay;
        this.bidWinnerMessageTime = prefs.bidWinnerMessageTime;
        // Use setTimeout to ensure change detection picks this up
        setTimeout(() => {
          this.showPreferencesDialog = true;
          this.cdr.detectChanges();
        }, 0);
      },
      error: (error) => {
        console.error('Error loading preferences:', error);
        this.tableCount = this.tables().length;
        this.originalTableCount = this.tables().length;
        this.dealAnimationTime = 10000;
        this.trickAnimationTime = 1000;
        this.trickDisplayDelay = 2000;
        this.bidWinnerMessageTime = 1000;
        setTimeout(() => {
          this.showPreferencesDialog = true;
          this.cdr.detectChanges();
        }, 0);
      }
    });
  }

  cancelPreferences(): void {
    this.showPreferencesDialog = false;
  }

  showAttributions(): void {
    this.showAttributionsDialog = true;
  }

  closeAttributions(): void {
    this.showAttributionsDialog = false;
  }

  savePreferences(): void {
    // Ensure all values are numbers
    this.tableCount = Number(this.tableCount);
    this.dealAnimationTime = Number(this.dealAnimationTime);
    this.trickAnimationTime = Number(this.trickAnimationTime);
    this.trickDisplayDelay = Number(this.trickDisplayDelay);
    this.bidWinnerMessageTime = Number(this.bidWinnerMessageTime);

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

    if (this.trickAnimationTime < 500 || this.trickAnimationTime > 5000) {
      this.errorMessage.set('Trick animation time must be between 500 and 5000 milliseconds');
      setTimeout(() => this.errorMessage.set(null), 3000);
      return;
    }

    if (this.trickDisplayDelay < 500 || this.trickDisplayDelay > 10000) {
      this.errorMessage.set('Trick display delay must be between 500 and 10000 milliseconds');
      setTimeout(() => this.errorMessage.set(null), 3000);
      return;
    }

    if (this.bidWinnerMessageTime < 10 || this.bidWinnerMessageTime > 10000) {
      this.errorMessage.set('Bid winner message time must be between 10 and 10000 milliseconds');
      setTimeout(() => this.errorMessage.set(null), 3000);
      return;
    }

    // Check if table count is being reduced
    if (this.tableCount < this.originalTableCount) {
      // Show confirmation dialog
      this.showTableCountWarningDialog = true;
      return;
    }

    this.performSavePreferences();
  }

  confirmTableCountReduction(): void {
    this.showTableCountWarningDialog = false;
    this.performSavePreferences();
  }

  cancelTableCountReduction(): void {
    this.showTableCountWarningDialog = false;
    this.tableCount = this.originalTableCount;
  }

  private performSavePreferences(): void {
    this.tableService.setPreferences({
      tableCount: this.tableCount,
      dealAnimationTime: this.dealAnimationTime,
      trickAnimationTime: this.trickAnimationTime,
      trickDisplayDelay: this.trickDisplayDelay,
      bidWinnerMessageTime: this.bidWinnerMessageTime
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

  isComputerPlayer(table: Table, position: Position): boolean {
    // Show computer players when there's an active game with playerTypes defined
    if (!table.activeGameId || !table.playerTypes) {
      return false;
    }
    return table.playerTypes[position] === 'computer';
  }

  hasPlayerAtPosition(table: Table, position: Position): boolean {
    // A position is occupied if there's a human player OR a computer player (when game is active)
    if (table.positions[position]) {
      return true;
    }
    return this.isComputerPlayer(table, position);
  }

  getPlayerName(table: Table, position: Position): string {
    if (table.positions[position]) {
      return table.positions[position]!.username;
    }
    if (this.isComputerPlayer(table, position)) {
      return table.playerNames?.[position] || 'Computer';
    }
    return '';
  }

  isAdmin(): boolean {
    return this.currentUser?.userType === 'admin';
  }

  openUsersDialog(): void {
    this.showMenu = false;
    this.userSearchText = '';
    this.userService.getAllUsers().subscribe({
      next: (users) => {
        this.allUsers = users;
        this.filteredUsers = users;
        // Use setTimeout to ensure change detection picks this up
        setTimeout(() => {
          this.showUsersDialog = true;
          this.cdr.detectChanges();
        }, 0);
      },
      error: (error) => {
        console.error('Error loading users:', error);
        this.errorMessage.set('Failed to load users');
        setTimeout(() => this.errorMessage.set(null), 3000);
      }
    });
  }

  closeUsersDialog(): void {
    this.showUsersDialog = false;
  }

  filterUsers(): void {
    const searchText = this.userSearchText.toLowerCase();
    this.filteredUsers = this.allUsers.filter(user => 
      user.username.toLowerCase().includes(searchText) ||
      user.email.toLowerCase().includes(searchText) ||
      (user.firstName && user.firstName.toLowerCase().includes(searchText)) ||
      (user.lastName && user.lastName.toLowerCase().includes(searchText))
    );
  }

  updateUserType(user: UserProfile, newType: string): void {
    this.userService.updateUserType(user.id, newType).subscribe({
      next: (updatedUser) => {
        // Update in both arrays
        const allIndex = this.allUsers.findIndex(u => u.id === user.id);
        if (allIndex !== -1) {
          this.allUsers[allIndex] = updatedUser;
        }
        const filteredIndex = this.filteredUsers.findIndex(u => u.id === user.id);
        if (filteredIndex !== -1) {
          this.filteredUsers[filteredIndex] = updatedUser;
        }
      },
      error: (error) => {
        console.error('Error updating user type:', error);
        this.errorMessage.set('Failed to update user type');
        setTimeout(() => this.errorMessage.set(null), 3000);
      }
    });
  }

  getUserTypeClass(userType: string): string {
    switch(userType) {
      case 'admin': return 'user-type-admin';
      case 'banned': return 'user-type-banned';
      case 'pending': return 'user-type-pending';
      default: return 'user-type-normal';
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }
}
