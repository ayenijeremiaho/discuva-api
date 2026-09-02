import { IsOptional, IsUUID } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateEventConfigDto } from './create-event-config.dto';

// A real class extending PartialType, not `type X = Partial<Y>` — the
// latter compiles to `Object` for reflection purposes, so NestJS's global
// ValidationPipe silently skips validating it entirely (same lesson
// already documented in UpdateClergyTitleDto). defaultVenueId is
// re-declared to also accept an explicit null — needed to clear the venue
// when switching a config from IN_PERSON to ONLINE; PartialType alone only
// ever means "omit to leave unchanged," never "set to nothing."
export class UpdateEventConfigDto extends PartialType(CreateEventConfigDto) {
  @IsOptional()
  @IsUUID()
  defaultVenueId?: string | null;
}
