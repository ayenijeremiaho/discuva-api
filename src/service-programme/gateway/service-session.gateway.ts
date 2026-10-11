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
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ServiceSessionService,
  SessionStatePayload,
} from '../service/service-session.service';
import { createCorsOriginValidator } from '../../tenant/utility/cors-origin-validator';
import { JwtPayload } from '../../auth/interface/auth.interface';
import refreshJwtConfig from '../../config/refresh.jwt.config';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { Tenant } from '../../tenant/entity/tenant.entity';

interface JoinSessionPayload {
  sessionCode: string;
}

interface ResolvedTenant {
  tenantId: string;
  schemaName: string;
}

type JoinAck =
  { ok: true; state: SessionStatePayload } | { ok: false; message: string };

type ActiveSessionSummary = Awaited<
  ReturnType<ServiceSessionService['getActiveSessions']>
>;

// Read-only broadcast channel — joining a session-code room only requires
// knowing the sessionCode, the same trust model as the public GET /state
// route. Writes stay on the guarded REST endpoints.
//
// TenantMiddleware is HTTP-only, so the tenant is resolved here on connect
// (JWT claim, else handshake tenantSubdomain) — same fix as GameSessionGateway.
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
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  afterInit() {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    const tenantSubdomain = client.handshake.auth?.tenantSubdomain as
      string | undefined;

    let resolved: ResolvedTenant | null = null;
    if (token) {
      resolved =
        (await this.verifyTenantClaim(token)) ??
        (await this.verifyTenantClaim(token, this.jwtRefreshConfig.secret));
      // Only an authenticated client gets the tenant-wide activeSessions feed.
      if (resolved) client.join(this.tenantRoomKey(resolved.tenantId));
    }
    if (!resolved && tenantSubdomain) {
      resolved = await this.resolveBySubdomain(tenantSubdomain);
    }

    if (resolved) {
      client.data.tenantId = resolved.tenantId;
      client.data.schemaName = resolved.schemaName;
    }
  }

  private async verifyTenantClaim(
    token: string,
    secret?: string | Buffer,
  ): Promise<ResolvedTenant | null> {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        token,
        secret ? { secret } : undefined,
      );
      if (!payload.tenantId || !payload.schemaName) return null;
      return { tenantId: payload.tenantId, schemaName: payload.schemaName };
    } catch {
      return null;
    }
  }

  private async resolveBySubdomain(
    subdomain: string,
  ): Promise<ResolvedTenant | null> {
    const tenant = await this.tenantRepo.findOneBy({ subdomain });
    if (!tenant) return null;
    return { tenantId: tenant.id, schemaName: tenant.schemaName };
  }

  @SubscribeMessage('joinSession')
  async handleJoin(
    @MessageBody() payload: JoinSessionPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<JoinAck> {
    if (!payload?.sessionCode) {
      return { ok: false, message: 'Missing session code' };
    }
    const tenantId = client.data.tenantId as string | undefined;
    const schemaName = client.data.schemaName as string | undefined;
    if (!tenantId || !schemaName) {
      this.logger.warn(
        `Rejected socket join for ${payload.sessionCode} — no tenant could be resolved for this connection`,
      );
      return { ok: false, message: 'Session not found or expired' };
    }

    let state: SessionStatePayload;
    try {
      state = await runInTenantContext(
        this.cls,
        this.txHost,
        { tenantId, schemaName },
        () => this.sessionSvc.getState(payload.sessionCode),
      );
    } catch {
      this.logger.warn(
        `Rejected socket join for unknown session ${payload.sessionCode}`,
      );
      return { ok: false, message: 'Session not found or expired' };
    }
    client.join(this.roomKey(tenantId, payload.sessionCode));
    return { ok: true, state };
  }

  @SubscribeMessage('leaveSession')
  handleLeave(
    @MessageBody() payload: JoinSessionPayload,
    @ConnectedSocket() client: Socket,
  ): void {
    if (!payload?.sessionCode) return;
    const tenantId = client.data.tenantId as string | undefined;
    if (!tenantId) return;
    client.leave(this.roomKey(tenantId, payload.sessionCode));
  }

  // Called from inside the mutating HTTP request, so CLS already holds its tenant.
  broadcastState(sessionCode: string, state: SessionStatePayload): void {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return;
    this.server
      .to(this.roomKey(tenantId, sessionCode))
      .emit('session:state', state);
  }

  broadcastActiveSessionsChanged(
    tenantId: string,
    sessions: ActiveSessionSummary,
  ): void {
    this.server
      .to(this.tenantRoomKey(tenantId))
      .emit('activeSessions:changed', sessions);
  }

  // sessionCode is only unique per tenant schema.
  private roomKey(tenantId: string, sessionCode: string): string {
    return `session:${tenantId}:${sessionCode}`;
  }

  private tenantRoomKey(tenantId: string): string {
    return `tenant:${tenantId}`;
  }
}
