import { IsEnum } from 'class-validator';
import { ReactionEmojiEnum } from '../enum/reaction-emoji.enum';

export class ReactToAnnouncementDto {
  @IsEnum(ReactionEmojiEnum)
  emoji: ReactionEmojiEnum;
}
