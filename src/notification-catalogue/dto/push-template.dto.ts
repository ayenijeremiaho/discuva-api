import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PUSH_BODY_MAX, PUSH_TITLE_MAX } from '../push-catalogue';

export class UpdatePushTemplateDto {
  @IsString()
  @MaxLength(PUSH_TITLE_MAX)
  title: string;

  @IsString()
  @MaxLength(PUSH_BODY_MAX)
  body: string;
}

// Optional unsaved draft for "Send me a test"; omitted fields use the saved or default wording.
export class TestPushTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(PUSH_TITLE_MAX)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PUSH_BODY_MAX)
  body?: string;
}

export interface PushTemplateView {
  key: string;
  category: string;
  categoryLabel: string;
  label: string;
  description: string;
  placeholders: Record<string, string>;
  defaultTitle: string;
  defaultBody: string;
  title: string;
  body: string;
  customized: boolean;
  updatedAt: Date | null;
}

export class EmailWordingDto {
  @IsString()
  @MaxLength(150)
  subject: string;

  @IsString()
  @MaxLength(120)
  heading: string;

  @IsString()
  @MaxLength(5000)
  message: string;

  @IsString()
  @MaxLength(3000)
  closing: string;

  @IsString()
  @MaxLength(60)
  signoff: string;

  @IsString()
  @MaxLength(80)
  signature: string;
}

export interface EmailTemplateView {
  key: string;
  category: string | null;
  categoryLabel: string;
  label: string;
  description: string;
  lockedNote: string;
  placeholders: Record<string, string>;
  defaults: Record<string, string>;
  wording: Record<string, string>;
  customized: boolean;
  updatedAt: Date | null;
}

// Unsaved draft for previews and test sends; omitted fields use the saved or default wording.
export class DraftEmailWordingDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  heading?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  closing?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  signoff?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  signature?: string;
}
