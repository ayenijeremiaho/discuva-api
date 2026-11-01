import { IsBoolean, IsObject, IsOptional } from 'class-validator';
import { ModuleAvailability, Term } from './account-type.constant';

// Keys and values are checked against the dictionary and module list in AccountTypeService.
export class UpdateAccountTypeDto {
  @IsOptional()
  @IsObject()
  terms?: Record<string, Term>;

  @IsOptional()
  @IsObject()
  modules?: Record<string, ModuleAvailability>;

  @IsOptional()
  @IsBoolean()
  signupOpen?: boolean;
}
