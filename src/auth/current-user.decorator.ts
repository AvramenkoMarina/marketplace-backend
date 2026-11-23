import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AccessPrincipal } from './jwt-key.service';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessPrincipal => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AccessPrincipal }>();
    return request.user;
  },
);
