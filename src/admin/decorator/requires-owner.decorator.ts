import { SetMetadata } from '@nestjs/common';

export const REQUIRES_OWNER_KEY = 'requiresOwner';
export const RequiresOwner = () => SetMetadata(REQUIRES_OWNER_KEY, true);
