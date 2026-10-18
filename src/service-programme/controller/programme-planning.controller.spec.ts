// ServiceProgrammeService pulls in jsdom through SanitizationService.
jest.mock('../../utility/service/sanitization.service', () => ({
  SanitizationService: jest.fn(),
}));

import { ProgrammePlanningController } from './programme-planning.controller';
import { ServiceSlotTypeEnum } from '../enum/service-slot-type.enum';

describe('ProgrammePlanningController', () => {
  const view = {
    id: 'p1',
    status: 'DRAFT',
    event: { id: 'e1', name: 'Sunday Service', eventDate: new Date() },
    service: {
      id: 's1',
      name: 'First Service',
      startTime: new Date(),
      endTime: new Date(),
    },
    items: [],
    totalMinutes: 0,
  };
  const planning = {
    view: jest.fn().mockResolvedValue(view),
    audit: jest.fn(),
  };
  const programmes = {
    addSlot: jest
      .fn()
      .mockResolvedValue({ id: 'i1', conflictWarning: undefined }),
    saveAsNamedTemplate: jest
      .fn()
      .mockResolvedValue({ id: 't1', name: 'Standard Sunday', replaced: true }),
    downloadPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
    downloadEventPdf: jest.fn().mockResolvedValue({
      buffer: Buffer.from('%PDF'),
      eventName: 'Sunday Service',
    }),
  };
  const controller = new ProgrammePlanningController(
    planning as never,
    programmes as never,
  );
  const user = { id: 'm1' } as never;
  const target = { id: 'p1', name: 'Sunday Service — First Service' };
  const res = () => ({ setHeader: jest.fn(), end: jest.fn() });

  beforeEach(() => jest.clearAllMocks());

  it('logs an added item against the service', async () => {
    await controller.addItem(user, 'p1', {
      type: ServiceSlotTypeEnum.SPEAKER,
      topic: 'Sermon',
      allocatedMinutes: 40,
    });
    expect(planning.audit).toHaveBeenCalledWith(
      'PROGRAMME_ITEM_ADDED',
      'm1',
      target,
      { item: 'i1', topic: 'Sermon' },
    );
  });

  it('saves a template and logs whether it replaced one', async () => {
    await expect(
      controller.saveTemplate(user, 'p1', { name: ' Standard Sunday ' }),
    ).resolves.toEqual(expect.objectContaining({ replaced: true }));
    expect(programmes.saveAsNamedTemplate).toHaveBeenCalledWith(
      'p1',
      'Standard Sunday',
    );
    expect(planning.audit).toHaveBeenCalledWith(
      'PROGRAMME_TEMPLATE_SAVED',
      'm1',
      target,
      {
        template: 'Standard Sunday',
        replaced: true,
      },
    );
  });

  it('sends the PDF with a readable file name, and logs the download', async () => {
    const r = res();
    await controller.pdf(user, 'p1', r as never);
    expect(r.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="sunday-service-first-service.pdf"',
    );
    expect(planning.audit).toHaveBeenCalledWith(
      'PROGRAMME_PDF_DOWNLOADED',
      'm1',
      target,
    );
  });

  it('logs a whole-event PDF download', async () => {
    const r = res();
    await controller.eventPdf(user, 'e1', r as never);
    expect(planning.audit).toHaveBeenCalledWith(
      'PROGRAMME_PDF_DOWNLOADED',
      'm1',
      { id: 'e1', name: 'Sunday Service' },
      { scope: 'event' },
    );
  });
});
