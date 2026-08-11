import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PlanFeature } from '../enum/plan-feature.enum';
import { COUNTS_TOWARD_LIMIT_KEY } from '../decorator/counts-toward-limit.decorator';
import { AppClsStore } from '../../tenant/interface/tenant-cls-store.interface';
import { FeatureUsageService } from '../service/feature-usage.service';
import { PlanFeatureResolverService } from '../service/plan-feature-resolver.service';

// Registered globally (see billing.module.ts) — a no-op for every route
// except the ones explicitly marked @CountsTowardLimit. PlanGuard already
// did the pre-check (rejecting the request if the cap was already hit);
// this only fires the increment, and only once the handler has actually
// succeeded — a request that throws never reaches the tap(), so a failed
// create never spends a use.
@Injectable()
export class PlanLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
    private readonly planFeatureResolver: PlanFeatureResolverService,
    private readonly featureUsageService: FeatureUsageService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const feature = this.reflector.getAllAndOverride<PlanFeature>(
      COUNTS_TOWARD_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!feature) return next.handle();

    const tenantId = this.cls.get('tenantId');
    if (!tenantId) return next.handle();

    return next.handle().pipe(
      tap(() => {
        // Fire-and-forget, same convention as a cache write after a
        // mutation — the response has already been decided, this just
        // records the usage. tryConsume's own WHERE count < limit keeps it
        // safe against two concurrent creates both slipping past the
        // guard's read-only pre-check.
        void this.consumeIfLimited(tenantId, feature);
      }),
    );
  }

  private async consumeIfLimited(
    tenantId: string,
    feature: PlanFeature,
  ): Promise<void> {
    const { featureLimits } = await this.planFeatureResolver.resolve(tenantId);
    const limit = featureLimits[feature];
    if (limit == null) return;
    await this.featureUsageService.tryConsume(tenantId, feature, limit);
  }
}
