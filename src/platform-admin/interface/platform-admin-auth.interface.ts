export interface PlatformAdminJwtPayload {
  sub: string;
  role: 'platform_admin';
}

export interface PlatformAdminAuth {
  id: string;
  email: string;
  role: 'platform_admin';
}
