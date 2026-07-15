import { IsInt, Max, Min } from 'class-validator';

export class AdjustSessionTimeDto {
  @IsInt()
  @Min(-3600)
  @Max(3600)
  deltaSeconds: number;
}
