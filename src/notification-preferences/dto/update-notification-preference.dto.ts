import { IsBoolean, IsIn } from 'class-validator';
import { EmailCategory } from '../../utility/email-provider/email-category.enum';
import { MEMBER_NOTIFICATION_CHOICES } from '../constant/member-notification-choices.constant';

export class UpdateNotificationPreferenceDto {
  @IsIn(MEMBER_NOTIFICATION_CHOICES.map((c) => c.category))
  category: EmailCategory;

  @IsBoolean()
  enabled: boolean;
}
