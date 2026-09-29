import { IsNotEmpty, IsString } from 'class-validator';
import { TenantJobEnvelope } from '../../tenant/utility/job-envelope';
import {
  PushNotificationKey,
  PushVars,
} from '../../notification-catalogue/push-catalogue';

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

// What a job actually sends — wording already resolved.
export interface PushPayload {
  idempotencyKey: string;
  title: string;
  body: string;
  url: string;
}

// Catalogue push: wording comes from PUSH_CATALOGUE, gated by its category's Push switch.
export interface CataloguePush {
  key: PushNotificationKey;
  vars?: PushVars;
  url?: string;
  idempotencyKey: string;
}

// Wording written by an admin (announcements) — not a switchable category.
export type DispatchPush = CataloguePush | PushPayload;

export interface PushJobData extends TenantJobEnvelope {
  memberId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: PushPayload;
}
