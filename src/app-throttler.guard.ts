import { Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard } from '@nestjs/throttler';
import { rateLimitKey } from './utility/rate-limit-key';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  // Per member when signed in, else per visitor (see rate-limit-key.ts). Kept on the request so logs can show it.
  protected getTracker(req: Record<string, any>): Promise<string> {
    const { key, label } = rateLimitKey(req as any);
    req.rateLimitLabel = label;
    return Promise.resolve(key);
  }

  protected throwThrottlingException(): Promise<void> {
    throw new ThrottlerException('Too many requests. Please try again later.');
  }
}
