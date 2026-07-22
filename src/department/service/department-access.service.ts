import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerProfile } from '../../member/entity/worker-profile.entity';

// Collapses what used to be 7 near-identical assertIsXDeptWorker() methods
// scattered across services (attendance, evangelism, sunday-school,
// prayer-request, service-session, children-church, follow-up) into one
// shared check. Department.key is a free-form string (see Department
// entity's doc comment) — any string a church has assigned to a department
// works here, not just the DepartmentKeyEnum presets.
@Injectable()
export class DepartmentAccessService {
  constructor(
    @InjectRepository(WorkerProfile)
    private readonly workerProfileRepo: Repository<WorkerProfile>,
  ) {}

  async hasDepartmentAccessKey(
    memberId: string,
    key: string,
  ): Promise<boolean> {
    const profile = await this.workerProfileRepo.findOne({
      where: { member: { id: memberId } },
      relations: ['department', 'secondaryDepartment'],
    });
    if (!profile) return false;
    return (
      profile.department?.key === key ||
      profile.secondaryDepartment?.key === key
    );
  }

  async assertHasDepartmentAccessKey(
    memberId: string,
    key: string,
    message?: string,
  ): Promise<void> {
    if (await this.hasDepartmentAccessKey(memberId, key)) return;
    throw new ForbiddenException(
      message ??
        `Only workers in the '${key}' department can perform this action`,
    );
  }
}
