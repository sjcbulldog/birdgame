import { WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayDisconnect, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TablesService } from '../tables/tables.service';
import { HeartbeatService } from './heartbeat.service';
import { UseGuards } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } })
export class TablesGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private tablesService: TablesService,
    private heartbeatService: HeartbeatService,
  ) {}

  afterInit() {
    this.tablesService.setGateway(this);
    this.heartbeatService.setGateway(this);
  }

  async handleDisconnect(client: Socket) {
    // Clean up user when socket disconnects
    await this.heartbeatService.removeUserBySocketId(client.id);
  }

  async emitTableUpdate() {
    const tables = await this.tablesService.findAllWithPlayersAndWatchers();
    this.server.emit('tableUpdated', tables);
  }

  async emitLoggedInUsersUpdate() {
    const loggedInUsers = await this.heartbeatService.getLoggedInUsers();
    this.server.emit('loggedInUsersUpdated', loggedInUsers);
  }

  @SubscribeMessage('heartbeat')
  handleHeartbeat(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    if (data.userId) {
      this.heartbeatService.recordHeartbeat(data.userId, client.id);
      // Emit updated logged-in users list
      this.emitLoggedInUsersUpdate();
    }
    return { event: 'heartbeat', data: { received: true } };
  }
}
