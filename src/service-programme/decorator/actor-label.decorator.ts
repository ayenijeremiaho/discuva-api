import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Reads the name NamedAccessGuard resolved and stamped onto the request,
// so pm/* controller handlers can pass it through to the service as the
// action log's actorLabel.
export const ActorLabel = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const request = ctx.switchToHttp().getRequest();
    return request.actorLabel ?? null;
  },
);
