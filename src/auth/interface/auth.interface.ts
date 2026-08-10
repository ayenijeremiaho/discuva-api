import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { SessionSurface } from '../enum/session-surface.enum';

export interface JwtPayload {
  sub: string;
  role: MemberRoleEnum;
  aud: SessionSurface;
  jti: string;
  // Set on every token, both surfaces — lets TenantMiddleware resolve a
  // tenant for a request whose Host header carries no subdomain: either
  // discuva-admin's fixed admin.discuva.org origin (shared by every
  // tenant, no wildcard at all), or discuva-member's calls to the
  // dedicated api.discuva.org (a real per-tenant wildcard, but a separate
  // one from where its API calls actually land — see TenantMiddleware's
  // own doc comment for why this is safe: the claim is read from an
  // already-verified JWT signature, never trusted from a raw
  // client-supplied header). discuva-member's OWN hosting still resolves
  // its identity from a real Host header, same as always — this claim only
  // matters for the API-call side, not how the member app itself is
  // reached.
  tenantId?: string;
  schemaName?: string;
}

export interface JwtResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  requires_password_change: boolean;
}

export interface MemberAuth {
  id: string;
  role: MemberRoleEnum;
  requiresPasswordChange: boolean;
  surface: SessionSurface;
  workerProfileId?: string;
  jti?: string;
  tokenExp?: number;
  // Set only when a refresh request replayed a just-rotated token within the
  // reuse grace window — refreshToken() returns this instead of rotating again.
  replayedTokens?: JwtResponse;
}
