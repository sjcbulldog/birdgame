import { Injectable, Logger } from '@nestjs/common';
import { TablesService } from '../tables/tables.service';
import { UsersService } from '../users/users.service';

interface HeartbeatData {
  userId: string;
  lastHeartbeat: Date;
  socketId: string;
}

interface PendingCleanup {
  userId: string;
  scheduledTime: Date;
  timeoutId: NodeJS.Timeout;
}

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);
  private heartbeats: Map<string, HeartbeatData> = new Map();
  private pendingCleanups: Map<string, PendingCleanup> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private orphanedUserCheckInterval: NodeJS.Timeout;
  private readonly HEARTBEAT_TIMEOUT = 60000; // 60 seconds (4 heartbeats)
  private readonly CLEANUP_INTERVAL = 15000; // Check every 15 seconds
  private readonly ORPHANED_USER_CHECK_INTERVAL = 60000; // Check every 60 seconds
  private readonly DISCONNECT_GRACE_PERIOD = 5000; // 5 seconds grace period for reconnection
  private gateway: any; // TablesGateway reference to avoid circular dependency

  constructor(
    private tablesService: TablesService,
    private usersService: UsersService,
  ) {
    // Clear all heartbeats on server restart
    this.clearAllHeartbeats();
    
    // Start cleanup interval for stale connections
    this.cleanupInterval = setInterval(() => {
      this.checkForStaleConnections();
    }, this.CLEANUP_INTERVAL);

    // Start interval to check for orphaned users in tables
    this.orphanedUserCheckInterval = setInterval(() => {
      this.checkForOrphanedTableUsers();
    }, this.ORPHANED_USER_CHECK_INTERVAL);
  }

  /**
   * Set the gateway reference for emitting updates
   */
  setGateway(gateway: any): void {
    this.gateway = gateway;
  }

  /**
   * Clear all heartbeats on server restart
   */
  clearAllHeartbeats(): void {
    this.logger.log('Clearing all heartbeats on server restart');
    this.heartbeats.clear();
  }

  /**
   * Record a heartbeat from a user
   */
  recordHeartbeat(userId: string, socketId: string): void {
    // Cancel any pending cleanup for this user (they've reconnected)
    const pendingCleanup = this.pendingCleanups.get(userId);
    if (pendingCleanup) {
      clearTimeout(pendingCleanup.timeoutId);
      this.pendingCleanups.delete(userId);
      this.logger.log(`Cancelled pending cleanup for user ${userId} - reconnected`);
    }
    
    this.heartbeats.set(userId, {
      userId,
      lastHeartbeat: new Date(),
      socketId,
    });
  }

  /**
   * Remove heartbeat tracking for a user
   */
  removeHeartbeat(userId: string): void {
    this.heartbeats.delete(userId);
  }

  /**
   * Check for stale connections and clean them up
   */
  private async checkForStaleConnections(): Promise<void> {
    const now = new Date();
    const staleUsers: string[] = [];

    for (const [userId, data] of this.heartbeats.entries()) {
      const timeSinceLastHeartbeat = now.getTime() - data.lastHeartbeat.getTime();
      
      if (timeSinceLastHeartbeat > this.HEARTBEAT_TIMEOUT) {
        staleUsers.push(userId);
        this.logger.warn(`User ${userId} has stale connection (${Math.round(timeSinceLastHeartbeat / 1000)}s since last heartbeat)`);
      }
    }

    // Clean up stale users
    for (const userId of staleUsers) {
      await this.cleanupUser(userId);
    }
  }

  /**
   * Remove a user by socket ID (called when socket disconnects)
   * Schedules cleanup after a grace period to allow for reconnection (e.g., browser refresh)
   */
  async removeUserBySocketId(socketId: string): Promise<void> {
    // Find user by socket ID
    for (const [userId, data] of this.heartbeats.entries()) {
      if (data.socketId === socketId) {
        // Check if there's already a pending cleanup for this user
        if (this.pendingCleanups.has(userId)) {
          this.logger.log(`Cleanup already pending for user ${userId}`);
          return;
        }
        
        // Schedule cleanup after grace period
        this.logger.log(`Socket disconnected for user ${userId}, scheduling cleanup in ${this.DISCONNECT_GRACE_PERIOD}ms`);
        const timeoutId = setTimeout(async () => {
          this.logger.log(`Grace period expired for user ${userId}, cleaning up`);
          this.pendingCleanups.delete(userId);
          await this.cleanupUser(userId);
        }, this.DISCONNECT_GRACE_PERIOD);
        
        this.pendingCleanups.set(userId, {
          userId,
          scheduledTime: new Date(Date.now() + this.DISCONNECT_GRACE_PERIOD),
          timeoutId,
        });
        
        return;
      }
    }
  }

  /**
   * Clean up a user who has timed out or logged out
   */
  async cleanupUser(userId: string): Promise<void> {
    try {
      this.logger.log(`Cleaning up user: ${userId}`);
      
      // Remove from heartbeat tracking
      this.heartbeats.delete(userId);
      
      // Remove from any table they're at
      await this.tablesService.removeUserFromAllTables(userId);
      
      // Emit logged-in users update
      if (this.gateway?.emitLoggedInUsersUpdate) {
        await this.gateway.emitLoggedInUsersUpdate();
      }
      
      this.logger.log(`Successfully cleaned up user: ${userId}`);
    } catch (error) {
      this.logger.error(`Error cleaning up user ${userId}:`, error);
    }
  }

  /**
   * Get current heartbeat status for debugging and user management
   */
  getHeartbeatStatus(): { userId: string; lastHeartbeat: Date; secondsSinceHeartbeat: number; socketId: string }[] {
    const now = new Date();
    return Array.from(this.heartbeats.values()).map(data => ({
      userId: data.userId,
      lastHeartbeat: data.lastHeartbeat,
      secondsSinceHeartbeat: Math.round((now.getTime() - data.lastHeartbeat.getTime()) / 1000),
      socketId: data.socketId,
    }));
  }

  /**
   * Check for users in tables who are not logged in
   * Runs every 60 seconds to clean up orphaned table positions
   */
  private async checkForOrphanedTableUsers(): Promise<void> {
    try {
      // Get set of currently logged-in users (those with active heartbeats)
      const loggedInUsers = new Set(this.heartbeats.keys());
      
      // Get all tables with their players and watchers
      const tables = await this.tablesService.findAllWithPlayersAndWatchers();
      
      const usersToRemove = new Set<string>();
      
      // Check each table for users who aren't logged in
      for (const table of tables) {
        // Check all positions
        if (table.positions.north?.id && !loggedInUsers.has(table.positions.north.id)) {
          usersToRemove.add(table.positions.north.id);
          this.logger.log(`Found orphaned user at table ${table.tableNumber} north position: ${table.positions.north.id}`);
        }
        if (table.positions.south?.id && !loggedInUsers.has(table.positions.south.id)) {
          usersToRemove.add(table.positions.south.id);
          this.logger.log(`Found orphaned user at table ${table.tableNumber} south position: ${table.positions.south.id}`);
        }
        if (table.positions.east?.id && !loggedInUsers.has(table.positions.east.id)) {
          usersToRemove.add(table.positions.east.id);
          this.logger.log(`Found orphaned user at table ${table.tableNumber} east position: ${table.positions.east.id}`);
        }
        if (table.positions.west?.id && !loggedInUsers.has(table.positions.west.id)) {
          usersToRemove.add(table.positions.west.id);
          this.logger.log(`Found orphaned user at table ${table.tableNumber} west position: ${table.positions.west.id}`);
        }
        
        // Check watchers
        if (table.watchers) {
          for (const watcher of table.watchers) {
            if (!loggedInUsers.has(watcher.id)) {
              usersToRemove.add(watcher.id);
              this.logger.warn(`Found orphaned watcher at table ${table.tableNumber}: ${watcher.id}`);
            }
          }
        }
      }
      
      // Remove all orphaned users
      for (const userId of usersToRemove) {
        await this.tablesService.removeUserFromAllTables(userId);
        this.logger.log(`Removed orphaned user from tables: ${userId}`);
      }
      
      if (usersToRemove.size > 0) {
        this.logger.log(`Cleaned up ${usersToRemove.size} orphaned table user(s)`);
      }
    } catch (error) {
      this.logger.error('Error checking for orphaned table users:', error);
    }
  }

  /**
   * Get list of logged-in users with their usernames
   */
  async getLoggedInUsers(): Promise<{ id: string; username: string }[]> {
    const userIds = Array.from(this.heartbeats.keys());
    const users = [];

    for (const userId of userIds) {
      const user = await this.usersService.findById(userId);
      if (user) {
        users.push({
          id: user.id,
          username: user.username,
        });
      }
    }

    // Sort by username
    return users.sort((a, b) => a.username.localeCompare(b.username));
  }

  /**
   * Cleanup on service destroy
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.orphanedUserCheckInterval) {
      clearInterval(this.orphanedUserCheckInterval);
    }
  }
}
