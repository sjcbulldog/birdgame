import { Controller, Get, Put, Param, Body, UseGuards, Inject, forwardRef } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { HeartbeatService } from '../gateway/heartbeat.service';
import { TablesGateway } from '../gateway/tables.gateway';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => HeartbeatService))
    private readonly heartbeatService: HeartbeatService,
    @Inject(forwardRef(() => TablesGateway))
    private readonly tablesGateway: TablesGateway,
  ) {}

  @Get()
  async getAllUsers(): Promise<User[]> {
    return this.usersService.findAll();
  }

  @Put(':id/user-type')
  async updateUserType(
    @Param('id') id: string,
    @Body() body: { userType: string },
  ): Promise<User> {
    const user = await this.usersService.updateUserType(id, body.userType);
    
    // If user is being banned, clean them up from the system
    if (body.userType === 'banned') {
      await this.heartbeatService.cleanupUser(id);
      
      // Disconnect their socket if they're connected
      const heartbeatStatus = this.heartbeatService.getHeartbeatStatus();
      const userHeartbeat = heartbeatStatus.find(h => h.userId === id);
      if (userHeartbeat) {
        // Get the socket and disconnect it
        const sockets = await this.tablesGateway.server.fetchSockets();
        const userSocket = sockets.find(s => s.id === userHeartbeat.socketId);
        if (userSocket) {
          userSocket.disconnect(true);
        }
      }
    }
    
    return user;
  }
}
