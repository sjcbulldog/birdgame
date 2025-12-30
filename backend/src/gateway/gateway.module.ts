import { Module } from '@nestjs/common';
import { TablesGateway } from './tables.gateway';
import { TablesModule } from '../tables/tables.module';

@Module({
  imports: [TablesModule],
  providers: [TablesGateway],
})
export class GatewayModule {}
