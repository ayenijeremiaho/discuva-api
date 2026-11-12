import { Inject, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { ClsService } from 'nestjs-cls';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
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
import { GameService, GameSessionStatePayload } from '../service/game.service';
import { createCorsOriginValidator } from '../../tenant/utility/cors-origin-validator';
import { runInTenantContext } from '../../tenant/utility/run-in-tenant-context';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { Tenant } from '../../tenant/entity/tenant.entity';
import { JwtPayload } from '../../auth/interface/auth.interface';
import refreshJwtConfig from '../../config/refresh.jwt.config';

interface JoinSessionPayload {
  sessionCode: string;
}

interface ResolvedTenant {
  tenantId: string;
  schemaName: string;
}

// The join outcome the client's ack callback receives directly, in
// response to its own emit — see handleJoin's own comment for why this
// replaced a fire-and-forget session:state/session:error pair.
type JoinAck =
  { ok: true; state: GameSessionStatePayload } | { ok: false; message: string };

// Read-only broadcast channel, mirrors ServiceSessionGateway — the only
// "write" this socket carries is which room a client is watching. Answer
// submission stays a normal audited REST call (POST .../answer), not a
// socket message, matching this codebase's discipline of never letting
// scored/audited actions bypass the REST+guard layer.
//
// Every message here previously ran gameService.getSessionState() with NO
// tenant context at all — TenantMiddleware is HTTP-route-only
// (tenant.module.ts's `.forRoutes('*')`), so it never touches WebSocket
// traffic. That meant every tenant-scoped repository call from this
// gateway fell through to whatever the default (public-schema) connection
// resolves to — `public.game_sessions` is a dead legacy table, so
// getSessionOrThrow always threw NotFoundException, join always failed
// silently, and no client ever actually received a session:state push.
// handleConnection now resolves a real tenant before any join is
// attempted, exactly the gap that broke it.
@WebSocketGateway({
  namespace: '/game-session',
  cors: { origin: createCorsOriginValidator() },
})
export class GameSessionGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameSessionGateway.name);

  constructor(
    private readonly gameService: GameService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly jwtService: JwtService,
    @Inject(refreshJwtConfig.KEY)
    private readonly jwtRefreshConfig: ConfigType<typeof refreshJwtConfig>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  afterInit() {}

  // Two identity paths, matching the two real clients: an authenticated
  // admin (present panel) presents a JWT, which already carries both
  // tenantId and schemaName as claims (see JwtPayload's own doc comment) —
  // no extra DB lookup needed. The public, unauthenticated projector
  // screen has no token at all, so it presents the tenant subdomain
  // instead (the same value discuva-admin's screen page carries in its
  // own `?t=` link param) and we resolve it via the plain public-schema
  // Tenant repo. Never rejects the connection either way — an
  // unresolvable tenant just means handleJoin below has nothing to join
  // and reports that as a failed ack there, not at the transport level.
  // A join can arrive before the church lookup below finishes; it waits for it.
  private readonly identified = new WeakMap<Socket, Promise<void>>();

  handleConnection(client: Socket): Promise<void> {
    const ready = this.identify(client);
    this.identified.set(client, ready);
    return ready;
  }

  private async identify(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    const tenantSubdomain = client.handshake.auth?.tenantSubdomain as
      string | undefined;

    let resolved: ResolvedTenant | null = null;
    if (token) {
      resolved =
        (await this.verifyTenantClaim(token)) ??
        (await this.verifyTenantClaim(token, this.jwtRefreshConfig.secret));
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

  // Returns its result directly rather than manually emitting — Nest's
  // WsAdapter sends a handler's return value back as the ack argument of
  // whichever emit call triggered it, *when* the caller provided a
  // callback (both client hooks now do). This replaced an earlier version
  // that emitted session:state (success) or session:error (failure) as
  // separate, un-correlated events instead: the client had to infer "did
  // MY join specifically succeed" from listening for events that could,
  // in principle, arrive for a different reason entirely, and a session
  // that had nothing happen on it since the join (a fresh, empty lobby —
  // the common case) triggered neither event, leaving the client with no
  // signal at all. An ack is inherently tied to this one request/response,
  // so there's no separate "did I miss the event" class of bug to have.
  @SubscribeMessage('joinSession')
  async handleJoin(
    @MessageBody() payload: JoinSessionPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<JoinAck> {
    if (!payload?.sessionCode) {
      return { ok: false, message: 'Missing session code' };
    }
    await this.identified.get(client);
    const tenantId = client.data.tenantId as string | undefined;
    const schemaName = client.data.schemaName as string | undefined;
    if (!tenantId || !schemaName) {
      this.logger.warn(
        `Rejected socket join for ${payload.sessionCode} — no tenant could be resolved for this connection`,
      );
      return { ok: false, message: 'Session not found or expired' };
    }

    let state: GameSessionStatePayload;
    try {
      state = await runInTenantContext(
        this.cls,
        this.txHost,
        { tenantId, schemaName },
        () => this.gameService.getSessionState(payload.sessionCode),
      );
    } catch {
      this.logger.warn(
        `Rejected socket join for unknown game session ${payload.sessionCode}`,
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

  // Always called from inside the HTTP request that just performed the
  // mutation (see AdminGameController/GameParticipantController), so the
  // CLS tenant context TenantMiddleware already established for that
  // request is still active here — no separate resolution needed.
  broadcastState(sessionCode: string, state: GameSessionStatePayload): void {
    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return;
    this.server
      .to(this.roomKey(tenantId, sessionCode))
      .emit('session:state', state);
  }

  // Tenant-scoped — sessionCode has no cross-tenant uniqueness guarantee
  // (only a per-schema unique index), so without the tenant segment two
  // different churches' sessions could collide onto the same room.
  private roomKey(tenantId: string, sessionCode: string): string {
    return `game-session:${tenantId}:${sessionCode}`;
  }
}
