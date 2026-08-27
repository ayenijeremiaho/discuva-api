import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Either enrolls an existing guest (guestId set — the "Existing guest"
// search path in the admin UI) or creates a new one from the profile
// fields (the "New guest" form path) — GuestService.findOrCreateByEmail
// handles both transparently from ClassesService.enrollGuest's perspective.
export class EnrollGuestDto {
  @IsUUID()
  classId: string;

  @IsOptional()
  @IsUUID()
  guestId?: string;

  @ValidateIf((o) => !o.guestId)
  @IsString()
  @MaxLength(50)
  firstName?: string;

  @ValidateIf((o) => !o.guestId)
  @IsString()
  @MaxLength(50)
  lastName?: string;

  @ValidateIf((o) => !o.guestId)
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{7,20}$/, {
    message: 'phone must be 7–20 digits, optionally prefixed with +',
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  churchName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  purpose?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// Bulk-paste only covers the fields needed to identify/create a guest —
// the richer optional profile fields are single-enroll-only, filled in via
// the admin panel afterward if needed.
export class BulkGuestEntryDto {
  @IsString()
  @MaxLength(50)
  firstName: string;

  @IsString()
  @MaxLength(50)
  lastName: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?\d{7,20}$/, {
    message: 'phone must be 7–20 digits, optionally prefixed with +',
  })
  phone?: string;
}

export class BulkEnrollGuestsDto {
  @IsUUID()
  classId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkGuestEntryDto)
  guests: BulkGuestEntryDto[];
}
