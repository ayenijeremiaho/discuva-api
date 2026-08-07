import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService, GameSessionStatePayload } from '../service/game.service';
import { createCorsOriginValidator } from '../../tenant/utility/cors-origin-validator';

interface JoinSessionPayload {
  sessionCode: string;
}

// Read-only broadcast channel, mirrors ServiceSessionGateway exactly — the
// only "write" this socket carries is which room a client is watching.
// Answer submission stays a normal audited REST call (POST .../answer), not
// a socket message, matching this codebase's discipline of never letting
// scored/audited actions bypass the REST+guard layer.
@WebSocketGateway({
  namespace: '/game-session',
  cors: { origin: createCorsOriginValidator() },
})
export class GameSessionGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameSessionGateway.name);

  constructor(private readonly gameService: GameService) {}

  afterInit() {}

  @SubscribeMessage('joinSession')
  async handleJoin(
    @MessageBody() payload: JoinSessionPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!payload?.sessionCode) return;
    try {
      await this.gameService.getSessionState(payload.sessionCode);
    } catch {
      this.logger.warn(
        `Rejected socket join for unknown game session ${payload.sessionCode}`,
      );
      client.emit('session:error', { message: 'Session not found or expired' });
      return;
    }
    client.join(this.roomKey(payload.sessionCode));
  }

  @SubscribeMessage('leaveSession')
  handleLeave(
    @MessageBody() payload: JoinSessionPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!payload?.sessionCode) return;
    client.leave(this.roomKey(payload.sessionCode));
  }

  broadcastState(sessionCode: string, state: GameSessionStatePayload): void {
    this.server.to(this.roomKey(sessionCode)).emit('session:state', state);
  }

  private roomKey(sessionCode: string): string {
    return `game-session:${sessionCode}`;
  }
}
