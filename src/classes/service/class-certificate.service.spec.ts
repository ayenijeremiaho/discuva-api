import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClassCertificateService } from './class-certificate.service';

describe('ClassCertificateService', () => {
  const enrollmentRepo = {
    query: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((v) => Promise.resolve(v)),
  };
  const auditLog = { log: jest.fn() };
  const classesService = { issueCertificate: jest.fn() };
  const pdfService = { generateClassCertificate: jest.fn() };
  const notifications = { notifyMember: jest.fn() };
  const service = new ClassCertificateService(
    enrollmentRepo as any,
    classesService as any,
    pdfService as any,
    notifications as any,
    auditLog as any,
  );

  const issued = {
    id: 'e1',
    certificateIssued: true,
    certificateNumber: 'CERT-2026-0007',
    completedAt: new Date('2026-04-12T10:00:00Z'),
    member: { id: 'm1', firstname: 'Ada', lastname: 'Obi' },
    churchClass: {
      id: 'c1',
      name: "Believers' Class — Jan 2026",
      classType: { name: "Believers' Class" },
      facilitators: [
        { order: 1, member: null, guestName: 'Visiting Minister' },
        { order: 0, member: { firstname: 'Tunde', lastname: 'Bello' } },
      ],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    notifications.notifyMember.mockResolvedValue(undefined);
    pdfService.generateClassCertificate.mockResolvedValue(Buffer.from('pdf'));
  });

  it('numbers certificates CERT-YEAR-NNNN, following on from the highest so far', async () => {
    enrollmentRepo.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ certificate_number: 'CERT-2026-0041' }]);
    await expect(service.nextNumber(2026)).resolves.toBe('CERT-2026-0042');
    expect(enrollmentRepo.query.mock.calls[0][0]).toContain(
      'pg_advisory_xact_lock',
    );

    enrollmentRepo.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);
    await expect(service.nextNumber(2027)).resolves.toBe('CERT-2027-0001');
  });

  it('issues with the next number when none is given, and tells the member', async () => {
    jest.spyOn(service, 'nextNumber').mockResolvedValue('CERT-2026-0008');
    classesService.issueCertificate.mockResolvedValue({ id: 'e1' });
    enrollmentRepo.findOne.mockResolvedValue({
      ...issued,
      certificateNumber: 'CERT-2026-0008',
    });

    await service.issue('e1', undefined, 'actor');

    expect(classesService.issueCertificate).toHaveBeenCalledWith(
      'e1',
      { certificateNumber: 'CERT-2026-0008' },
      'actor',
    );
    expect(notifications.notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        push: expect.objectContaining({
          memberIds: ['m1'],
          key: 'CLASS_CERTIFICATE_READY',
        }),
      }),
    );
  });

  it('keeps a number the admin typed', async () => {
    classesService.issueCertificate.mockResolvedValue({ id: 'e1' });
    enrollmentRepo.findOne.mockResolvedValue(issued);
    const next = jest.spyOn(service, 'nextNumber');
    await service.issue('e1', ' BC/2026/17 ', 'actor');
    expect(next).not.toHaveBeenCalled();
    expect(classesService.issueCertificate).toHaveBeenCalledWith(
      'e1',
      { certificateNumber: 'BC/2026/17' },
      'actor',
    );
  });

  it('issues to everyone completed without one in one batch: one lock, one save, one push', async () => {
    const cls = { id: 'c1', name: 'Believers Jan' };
    const ada = {
      id: 'e1',
      member: { id: 'm1', firstname: 'Ada', lastname: 'Obi', email: 'a@x.org' },
      churchClass: cls,
    };
    const guest = {
      id: 'e2',
      guest: {
        id: 'g1',
        firstName: 'Chidi',
        lastName: 'Eze',
        email: 'c@x.org',
      },
      churchClass: cls,
    };
    enrollmentRepo.find.mockResolvedValue([ada, guest]);
    enrollmentRepo.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { certificate_number: `CERT-${new Date().getFullYear()}-0009` },
      ]);

    await expect(service.issueAll('c1', 'actor')).resolves.toEqual({
      issued: 2,
    });

    const year = new Date().getFullYear();
    expect(enrollmentRepo.query).toHaveBeenCalledTimes(2);
    expect(enrollmentRepo.save).toHaveBeenCalledTimes(1);
    expect(
      enrollmentRepo.save.mock.calls[0][0].map((e: any) => e.certificateNumber),
    ).toEqual([`CERT-${year}-0010`, `CERT-${year}-0011`]);
    expect(auditLog.log).toHaveBeenCalledTimes(2);
    expect(notifications.notifyMember).toHaveBeenCalledTimes(1);
    expect(notifications.notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        push: expect.objectContaining({
          memberIds: ['m1'],
          key: 'CLASS_CERTIFICATE_READY',
        }),
      }),
    );
  });

  it('issue-all with nobody waiting does nothing', async () => {
    enrollmentRepo.find.mockResolvedValue([]);
    await expect(service.issueAll('c1', 'actor')).resolves.toEqual({
      issued: 0,
    });
    expect(enrollmentRepo.query).not.toHaveBeenCalled();
  });

  it('draws the PDF with facilitators in order as signatories', async () => {
    enrollmentRepo.findOne.mockResolvedValue(issued);
    const { filename } = await service.pdf('e1');
    expect(pdfService.generateClassCertificate).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientName: 'Ada Obi',
        classTypeName: "Believers' Class",
        certificateNumber: 'CERT-2026-0007',
        signatories: ['Tunde Bello', 'Visiting Minister'],
        completedOn: expect.stringMatching(/12 April 2026/),
      }),
    );
    expect(filename).toBe('certificate-ada-obi-believers-class-jan-2026.pdf');
  });

  it('only gives members their own, guests theirs, and only once issued', async () => {
    enrollmentRepo.findOne.mockResolvedValue(issued);
    await expect(
      service.pdf('e1', { memberId: 'someone-else' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.pdf('e1', { guestOnly: true })).rejects.toThrow(
      NotFoundException,
    );
    enrollmentRepo.findOne.mockResolvedValue({
      ...issued,
      certificateIssued: false,
    });
    await expect(service.pdf('e1')).rejects.toThrow(BadRequestException);
  });
});
