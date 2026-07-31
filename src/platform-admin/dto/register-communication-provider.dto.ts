import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';

export class RegisterCommunicationProviderDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9_-]+$/, {
    message: 'id must be lowercase letters, numbers, hyphens, underscores',
  })
  id: string;

  @IsIn(['sms', 'email'])
  channel: 'sms' | 'email';

  @IsString()
  @IsNotEmpty()
  name: string;
}
