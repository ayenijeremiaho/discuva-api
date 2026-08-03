import { of } from 'rxjs';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { TransformInterceptor } from './transform.interceptor';

function buildContext(statusCode: number): ExecutionContext {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

function buildHandler(returnValue: unknown): CallHandler {
  return { handle: () => of(returnValue) } as CallHandler;
}

describe('TransformInterceptor', () => {
  const interceptor = new TransformInterceptor();

  it('wraps a plain object response', (done) => {
    interceptor
      .intercept(buildContext(200), buildHandler({ id: '1' }))
      .subscribe((result) => {
        expect(result).toEqual({
          data: { id: '1' },
          status: 200,
          message: 'Request successful',
        });
        done();
      });
  });

  // The actual bug: a handler deliberately returning `null` (e.g.
  // TenantYoutubeIntegrationService.get() when nothing's configured yet)
  // used to come back as `{}` on the wire — indistinguishable from a real,
  // empty resource — instead of the `null` every frontend `res.data?.data`
  // fallback idiom expects.
  it('preserves a deliberate null response instead of coercing it to {}', (done) => {
    interceptor
      .intercept(buildContext(200), buildHandler(null))
      .subscribe((result) => {
        expect(result).toEqual({
          data: null,
          status: 200,
          message: 'Request successful',
        });
        done();
      });
  });

  it('defaults a genuinely missing (undefined) response to {}', (done) => {
    interceptor
      .intercept(buildContext(204), buildHandler(undefined))
      .subscribe((result) => {
        expect(result).toEqual({
          data: {},
          status: 204,
          message: 'Resource completed successfully',
        });
        done();
      });
  });

  it('lets a handler override status and message via the returned object', (done) => {
    interceptor
      .intercept(
        buildContext(200),
        buildHandler({ id: '1', status: 201, message: 'Created!' }),
      )
      .subscribe((result) => {
        expect(result).toEqual({
          data: { id: '1' },
          status: 201,
          message: 'Created!',
        });
        done();
      });
  });
});
