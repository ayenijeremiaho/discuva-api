import { IsBoolean } from 'class-validator';

export class NetworkHiddenDto {
  @IsBoolean()
  hidden: boolean;
}
