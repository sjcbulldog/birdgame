import { WebSocketGateway, WebSocketServer, OnGatewayInit, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TablesService } from '../tables/tables.service';
import { HeartbeatService } from './heartbeat.service';
import { UseGuards } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } })
export class TablesGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private tablesService: TablesService,
    private heartbeatService: HeartbeatService,
  ) {}

  afterInit() {
    this.tablesService.setGateway(this);
  }

  async emitTableUpdate() {
    const tables = await this.tablesService.findAllWithPlayersAndWatchers();
    this.server.emit('tableUpdated', tables);
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (data.userId) {
      this.heartbeatService.recordHeartbeat(data.userId, client.id);
    }
    return { event: 'heartbeat', data: { received: true } };
  }
}
