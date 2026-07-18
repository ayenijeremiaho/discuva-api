import { IsNotEmpty, IsString } from 'class-validator';

export class SegmentCountDto {
  @IsString()
  @IsNotEmpty()
  message: string;
}
