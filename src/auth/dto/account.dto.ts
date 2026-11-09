import {
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail } from '../../utility/decorators/normalize-email.decorator';
import { SignupDto } from '../../member/dto/signup.dto';
import { OmitType } from '@nestjs/mapped-types';

export class AccountCodeDto {
  @IsString()
  @Length(6, 6)
  code: string;
}

// Global Profile: agreeing to share the person's Discuva profile with this church.
export class LinkConfirmDto extends AccountCodeDto {
  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}

export class ConfirmDetailsDto {
  // Field name to the value the person keeps: their profile's or this church's.
  @IsObject()
  choices: Record<string, 'YOURS' | 'HERE'>;
}

export class JoinStartDto {
  @NormalizeEmail()
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  deviceId: string;
}

export class JoinVerifyDto extends JoinStartDto {
  @IsString()
  @Length(6, 6)
  code: string;
}

// Name and details are only read for someone new to Discuva; an existing account brings its own.
export class JoinCompleteDto extends OmitType(SignupDto, [
  'email',
  'firstname',
  'lastname',
] as const) {
  @IsString()
  @MaxLength(128)
  joinToken: string;

  @IsOptional()
  @IsBoolean()
  consent?: boolean;

  @IsString()
  @MinLength(8)
  deviceId: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastname?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/[A-Z]/, {
    message: 'Password must contain at least one uppercase letter',
  })
  @Matches(/\d/, { message: 'Password must contain at least one number' })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'Password must contain at least one special character',
  })
  password?: string;
}

export class SwitchChurchDto {
  @IsUUID()
  tenantId: string;
}

export class HandoffDto {
  @IsString()
  @MaxLength(128)
  token: string;

  @IsString()
  @MinLength(8)
  deviceId: string;
}

export class AccountLinkTokenDto {
  @IsUUID()
  accountId: string;

  @IsString()
  @Length(64, 64)
  token: string;
}

export class RecoverAccountStartDto {
  @NormalizeEmail()
  @IsEmail()
  newEmail: string;
}

export class RecoverAccountConfirmDto extends RecoverAccountStartDto {
  @IsString()
  @Length(6, 6)
  code: string;
}

export class ConfirmDeviceRequestDto extends JoinStartDto {
  @IsString()
  @MaxLength(128)
  password: string;
}

export class ConfirmDeviceDto extends ConfirmDeviceRequestDto {
  @IsString()
  @Length(6, 6)
  code: string;
}
