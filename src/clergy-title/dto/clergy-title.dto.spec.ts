import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateClergyTitleDto } from './create-clergy-title.dto';
import { UpdateClergyTitleDto } from './update-clergy-title.dto';

// Guards two things: the 40-char cap itself (added so a very long title
// can't distort the small badge UI it renders in — see
// docs/TECH_DOC.md), and that UpdateClergyTitleDto actually enforces it.
// UpdateClergyTitleDto used to be `type X = Partial<CreateClergyTitleDto>`
// — a plain type alias compiles to `Object` for reflection purposes, so
// NestJS's global ValidationPipe (main.ts) silently skips validating it
// entirely, since it can't resolve a real class to instantiate against.
// Converting it to `class UpdateClergyTitleDto extends
// PartialType(CreateClergyTitleDto) {}` fixes that; this test would have
// caught the regression either way, since it validates the DTO directly
// with class-validator rather than going through a mocked service.
describe('CreateClergyTitleDto', () => {
  it('accepts a name at the 40-char limit', async () => {
    const dto = plainToInstance(CreateClergyTitleDto, {
      name: 'A'.repeat(40),
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects a name over 40 characters', async () => {
    const dto = plainToInstance(CreateClergyTitleDto, {
      name: 'A'.repeat(41),
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateClergyTitleDto', () => {
  it('rejects a name over 40 characters on update, not just create', async () => {
    const dto = plainToInstance(UpdateClergyTitleDto, {
      name: 'A'.repeat(41),
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows a partial update with just description', async () => {
    const dto = plainToInstance(UpdateClergyTitleDto, {
      description: 'Updated description',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });
});
