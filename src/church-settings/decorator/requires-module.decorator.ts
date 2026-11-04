import { SetMetadata } from '@nestjs/common';

export const MODULE_KEY = 'module_key';
// Several keys means any one of them is enough; the handler then checks the one it needs.
export const RequiresModule = (key: string | string[]) =>
  SetMetadata(MODULE_KEY, key);
