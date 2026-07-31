import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';

export class PlatformAdminLoginDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
