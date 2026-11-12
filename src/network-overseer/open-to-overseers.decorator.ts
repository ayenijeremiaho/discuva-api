import { SetMetadata } from '@nestjs/common';

export const OPEN_TO_OVERSEERS = 'openToOverseers';

// An admin route with no permission of its own that an overseer may still read.
export const OpenToOverseers = () => SetMetadata(OPEN_TO_OVERSEERS, true);
