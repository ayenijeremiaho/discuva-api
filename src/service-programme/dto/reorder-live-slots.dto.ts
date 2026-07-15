import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SlotOrderItem } from './reorder-programme-slots.dto';

export class ReorderLiveSlotsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SlotOrderItem)
  slots: SlotOrderItem[];
}
