import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateWorkerProfileDto } from './update-worker-profile.dto';

describe('UpdateWorkerProfileDto', () => {
  it('treats blank year, profession and department as not provided', async () => {
    const dto = plainToInstance(UpdateWorkerProfileDto, {
      departmentId: '',
      profession: '',
      yearJoinedWorkforce: '',
      completedSOD: true,
    });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.yearJoinedWorkforce).toBeUndefined();
    expect(dto.departmentId).toBeUndefined();
  });

  it('still rejects a malformed year', async () => {
    const dto = plainToInstance(UpdateWorkerProfileDto, {
      yearJoinedWorkforce: '21',
    });

    const errors = await validate(dto);
    expect(errors[0].property).toBe('yearJoinedWorkforce');
  });
});
