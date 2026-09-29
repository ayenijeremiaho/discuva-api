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
