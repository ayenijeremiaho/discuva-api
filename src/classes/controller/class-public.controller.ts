import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorator/public.decorator';
import { RequiresModule } from '../../church-settings/decorator/requires-module.decorator';
import { ModuleEnabledGuard } from '../../church-settings/guard/module-enabled.guard';
import { ClassesService } from '../service/classes.service';
import { AssignmentService } from '../service/assignment.service';
import { SubmitAssignmentDto } from '../dto/assignment.dto';

// No login required — a guest enrollee has no Member account, so this is
// reachable purely by knowing the enrollment id (emailed to them at
// enrollment time, see ClassesService.sendGuestPortalAccessEmail). Mirrors
// FormPublicController's shape, minus @RequiresPlan — unlike Forms,
// Training Classes isn't plan-gated in this app (no PlanFeature.CLASSES
// exists; ClassesController itself only guards on the module).
// ModuleEnabledGuard still applies since it keys off the tenant resolved
// by TenantMiddleware, not the caller's (nonexistent) auth.
@Public()
@RequiresModule('classes')
@UseGuards(ModuleEnabledGuard)
@Controller('classes/guest')
export class ClassPublicController {
  constructor(
    private readonly classesService: ClassesService,
    private readonly assignmentService: AssignmentService,
  ) {}

  @Get(':enrollmentId')
  async getPortal(@Param('enrollmentId', ParseUUIDPipe) enrollmentId: string) {
    const enrollment =
      await this.classesService.getGuestEnrollmentOrThrow(enrollmentId);
    const { assignments, progress } =
      await this.assignmentService.getForGuestEnrollment(
        enrollment.churchClass.id,
        enrollmentId,
      );

    return {
      class: {
        id: enrollment.churchClass.id,
        name: enrollment.churchClass.name,
        description: enrollment.churchClass.description,
        nextSessionAt: enrollment.churchClass.nextSessionAt,
        meetingLink: enrollment.churchClass.meetingLink,
        materials: (enrollment.churchClass.materials ?? []).map((m) => ({
          id: m.id,
          title: m.title,
          url: m.url,
          resourceType: m.resourceType,
        })),
      },
      guest: {
        firstName: enrollment.guest!.firstName,
        lastName: enrollment.guest!.lastName,
      },
      assignments,
      progress,
    };
  }

  // Rate-limited — this is an open, unauthenticated write endpoint.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post(':enrollmentId/assignments/:assignmentId/submit')
  submit(
    @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: SubmitAssignmentDto,
  ) {
    return this.assignmentService.submitAsGuest(
      assignmentId,
      enrollmentId,
      dto,
    );
  }
}
