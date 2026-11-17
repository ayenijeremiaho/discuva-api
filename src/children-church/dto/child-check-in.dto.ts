import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class ChildCheckInDto {
  @IsUUID('4')
  childId: string;

  @IsUUID('4')
  @IsOptional()
  serviceSlotId?: string;

  @IsUUID('4')
  @IsOptional()
  droppedOffByGuardianId?: string;

  @IsString()
  @IsOptional()
  droppedOffByName?: string;

  // Left out, the child's choice from last time is used.
  @IsBoolean()
  @IsOptional()
  stayingAllServices?: boolean;
}

export class SetStayingDto {
  @IsBoolean()
  staying: boolean;
}
