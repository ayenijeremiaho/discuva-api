import { IsNotEmpty, IsString, Matches } from 'class-validator';

// Same shape as RegisterCommunicationProviderDto, minus channel — giving
// providers aren't split by channel, they're just payment vendors.
export class RegisterGivingProviderDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9_-]+$/, {
    message: 'id must be lowercase letters, numbers, hyphens, underscores',
  })
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}
