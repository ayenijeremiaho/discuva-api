import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ConvertStatusEnum } from '../enum/convert-status.enum';

export class CreateConvertDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(ConvertStatusEnum)
  status?: ConvertStatusEnum;
}

export class LogFollowUpDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class UpdateConvertStatusDto {
  @IsEnum(ConvertStatusEnum)
  status: ConvertStatusEnum;
}

export class ReassignConvertDto {
  @IsUUID()
  workerProfileId: string;
}

export class LinkConvertToMemberDto {
  @IsUUID()
  memberId: string;
}
