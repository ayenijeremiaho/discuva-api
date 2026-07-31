import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';
import { DepartmentCapability } from '../enums/department-capability.enum';

// Collapses what used to be 7 near-identical assertIsXDeptWorker() methods
// scattered across services (attendance, evangelism, sunday-school,
// prayer-request, service-session, children-church, follow-up) into one
// shared check. A member has a capability if either their primary or
// secondary department's capabilities array includes it.
@Injectable()
export class DepartmentAccessService {
  constructor(
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepo: Repository<WorkerProfile>,
  ) {}

  async hasCapability(
    memberId: string,
    capability: DepartmentCapability,
  ): Promise<boolean> {
    const profile = await this.workerProfileRepo.findOne({
      where: { member: { id: memberId } },
      relations: ['department', 'secondaryDepartment'],
    });
    if (!profile) return false;
    return (
      !!profile.department?.capabilities?.includes(capability) ||
      !!profile.secondaryDepartment?.capabilities?.includes(capability)
    );
  }

  async assertHasCapability(
    memberId: string,
    capability: DepartmentCapability,
    message?: string,
  ): Promise<void> {
    if (await this.hasCapability(memberId, capability)) return;
    throw new ForbiddenException(
      message ??
        `Only workers in a department with the '${capability}' capability can perform this action`,
    );
  }
}
