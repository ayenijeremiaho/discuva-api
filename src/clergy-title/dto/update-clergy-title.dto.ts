import { PartialType } from '@nestjs/mapped-types';
import { CreateClergyTitleDto } from './create-clergy-title.dto';

// A real class extending PartialType, not `type X = Partial<Y>` — the
// latter compiles to `Object` for reflection purposes, so NestJS's global
// ValidationPipe silently skips validating it entirely (no whitelist
// stripping, no @MaxLength enforcement) since it can't resolve a real
// class to instantiate/validate against. Confirmed this is what would
// have happened here: PATCH /clergy-titles/:id needs the same length cap
// as POST enforces, not just a client-side suggestion.
export class UpdateClergyTitleDto extends PartialType(CreateClergyTitleDto) {}
