// ServiceProgrammeService pulls in jsdom through SanitizationService.
jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn(),
}));

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ProgrammePlannerGuard } from './programme-planner.guard';

describe('ProgrammePlannerGuard', () => {
  const planning = { canPlan: jest.fn() };
  const guard = new ProgrammePlannerGuard(planning as never);
  const context = (user?: { id: string }) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;

  it('lets a planner through', async () => {
    planning.canPlan.mockResolvedValue(true);
    await expect(guard.canActivate(context({ id: 'm1' }))).resolves.toBe(true);
  });

  it('says how to get access when the member isn’t a planner', async () => {
    planning.canPlan.mockResolvedValue(false);
    await expect(guard.canActivate(context({ id: 'm1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('needs a signed-in member', async () => {
    await expect(guard.canActivate(context())).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
