export enum SessionSurface {
  MEMBER = 'MEMBER',
  ADMIN = 'ADMIN',
  // A network overseer's short read-only pass into a branch; never has a session or refresh token.
  OVERSEER = 'OVERSEER',
}
