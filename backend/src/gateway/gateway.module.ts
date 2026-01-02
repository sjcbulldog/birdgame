import { Module, forwardRef } from '@nestjs/common';
import { TablesGateway } from './tables.gateway';
import { TablesModule } from '../tables/tables.module';
import { UsersModule } from '../users/users.module';
import { HeartbeatService } from './heartbeat.service';

@Module({
  imports: [
    forwardRef(() => TablesModule),
    forwardRef(() => UsersModule),
  ],
  providers: [TablesGateway, HeartbeatService],
  exports: [HeartbeatService, TablesGateway],
})
export class GatewayModule {}
