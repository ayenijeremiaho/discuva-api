import { Provider } from '@nestjs/common';
import { SchedulerGateService } from './scheduler-gate.service';

// In-memory stand-in for the Redis calls the gate makes (tests only).
export function memoryGateCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    getGlobal: jest.fn(async (k: string) => store.get(k)),
    setGlobal: jest.fn(async (k: string, v: unknown) => {
      store.set(k, v);
    }),
    delGlobal: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  };
}

// A real SchedulerGateService over the spec's own tenant repo / CLS mocks, so jobs behave exactly as in production.
export function realGateProvider(
  tenantRepo: unknown,
  cls: unknown,
  cache = memoryGateCache(),
): Provider {
  return {
    provide: SchedulerGateService,
    useFactory: () =>
      new SchedulerGateService(
        cache as never,
        cls as never,
        tenantRepo as never,
      ),
  };
}
