import { IsEnum } from 'class-validator';
import { EventOverlapRule } from '../enums/event-overlap-rule.enum';

export class UpdateEventOverlapRuleDto {
  @IsEnum(EventOverlapRule)
  rule: EventOverlapRule;
}
