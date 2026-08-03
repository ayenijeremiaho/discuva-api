export interface PlatformAdminJwtPayload {
  sub: string;
  role: 'platform_admin';
}

export interface PlatformAdminAuth {
  id: string;
  email: string;
  role: 'platform_admin';
  // Loaded once, at JWT validation time (see PlatformAdminAuthService.validateById)
  // rather than a second DB round-trip per request in the guard — this IS
  // the guard's only source of a platform admin's permissions.
  permissions: string[];
}
