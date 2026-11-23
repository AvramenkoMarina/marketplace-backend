import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from './constants';
import type { AccessPrincipal } from './jwt-key.service';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AccessPrincipal }>();
    if (!request.user) {
      throw new UnauthorizedException();
    }
    if (!required.includes(request.user.role)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
