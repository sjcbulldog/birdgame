import { Injectable, OnModuleInit, BadRequestException, forwardRef, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Table } from './entities/table.entity';
import { TableWatcher } from './entities/table-watcher.entity';
import { SitePreferences } from './entities/site-preferences.entity';
import { User } from '../users/user.entity';
import { Position } from './types/position.type';
import { TableResponseDto, PlayerDto } from './dto/table-response.dto';
import { GameService } from '../game/game.service';

@Injectable()
export class TablesService implements OnModuleInit {
  private readonly logger = new Logger(TablesService.name);
  private gateway: any;

  constructor(
    @InjectRepository(Table)
    private tableRepository: Repository<Table>,
    @InjectRepository(TableWatcher)
    private watcherRepository: Repository<TableWatcher>,
    @InjectRepository(SitePreferences)
    private preferencesRepository: Repository<SitePreferences>,
    @Inject(forwardRef(() => GameService))
    private gameService: GameService,
  ) {}

  setGateway(gateway: any) {
    this.gateway = gateway;
  }

  async onModuleInit() {
    // Clear all users from tables on server restart
    await this.clearAllUsersFromTables();
    await this.initializeTables();
  }

  private async initializeTables() {
    const count = await this.tableRepository.count();
    if (count === 0) {
      await this.ensureMinimumEmptyTables(3);
    }
  }

  /**
   * Clear all users from all tables on server restart
   */
  async clearAllUsersFromTables(): Promise<void> {
    try {
      // Update all tables to remove players using query builder
      await this.tableRepository
        .createQueryBuilder()
        .update(Table)
        .set({
          northPlayerId: null,
          southPlayerId: null,
          eastPlayerId: null,
          westPlayerId: null,
        })
        .execute();

      // Delete all watchers using query builder
      await this.watcherRepository
        .createQueryBuilder()
        .delete()
        .from(TableWatcher)
        .execute();

      this.logger.log('Cleared all users from tables on server restart');
    } catch (error) {
      this.logger.error('Error clearing users from tables:', error);
    }
  }

  async ensureMinimumEmptyTables(minEmpty: number) {
    const emptyCount = await this.tableRepository.count({
      where: {
        northPlayerId: IsNull(),
        southPlayerId: IsNull(),
        eastPlayerId: IsNull(),
        westPlayerId: IsNull(),
      },
    });

    if (emptyCount < minEmpty) {
      const totalCount = await this.tableRepository.count();
      const tablesToCreate = Math.min(minEmpty - emptyCount, 64 - totalCount);

      for (let i = 0; i < tablesToCreate; i++) {
        const maxTableNumber = await this.tableRepository
          .createQueryBuilder('table')
          .select('MAX(table.tableNumber)', 'max')
          .getRawOne();
        
        const nextNumber = (maxTableNumber?.max || 0) + 1;
        
        const newTable = this.tableRepository.create({
          tableNumber: nextNumber,
        });
        await this.tableRepository.save(newTable);
      }
    }
  }

  async findAllWithPlayersAndWatchers(): Promise<TableResponseDto[]> {
    const tables = await this.tableRepository.find({
      relations: ['northPlayer', 'southPlayer', 'eastPlayer', 'westPlayer'],
      order: { tableNumber: 'ASC' },
    });

    const tableDtos: TableResponseDto[] = [];

    for (const table of tables) {
      // Get watchers with user information
      const watchers = await this.watcherRepository.find({
        where: { table: { id: table.id } },
        relations: ['user'],
      });

      const watcherCount = watchers.length;

      // Check if there's an active game for this table
      const activeGame = await this.gameService.getGameByTableId(table.id);
      const activeGameId = activeGame && activeGame.state !== 'complete' ? activeGame.id : undefined;

      // Include playerTypes, gameState, and playerNames if there's an active game
      const playerTypes = activeGame && activeGame.state !== 'complete' ? activeGame.playerTypes : undefined;
      const gameState = activeGame && activeGame.state !== 'complete' ? activeGame.state : undefined;
      const playerNames = activeGame && activeGame.state !== 'complete' ? activeGame.playerNames : undefined;

      tableDtos.push({
        id: table.id,
        tableNumber: table.tableNumber,
        positions: {
          north: table.northPlayer ? this.mapPlayerDto(table.northPlayer) : undefined,
          south: table.southPlayer ? this.mapPlayerDto(table.southPlayer) : undefined,
          east: table.eastPlayer ? this.mapPlayerDto(table.eastPlayer) : undefined,
          west: table.westPlayer ? this.mapPlayerDto(table.westPlayer) : undefined,
        },
        watcherCount,
        activeGameId,
        watchers: watchers.map(w => this.mapPlayerDto(w.user)),
        playerTypes,
        gameState,
        playerNames,
      });
    }

    return tableDtos;
  }

  async joinTable(tableId: string, userId: string, position: Position): Promise<void> {
    // Use a transaction to ensure atomicity
    const queryRunner = this.tableRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Get the target table
      let table = await queryRunner.manager.findOne(Table, { where: { id: tableId } });
      if (!table) {
        throw new BadRequestException('Table not found');
      }

      // Check if position is available
      const positionField = `${position}PlayerId`;
      if (table[positionField] && table[positionField] !== userId) {
        throw new BadRequestException('Position already taken');
      }

      // Remove user from ALL positions on ALL tables within the transaction
      const allTables = await queryRunner.manager.find(Table);
      for (const t of allTables) {
        let modified = false;
        if (t.northPlayerId === userId) {
          t.northPlayerId = null;
          t.northPlayer = null;
          modified = true;
        }
        if (t.southPlayerId === userId) {
          t.southPlayerId = null;
          t.southPlayer = null;
          modified = true;
        }
        if (t.eastPlayerId === userId) {
          t.eastPlayerId = null;
          t.eastPlayer = null;
          modified = true;
        }
        if (t.westPlayerId === userId) {
          t.westPlayerId = null;
          t.westPlayer = null;
          modified = true;
        }
        
        if (modified) {
          await queryRunner.manager.save(Table, t);
        }
      }

      // Remove user from watching ALL tables (within transaction)
      await queryRunner.manager.delete(TableWatcher, { user: { id: userId } });

      // Reload the target table with fresh data
      table = await queryRunner.manager.findOne(Table, { where: { id: tableId } });
      if (!table) {
        throw new BadRequestException('Table not found');
      }

      // Assign user to the new position
      (table as any)[positionField] = userId;
      await queryRunner.manager.save(table);

      // Commit the transaction
      await queryRunner.commitTransaction();

      // Check if there's a game in 'new' state and replace computer with human
      try {
        const game = await this.gameService.getCurrentGameForTable(tableId);
        if (game && game.state === 'new') {
          // Get user details for the username
          const user = await queryRunner.manager.findOne(User, { where: { id: userId } });
          if (user) {
            await this.gameService.replaceComputerWithHuman(game.id, position as any, user.username);
          }
        }
      } catch (error) {
        console.error('Error replacing computer with human:', error);
        // Don't fail the join operation if this fails
      }

      // Ensure minimum empty tables (outside transaction)
      await this.ensureMinimumEmptyTables(3);

      // Emit update via gateway
      if (this.gateway) {
        this.gateway.emitTableUpdate();
      }
    } catch (error) {
      // Rollback on error
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      // Release the query runner
      await queryRunner.release();
    }
  }

  async leaveTable(tableId: string, userId: string): Promise<void> {
    const table = await this.tableRepository.findOne({ 
      where: { id: tableId },
      relations: ['northPlayer', 'southPlayer', 'eastPlayer', 'westPlayer']
    });
    if (!table) {
      console.error('Table not found:', tableId);
      throw new BadRequestException('Table not found');
    }

    // Determine which position the user is leaving
    let leavingPosition: Position | null = null;
    
    // Remove user from position (set both ID and relation to null)
    let positionRemoved = false;
    if (table.northPlayerId === userId) {
      table.northPlayerId = null;
      table.northPlayer = null;
      positionRemoved = true;
      leavingPosition = 'north';
    }
    if (table.southPlayerId === userId) {
      table.southPlayerId = null;
      table.southPlayer = null;
      positionRemoved = true;
      leavingPosition = 'south';
    }
    if (table.eastPlayerId === userId) {
      table.eastPlayerId = null;
      table.eastPlayer = null;
      positionRemoved = true;
      leavingPosition = 'east';
    }
    if (table.westPlayerId === userId) {
      table.westPlayerId = null;
      table.westPlayer = null;
      positionRemoved = true;
      leavingPosition = 'west';
    }

    if (!positionRemoved) {
      console.warn('User was not at this table:', userId);
    }

    await this.tableRepository.save(table);

    // Check if there's a game for this table
    try {
      const game = await this.gameService.getCurrentGameForTable(tableId);
      if (game) {
        if (game.state === 'new' && leavingPosition) {
          // Check if this is the last human player
          const humanPlayerCount = 
            (table.northPlayerId && game.playerTypes.north === 'human' ? 1 : 0) +
            (table.southPlayerId && game.playerTypes.south === 'human' ? 1 : 0) +
            (table.eastPlayerId && game.playerTypes.east === 'human' ? 1 : 0) +
            (table.westPlayerId && game.playerTypes.west === 'human' ? 1 : 0);
          
          if (humanPlayerCount === 0) {
            // No human players left, delete the game
            await this.gameService.deleteGame(game.id);
          } else {
            // Replace human with computer in 'new' state
            await this.gameService.replaceHumanWithComputer(game.id, leavingPosition as any);
          }
        } else {
          // Check if all human players have left in other states
          const hasHumanPlayers = 
            (table.northPlayerId && game.playerTypes.north === 'human') ||
            (table.southPlayerId && game.playerTypes.south === 'human') ||
            (table.eastPlayerId && game.playerTypes.east === 'human') ||
            (table.westPlayerId && game.playerTypes.west === 'human');

          if (!hasHumanPlayers) {
            await this.gameService.deleteGame(game.id);
          }
        }
      }
    } catch (error) {
      console.error('Error handling game when player left:', error);
      // Game might not exist, that's ok
    }

    // Emit update via gateway
    if (this.gateway) {
      this.gateway.emitTableUpdate();
    }
  }

  async addWatcher(tableId: string, userId: string): Promise<void> {
    // Check if user is already watching this specific table
    const existingWatch = await this.watcherRepository.findOne({
      where: {
        table: { id: tableId },
        user: { id: userId },
      },
    });

    // If already watching this table, remove them (toggle off)
    if (existingWatch) {
      await this.watcherRepository.delete({
        table: { id: tableId },
        user: { id: userId },
      });

      // Emit update via gateway
      if (this.gateway) {
        this.gateway.emitTableUpdate();
      }
      return;
    }

    // Remove user from watching ALL other tables
    await this.watcherRepository.delete({ user: { id: userId } });

    // Remove user from all table positions (if they are a player)
    const allTables = await this.tableRepository.find();
    for (const table of allTables) {
      let modified = false;
      if (table.northPlayerId === userId) {
        table.northPlayerId = null;
        table.northPlayer = null;
        modified = true;
      }
      if (table.southPlayerId === userId) {
        table.southPlayerId = null;
        table.southPlayer = null;
        modified = true;
      }
      if (table.eastPlayerId === userId) {
        table.eastPlayerId = null;
        table.eastPlayer = null;
        modified = true;
      }
      if (table.westPlayerId === userId) {
        table.westPlayerId = null;
        table.westPlayer = null;
        modified = true;
      }
      
      if (modified) {
        await this.tableRepository.save(table);
      }
    }

    // Add user as watcher to the specified table
    const watcher = this.watcherRepository.create({
      table: { id: tableId },
      user: { id: userId },
    });
    await this.watcherRepository.save(watcher);

    // Emit update via gateway
    if (this.gateway) {
      this.gateway.emitTableUpdate();
    }
  }

  async removeWatcher(tableId: string, userId: string): Promise<void> {
    await this.watcherRepository.delete({
      table: { id: tableId },
      user: { id: userId },
    });

    // Emit update via gateway
    if (this.gateway) {
      this.gateway.emitTableUpdate();
    }
  }

  async setTableCount(targetCount: number): Promise<void> {
    const currentTables = await this.tableRepository.find({
      order: { tableNumber: 'ASC' },
    });
    const currentCount = currentTables.length;

    if (targetCount < currentCount) {
      // Remove tables starting from highest table number
      const tablesToRemove = currentTables.slice(targetCount);
      
      for (const table of tablesToRemove) {
        // Delete any games associated with this table
        try {
          const game = await this.gameService.getCurrentGameForTable(table.id);
          if (game) {
            await this.gameService.deleteGame(game.id);
          }
        } catch (error) {
          // Game might not exist, continue
        }

        // Remove watchers
        await this.watcherRepository.delete({ table: { id: table.id } });

        // Delete the table (players will be removed via cascade or explicitly set to null)
        await this.tableRepository.delete(table.id);
      }

      // Emit update via gateway
      if (this.gateway) {
        this.gateway.emitTableUpdate();
      }
    } else if (targetCount > currentCount) {
      // Add new tables
      const tablesToCreate = targetCount - currentCount;
      
      for (let i = 0; i < tablesToCreate; i++) {
        const maxTableNumber = await this.tableRepository
          .createQueryBuilder('table')
          .select('MAX(table.tableNumber)', 'max')
          .getRawOne();
        
        const nextNumber = (maxTableNumber?.max || 0) + 1;
        
        const newTable = this.tableRepository.create({
          tableNumber: nextNumber,
        });
        await this.tableRepository.save(newTable);
      }

      // Emit update via gateway
      if (this.gateway) {
        this.gateway.emitTableUpdate();
      }
    }

    // Ensure at least 3 empty tables after adjustment
    await this.ensureMinimumEmptyTables(3);
  }

  async getPreferences(): Promise<SitePreferences> {
    let preferences = await this.preferencesRepository.findOne({ where: {} });
    
    if (!preferences) {
      // Create default preferences if they don't exist
      preferences = this.preferencesRepository.create({
        tableCount: 3,
        dealAnimationTime: 10000,
      });
      await this.preferencesRepository.save(preferences);
    }
    
    return preferences;
  }

  async setPreferences(updates: { tableCount?: number; dealAnimationTime?: number; trickAnimationTime?: number; trickDisplayDelay?: number; bidWinnerMessageTime?: number }): Promise<void> {
    let preferences = await this.preferencesRepository.findOne({ where: {} });
    
    if (!preferences) {
      preferences = this.preferencesRepository.create({
        tableCount: 3,
        dealAnimationTime: 10000,
        trickAnimationTime: 1000,
        trickDisplayDelay: 2000,
        bidWinnerMessageTime: 1000,
      });
    }
    
    if (updates.tableCount !== undefined) {
      preferences.tableCount = updates.tableCount;
      await this.setTableCount(updates.tableCount);
    }
    
    if (updates.dealAnimationTime !== undefined) {
      preferences.dealAnimationTime = updates.dealAnimationTime;
    }
    
    if (updates.trickAnimationTime !== undefined) {
      preferences.trickAnimationTime = updates.trickAnimationTime;
    }
    
    if (updates.trickDisplayDelay !== undefined) {
      preferences.trickDisplayDelay = updates.trickDisplayDelay;
    }
    
    if (updates.bidWinnerMessageTime !== undefined) {
      preferences.bidWinnerMessageTime = updates.bidWinnerMessageTime;
    }
    
    await this.preferencesRepository.save(preferences);
    
    // Emit update via gateway if animation time changed
    if (updates.dealAnimationTime !== undefined && this.gateway) {
      this.gateway.emitTableUpdate();
    }
  }

  private mapPlayerDto(user: any): PlayerDto {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  /**
   * Remove a user from all tables and watcher positions (used for heartbeat timeout)
   */
  async removeUserFromAllTables(userId: string): Promise<void> {
    const queryRunner = this.tableRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Remove user from all table positions
      const allTables = await queryRunner.manager.find(Table);
      let tablesModified = false;

      for (const table of allTables) {
        let modified = false;
        if (table.northPlayerId === userId) {
          table.northPlayerId = null;
          table.northPlayer = null;
          modified = true;
        }
        if (table.southPlayerId === userId) {
          table.southPlayerId = null;
          table.southPlayer = null;
          modified = true;
        }
        if (table.eastPlayerId === userId) {
          table.eastPlayerId = null;
          table.eastPlayer = null;
          modified = true;
        }
        if (table.westPlayerId === userId) {
          table.westPlayerId = null;
          table.westPlayer = null;
          modified = true;
        }

        if (modified) {
          await queryRunner.manager.save(table);
          tablesModified = true;
        }
      }

      // Remove user from all watcher positions
      await queryRunner.manager
        .createQueryBuilder()
        .delete()
        .from(TableWatcher)
        .where('userId = :userId', { userId })
        .execute();

      await queryRunner.commitTransaction();

      // Emit table update if any tables were modified
      if (tablesModified && this.gateway) {
        this.gateway.emitTableUpdate();
      }
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
