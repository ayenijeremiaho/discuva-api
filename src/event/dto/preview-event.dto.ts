import { IsOptional, IsUUID } from 'class-validator';
import { CreateEventDto } from './create-event.dto';

// The create body, plus the event being edited when previewing a change to one date.
export class PreviewEventDto extends CreateEventDto {
  @IsOptional()
  @IsUUID()
  eventId?: string;
}
