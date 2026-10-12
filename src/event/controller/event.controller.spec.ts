import { Test, TestingModule } from '@nestjs/testing';
import { EventController } from './event.controller';
import { EventService } from '../service/event.service';
import { AdminGuard } from '../../admin/guard/admin.guard';

describe('EventController', () => {
  let controller: EventController;
  const eventService = { getAll: jest.fn().mockResolvedValue({ data: [] }) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EventController],
      providers: [{ provide: EventService, useValue: eventService }],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<EventController>(EventController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes only known sort columns and directions to the query', async () => {
    const user = { id: 'm1', surface: 'ADMIN' } as any;
    await controller.getAll(user, {
      orderBy: 'eventDate',
      order: 'ASC',
    } as any);
    expect(eventService.getAll).toHaveBeenLastCalledWith(
      1,
      10,
      'eventDate',
      'ASC',
      expect.anything(),
    );
    await controller.getAll(user, {
      orderBy: 'id; DROP TABLE events',
      order: 'sideways',
    } as any);
    expect(eventService.getAll).toHaveBeenLastCalledWith(
      1,
      10,
      undefined,
      undefined,
      expect.anything(),
    );
  });
});
