import { IsNotEmpty, IsString } from 'class-validator';
import { TenantJobEnvelope } from '../../tenant/utility/job-envelope';

export class SubscribePushDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

export interface PushPayload {
  idempotencyKey: string;
  title: string;
  body: string;
  url: string;
}

export interface PushJobData extends TenantJobEnvelope {
  memberId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: PushPayload;
}
