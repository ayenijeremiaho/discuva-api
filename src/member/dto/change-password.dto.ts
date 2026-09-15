import { IsString, Matches, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  oldPassword: string;

  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  @Matches(/[A-Z]/, {
    message: 'New password must contain at least one uppercase letter',
  })
  @Matches(/\d/, { message: 'New password must contain at least one number' })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'New password must contain at least one special character',
  })
  newPassword: string;

  @IsString()
  @MinLength(8)
  confirmPassword: string;
}
