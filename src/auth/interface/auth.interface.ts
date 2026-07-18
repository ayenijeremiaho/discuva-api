import { MemberRoleEnum } from '../../member/enums/member-role.enum';
import { SessionSurface } from '../enum/session-surface.enum';

export interface JwtPayload {
  sub: string;
  role: MemberRoleEnum;
  aud: SessionSurface;
  jti: string;
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
