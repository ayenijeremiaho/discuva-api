import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpsertProviderConfigDto {
  // Must exist in the communication_providers catalog and match the :channel
  // route param — checked in the service, not here, since it needs a DB read.
  @IsString()
  @IsNotEmpty()
  providerId: string;

  @IsOptional()
  @IsString()
  senderIdentity?: string;

  // Flat string map, e.g. Termii's { apiKey, senderId } — shape is
  // provider-specific and deliberately not typed further here; each
  // ISmsProvider/IEmailProvider implementation is what actually interprets
  // these keys when a send happens.
  @IsObject()
  @IsNotEmpty()
  credentials: Record<string, string>;
}

export class SetProviderActiveDto {
  @IsIn([true, false])
  isActive: boolean;
}
