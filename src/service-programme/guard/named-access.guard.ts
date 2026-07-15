import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ServiceSessionService } from '../service/service-session.service';

// Gates the mutating "pm/*" routes on top of ShareTokenGuard — the share
// token only proves "has the link"; this proves "is a specific named,
// still-active grant", so revoking one person's access doesn't require
// rotating the link for everyone else. Resolves the grant and stamps the
// grant's name onto the request so the controller can pass it through as
// the action log's actorLabel.
@Injectable()
export class NamedAccessGuard implements CanActivate {
  constructor(private readonly sessionSvc: ServiceSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const sessionCode = request.params?.sessionCode;
    const grantToken = request.query?.grantToken;
    const { name } = await this.sessionSvc.resolveGrantToken(
      sessionCode,
      grantToken,
    );
    request.actorLabel = name;
    return true;
  }
}
