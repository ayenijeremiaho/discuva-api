import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAdminUserDto } from './admin-user.dto';
import { AdminPermission } from '../enum/admin-permission.enum';

describe('individual permission validation', () => {
  it.each([
    { value: null },
    { value: ['unknown:permission'] },
    { value: [AdminPermission.FORMS_READ, AdminPermission.FORMS_READ] },
    { value: 'forms:read' },
  ])('rejects malformed permission grants: $value', async ({ value }) => {
    const errors = await validate(
      plainToInstance(UpdateAdminUserDto, { additionalPermissions: value }),
    );
    expect(
      errors.some((error) => error.property === 'additionalPermissions'),
    ).toBe(true);
  });
  it('accepts omission and an explicit empty set for removing direct grants', async () => {
    expect(await validate(plainToInstance(UpdateAdminUserDto, {}))).toEqual([]);
    expect(
      await validate(
        plainToInstance(UpdateAdminUserDto, { additionalPermissions: [] }),
      ),
    ).toEqual([]);
  });
});
