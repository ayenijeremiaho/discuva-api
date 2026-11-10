export enum PhotoRemovalReason {
  NOT_A_PERSON = 'NOT_A_PERSON',
  OFFENSIVE = 'OFFENSIVE',
  SOMEONE_ELSE = 'SOMEONE_ELSE',
  OTHER = 'OTHER',
}

export const PHOTO_REMOVAL_REASON_TEXT: Record<PhotoRemovalReason, string> = {
  [PhotoRemovalReason.NOT_A_PERSON]: "it isn't a photo of you",
  [PhotoRemovalReason.OFFENSIVE]: "it isn't suitable for church",
  [PhotoRemovalReason.SOMEONE_ELSE]: 'it shows someone else',
  [PhotoRemovalReason.OTHER]: 'of the reason below',
};
