import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../interface/tenant-cls-store.interface';

export interface TenantJobEnvelope {
  tenantId?: string;
  schemaName?: string;
  correlationId?: string;
}

// Spread into every Bull job payload at enqueue time (§4.6). Bull jobs can
// run on a separate worker process minutes or hours later, so tenant
// context has to travel inside the payload — CLS itself doesn't survive
// that hop. Schedulers/crons enqueue jobs outside any request's CLS
// context, so this degrades to {} there rather than throwing.
export function buildJobEnvelope(
  cls: ClsService<AppClsStore>,
): TenantJobEnvelope {
  if (!cls.isActive()) return {};
  return {
    tenantId: cls.get('tenantId'),
    schemaName: cls.get('schemaName'),
    correlationId: cls.getId(),
  };
}
