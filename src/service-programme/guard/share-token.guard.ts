import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ServiceSessionService } from '../service/service-session.service';

// Gates the public "Programme Manager" share-link routes. The sessionCode
// alone is the read credential (Presentation view); this token is the
// separate write credential, generated per-session and stored in Redis
// alongside the anchor — never exposed via the anchor/state payloads.
@Injectable()
export class ShareTokenGuard implements CanActivate {
  constructor(private readonly sessionSvc: ServiceSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const sessionCode = request.params?.sessionCode;
    const token = request.query?.token;
    await this.sessionSvc.verifyShareToken(sessionCode, token);
    return true;
  }
}
