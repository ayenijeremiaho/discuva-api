import { IsEmail, IsOptional, IsString } from 'class-validator';
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';
import {
  IsNormalizedPhone,
  NormalizePhone,
} from '../../utility/decorators/normalize-phone.decorator';

export class CreateAdminDto {
  @IsString()
  firstname: string;

  @IsString()
  lastname: string;

  @NormalizeEmail()
  @IsEmail()
  email: string;

  @IsOptional()
  @NormalizePhone()
  @IsNormalizedPhone()
  phoneNumber?: string;
}
