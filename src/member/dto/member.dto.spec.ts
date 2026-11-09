import { instanceToPlain, plainToInstance } from 'class-transformer';
import { MemberDto } from './member.dto';

describe('MemberDto', () => {
  it('keeps hasDiscuvaAccount through response serialising', () => {
    const toJson = (source: object) =>
      instanceToPlain(
        plainToInstance(MemberDto, source, { excludeExtraneousValues: true }),
      );
    expect(toJson({ id: 'm1', discuvaAccountId: 'a1' }).hasDiscuvaAccount).toBe(
      true,
    );
    expect(toJson({ id: 'm2', discuvaAccountId: null }).hasDiscuvaAccount).toBe(
      false,
    );
  });
});
