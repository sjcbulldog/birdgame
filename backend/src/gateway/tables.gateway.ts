import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { TablesService } from '../tables/tables.service';

@WebSocketGateway({ cors: { origin: '*' } })
export class TablesGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  constructor(private tablesService: TablesService) {}

  afterInit() {
    this.tablesService.setGateway(this);
  }

  async emitTableUpdate() {
    const tables = await this.tablesService.findAllWithPlayersAndWatchers();
    this.server.emit('tableUpdated', tables);
  }
}
