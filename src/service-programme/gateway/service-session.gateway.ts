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
import {
  ServiceSessionService,
  SessionStatePayload,
} from '../service/service-session.service';
import { createCorsOriginValidator } from '../../tenant/utility/cors-origin-validator';

interface JoinSessionPayload {
  sessionCode: string;
}

// Read-only broadcast channel — joining a room only requires knowing the
// sessionCode, the exact same trust model as the public GET /state and
// GET /slots/:position REST routes it's meant to replace for live viewers.
// No write actions happen over this gateway; those still go through the
// authenticated/ShareTokenGuard/NamedAccessGuard-gated REST endpoints.
@WebSocketGateway({
  namespace: '/service-session',
  cors: { origin: createCorsOriginValidator() },
})
export class ServiceSessionGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ServiceSessionGateway.name);

  constructor(private readonly sessionSvc: ServiceSessionService) {}

  afterInit() {}

  @SubscribeMessage('joinSession')
  async handleJoin(
    @MessageBody() payload: JoinSessionPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    if (!payload?.sessionCode) return;
    try {
      await this.sessionSvc.getState(payload.sessionCode);
    } catch {
      // Unknown/expired session code — don't let the client join a room
      // that will never receive anything, and don't leak whether the
      // code was merely malformed vs. genuinely never existed.
      this.logger.warn(
        `Rejected socket join for unknown session ${payload.sessionCode}`,
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

  broadcastState(sessionCode: string, state: SessionStatePayload): void {
    this.server.to(this.roomKey(sessionCode)).emit('session:state', state);
  }

  private roomKey(sessionCode: string): string {
    return `session:${sessionCode}`;
  }
}
