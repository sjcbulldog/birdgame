import { Injectable, Logger } from '@nestjs/common';
import { TablesService } from '../tables/tables.service';

interface HeartbeatData {
  userId: string;
  lastHeartbeat: Date;
  socketId: string;
}

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);
  private heartbeats: Map<string, HeartbeatData> = new Map();
  private cleanupInterval: NodeJS.Timeout;
  private orphanedUserCheckInterval: NodeJS.Timeout;
  private readonly HEARTBEAT_TIMEOUT = 60000; // 60 seconds (4 heartbeats)
  private readonly CLEANUP_INTERVAL = 15000; // Check every 15 seconds
  private readonly ORPHANED_USER_CHECK_INTERVAL = 60000; // Check every 60 seconds

  constructor(private tablesService: TablesService) {
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
   * Record a heartbeat from a user
   */
  recordHeartbeat(userId: string, socketId: string): void {
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
      await this.cleanupStaleUser(userId);
    }
  }

  /**
   * Clean up a user who has timed out
   */
  private async cleanupStaleUser(userId: string): Promise<void> {
    try {
      this.logger.log(`Cleaning up stale user: ${userId}`);
      
      // Remove from heartbeat tracking
      this.heartbeats.delete(userId);
      
      // Remove from any table they're at
      await this.tablesService.removeUserFromAllTables(userId);
      
      this.logger.log(`Successfully cleaned up stale user: ${userId}`);
    } catch (error) {
      this.logger.error(`Error cleaning up stale user ${userId}:`, error);
    }
  }

  /**
   * Get current heartbeat status for debugging
   */
  getHeartbeatStatus(): { userId: string; lastHeartbeat: Date; secondsSinceHeartbeat: number }[] {
    const now = new Date();
    return Array.from(this.heartbeats.values()).map(data => ({
      userId: data.userId,
      lastHeartbeat: data.lastHeartbeat,
      secondsSinceHeartbeat: Math.round((now.getTime() - data.lastHeartbeat.getTime()) / 1000),
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
