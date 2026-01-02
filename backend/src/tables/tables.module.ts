import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
import { Table } from './entities/table.entity';
import { TableWatcher } from './entities/table-watcher.entity';
import { SitePreferences } from './entities/site-preferences.entity';
import { UsersModule } from '../users/users.module';
import { GameModule } from '../game/game.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Table, TableWatcher, SitePreferences]),
    forwardRef(() => UsersModule),
    forwardRef(() => GameModule),
  ],
  controllers: [TablesController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
