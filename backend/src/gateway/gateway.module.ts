import { Module, forwardRef } from '@nestjs/common';
import { TablesGateway } from './tables.gateway';
import { TablesModule } from '../tables/tables.module';
import { HeartbeatService } from './heartbeat.service';

@Module({
  imports: [forwardRef(() => TablesModule)],
  providers: [TablesGateway, HeartbeatService],
  exports: [HeartbeatService],
})
export class GatewayModule {}
