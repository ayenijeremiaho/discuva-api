import { IsBoolean } from 'class-validator';

export class SetClergyReviewAccessDto {
  @IsBoolean()
  canReviewFeedback: boolean;
}
