import { ForbiddenException } from '@nestjs/common';
import { ClassTrainingController } from './class-training.controller';
import { ClassFacilitatorAccessService } from '../service/class-facilitator-access.service';
import { EnrollmentStatusEnum } from '../enum/enrollment-status.enum';

const user = { id: 'm1' } as any;

describe('ClassTrainingController', () => {
  const sessions = {
    listSessions: jest.fn(),
    createSession: jest.fn(),
    createSeries: jest.fn(),
    updateSession: jest.fn(),
    deleteSession: jest.fn(),
    getRoster: jest.fn(),
    markAttendance: jest.fn(),
    scheduleForEnrollment: jest.fn(),
  };
  const progress = { classProgress: jest.fn(), progressFor: jest.fn() };
  const facilitators = {
    assertFacilitator: jest.fn(),
    assertSessionFacilitator: jest.fn(),
    assertAssignmentFacilitator: jest.fn(),
    assertSubmissionFacilitator: jest.fn(),
    myClasses: jest.fn(),
  };
  const joinRequests = { joinStatus: jest.fn(), request: jest.fn() };
  const certificates = { pdf: jest.fn(), issueAll: jest.fn() };
  const reports = { summary: jest.fn(), exportWorkbook: jest.fn() };
  const assignments = {
    gradeAsFacilitator: jest.fn(),
    getSubmissions: jest.fn(),
    getForClassWithCounts: jest.fn(),
  };
  const controller = new ClassTrainingController(
    sessions as any,
    progress as any,
    facilitators as any,
    joinRequests as any,
    certificates as any,
    reports as any,
    assignments as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(facilitators).forEach((fn) =>
      fn.mockResolvedValue(undefined),
    );
  });

  it('facilitator actions check the caller facilitates that class first', async () => {
    await controller.facilitatorMark('s1', { attendances: [] }, user);
    expect(facilitators.assertSessionFacilitator).toHaveBeenCalledWith(
      'm1',
      's1',
    );
    expect(sessions.markAttendance).toHaveBeenCalledWith(
      's1',
      { attendances: [] },
      { memberId: 'm1' },
    );

    await controller.facilitatorGrade('sub1', { score: 8 } as any, user);
    expect(facilitators.assertSubmissionFacilitator).toHaveBeenCalledWith(
      'm1',
      'sub1',
    );
    expect(assignments.gradeAsFacilitator).toHaveBeenCalledWith(
      'sub1',
      { score: 8 },
      'm1',
    );

    await controller.facilitatorCreateSeries(
      'c1',
      { startDate: '2026-10-04' } as any,
      user,
    );
    expect(facilitators.assertFacilitator).toHaveBeenCalledWith('m1', 'c1');
  });

  it('a non-facilitator never reaches the action', async () => {
    facilitators.assertSessionFacilitator.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      controller.facilitatorMark('s1', { attendances: [] }, user),
    ).rejects.toThrow(ForbiddenException);
    expect(sessions.markAttendance).not.toHaveBeenCalled();

    facilitators.assertFacilitator.mockRejectedValue(new ForbiddenException());
    await expect(controller.facilitatorProgress('c1', user)).rejects.toThrow(
      ForbiddenException,
    );
    expect(progress.classProgress).not.toHaveBeenCalled();
  });

  it('members not on a class see its schedule but no attendance or progress', async () => {
    joinRequests.joinStatus.mockResolvedValue({
      enrollmentId: null,
      enrollmentStatus: null,
    });
    sessions.listSessions.mockResolvedValue([
      { id: 's1', attendance: { present: 9 } },
    ]);

    await expect(controller.myProgress('c1', user)).resolves.toEqual({
      enrolled: false,
      schedule: [{ id: 's1' }],
      progress: null,
      rules: null,
      join: { enrollmentId: null, enrollmentStatus: null },
    });
  });

  it('enrolled members get their own marks and progress only', async () => {
    joinRequests.joinStatus.mockResolvedValue({
      enrollmentId: 'e1',
      enrollmentStatus: EnrollmentStatusEnum.IN_PROGRESS,
    });
    sessions.listSessions.mockResolvedValue([{ id: 's1' }]);
    sessions.scheduleForEnrollment.mockResolvedValue([
      { id: 's1', myStatus: 'PRESENT' },
    ]);
    progress.progressFor.mockResolvedValue(
      new Map([
        [
          'c1',
          {
            rules: { minAttendancePercent: 75 },
            people: [{ enrollmentId: 'e1', attendancePercent: 80 }],
          },
        ],
      ]),
    );

    const result = await controller.myProgress('c1', user);
    expect(progress.progressFor).toHaveBeenCalledWith(['c1'], ['e1']);
    expect(progress.classProgress).not.toHaveBeenCalled();
    expect(sessions.listSessions).toHaveBeenCalledWith('c1', false);
    expect(sessions.scheduleForEnrollment).toHaveBeenCalledWith(
      { id: 'e1', churchClass: { id: 'c1' } },
      [{ id: 's1' }],
    );
    expect(result).toEqual({
      enrolled: true,
      schedule: [{ id: 's1', myStatus: 'PRESENT' }],
      progress: { enrollmentId: 'e1', attendancePercent: 80 },
      rules: { minAttendancePercent: 75 },
      join: expect.objectContaining({ enrollmentId: 'e1' }),
    });
  });

  it('members download only their own certificate', async () => {
    certificates.pdf.mockResolvedValue({
      buffer: Buffer.from('pdf'),
      filename: 'c.pdf',
    });
    const res = { set: jest.fn(), end: jest.fn() } as any;
    await controller.myCertificate('e1', user, res);
    expect(certificates.pdf).toHaveBeenCalledWith('e1', { memberId: 'm1' });
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Content-Type': 'application/pdf' }),
    );
  });
});

describe('ClassFacilitatorAccessService', () => {
  const facilitatorRepo = { exists: jest.fn() };
  const sessionRepo = { findOne: jest.fn() };
  const service = new ClassFacilitatorAccessService(
    facilitatorRepo as any,
    {} as any,
    {} as any,
    sessionRepo as any,
    {} as any,
    {} as any,
  );

  it('only lets a class facilitator through', async () => {
    facilitatorRepo.exists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    await expect(
      service.assertFacilitator('m1', 'c1'),
    ).resolves.toBeUndefined();
    await expect(service.assertFacilitator('m1', 'c1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(facilitatorRepo.exists).toHaveBeenCalledWith({
      where: { churchClass: { id: 'c1' }, member: { id: 'm1' } },
    });
  });

  it("checks a session's class", async () => {
    sessionRepo.findOne.mockResolvedValue({
      id: 's1',
      churchClass: { id: 'c9' },
    });
    facilitatorRepo.exists.mockResolvedValue(true);
    await service.assertSessionFacilitator('m1', 's1');
    expect(facilitatorRepo.exists).toHaveBeenLastCalledWith({
      where: { churchClass: { id: 'c9' }, member: { id: 'm1' } },
    });
  });
});
