import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
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
import { JwtPayload } from '../../auth/interface/auth.interface';
import refreshJwtConfig from '../../config/refresh.jwt.config';

interface JoinSessionPayload {
  sessionCode: string;
}

type ActiveSessionSummary = Awaited<
  ReturnType<ServiceSessionService['getActiveSessions']>
>;

// Read-only broadcast channel — joining a session-code room only requires
// knowing the sessionCode, the exact same trust model as the public
// GET /state and GET /slots/:position REST routes it's meant to replace for
// live viewers. No write actions happen over this gateway; those still go
// through the authenticated/ShareTokenGuard/NamedAccessGuard-gated REST
// endpoints.
//
// handleConnection adds a SEPARATE, additive tenant-room join for clients
// that present a valid JWT — used only for the tenant-wide
// activeSessions:changed broadcast. It never rejects a connection that has
// no/invalid token; anonymous audience/presentation viewers must keep
// working exactly as before.
@WebSocketGateway({
  namespace: '/service-session',
  cors: { origin: createCorsOriginValidator() },
})
export class ServiceSessionGateway
  implements OnGatewayInit, OnGatewayConnection
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ServiceSessionGateway.name);

  constructor(
    private readonly sessionSvc: ServiceSessionService,
    private readonly jwtService: JwtService,
    @Inject(refreshJwtConfig.KEY)
    private readonly jwtRefreshConfig: ConfigType<typeof refreshJwtConfig>,
  ) {}

  afterInit() {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) return;
    const tenantId =
      (await this.verifyTenantClaim(token)) ??
      (await this.verifyTenantClaim(token, this.jwtRefreshConfig.secret));
    if (tenantId) client.join(this.tenantRoomKey(tenantId));
  }

  private async verifyTenantClaim(
    token: string,
    secret?: string | Buffer,
  ): Promise<string | null> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        token,
        secret ? { secret } : undefined,
      );
      return payload.tenantId ?? null;
    } catch {
      return null;
    }
  }

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

  broadcastActiveSessionsChanged(
    tenantId: string,
    sessions: ActiveSessionSummary,
  ): void {
    this.server
      .to(this.tenantRoomKey(tenantId))
      .emit('activeSessions:changed', sessions);
  }

  private roomKey(sessionCode: string): string {
    return `session:${sessionCode}`;
  }

  private tenantRoomKey(tenantId: string): string {
    return `tenant:${tenantId}`;
  }
}
