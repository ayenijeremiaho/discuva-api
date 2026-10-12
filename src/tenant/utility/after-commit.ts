import { Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../interface/tenant-cls-store.interface';

const logger = new Logger('AfterCommit');

// Runs `fn` once the current tenant transaction has committed (dropped on rollback). Outside a
// tenant transaction (no queue in context) it runs straight away.
export function afterCommit(
  cls: ClsService<AppClsStore>,
  fn: () => unknown,
): void {
  const queue = cls.isActive() ? cls.get('afterCommit') : undefined;
  if (queue) queue.push(fn);
  else void Promise.resolve().then(fn);
}

// Called by the transaction wrappers after a successful commit, still inside the tenant context.
export async function flushAfterCommit(
  cls: ClsService<AppClsStore>,
): Promise<void> {
  const queue = cls.get('afterCommit');
  if (!Array.isArray(queue) || queue.length === 0) return;
  cls.set('afterCommit', []);
  for (const fn of queue) {
    try {
      await fn();
    } catch (err) {
      logger.warn(
        `After-commit task failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
