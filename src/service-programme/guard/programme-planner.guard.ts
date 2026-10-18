import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { MemberAuth } from '../../auth/interface/auth.interface';
import { ProgrammePlanningService } from '../service/programme-planning.service';

// Member-app programme editing: admins with programme edit access, or Service Programme Planning workers.
@Injectable()
export class ProgrammePlannerGuard implements CanActivate {
  constructor(private readonly planning: ProgrammePlanningService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user: MemberAuth | undefined = context
      .switchToHttp()
      .getRequest().user;
    if (!user?.id) throw new UnauthorizedException();
    if (await this.planning.canPlan(user.id)) return true;
    throw new ForbiddenException(
      'Only programme planners can do this. Ask an admin to give your department Service Programme Planning.',
    );
  }
}
