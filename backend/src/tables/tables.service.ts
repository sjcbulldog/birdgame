import { Injectable, OnModuleInit, BadRequestException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Table } from './entities/table.entity';
import { TableWatcher } from './entities/table-watcher.entity';
import { SitePreferences } from './entities/site-preferences.entity';
import { Position } from './types/position.type';
import { TableResponseDto, PlayerDto } from './dto/table-response.dto';
import { GameService } from '../game/game.service';

@Injectable()
export class TablesService implements OnModuleInit {
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
    await this.initializeTables();
  }

  private async initializeTables() {
    const count = await this.tableRepository.count();
    if (count === 0) {
      await this.ensureMinimumEmptyTables(3);
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

    // Remove user from position (set both ID and relation to null)
    let positionRemoved = false;
    if (table.northPlayerId === userId) {
      table.northPlayerId = null;
      table.northPlayer = null;
      positionRemoved = true;
    }
    if (table.southPlayerId === userId) {
      table.southPlayerId = null;
      table.southPlayer = null;
      positionRemoved = true;
    }
    if (table.eastPlayerId === userId) {
      table.eastPlayerId = null;
      table.eastPlayer = null;
      positionRemoved = true;
    }
    if (table.westPlayerId === userId) {
      table.westPlayerId = null;
      table.westPlayer = null;
      positionRemoved = true;
    }

    if (!positionRemoved) {
      console.warn('User was not at this table:', userId);
    }

    await this.tableRepository.save(table);

    // Check if there's a game for this table and delete it if no human players remain
    try {
      const game = await this.gameService.getCurrentGameForTable(tableId);
      if (game) {
        // Check if all human players have left
        const hasHumanPlayers = 
          (table.northPlayerId && game.playerTypes.north === 'human') ||
          (table.southPlayerId && game.playerTypes.south === 'human') ||
          (table.eastPlayerId && game.playerTypes.east === 'human') ||
          (table.westPlayerId && game.playerTypes.west === 'human');

        if (!hasHumanPlayers) {
          await this.gameService.deleteGame(game.id);
        }
      }
    } catch (error) {
      // Game might not exist, that's ok
    }

    // Emit update via gateway
    if (this.gateway) {
      this.gateway.emitTableUpdate();
    }
  }

  private async removeUserFromAllTables(userId: string): Promise<void> {
    const tables = await this.tableRepository.find();
    let anyModified = false;
    
    for (const table of tables) {
      let modified = false;
      if (table.northPlayerId === userId) {
        table.northPlayerId = null;
        modified = true;
      }
      if (table.southPlayerId === userId) {
        table.southPlayerId = null;
        modified = true;
      }
      if (table.eastPlayerId === userId) {
        table.eastPlayerId = null;
        modified = true;
      }
      if (table.westPlayerId === userId) {
        table.westPlayerId = null;
        modified = true;
      }
      
      if (modified) {
        await this.tableRepository.save(table);
        anyModified = true;
      }
    }
    
    // Emit update if any tables were modified
    if (anyModified && this.gateway) {
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

  async setPreferences(updates: { tableCount?: number; dealAnimationTime?: number }): Promise<void> {
    let preferences = await this.preferencesRepository.findOne({ where: {} });
    
    if (!preferences) {
      preferences = this.preferencesRepository.create({
        tableCount: 3,
        dealAnimationTime: 10000,
      });
    }
    
    if (updates.tableCount !== undefined) {
      preferences.tableCount = updates.tableCount;
      await this.setTableCount(updates.tableCount);
    }
    
    if (updates.dealAnimationTime !== undefined) {
      preferences.dealAnimationTime = updates.dealAnimationTime;
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
}
