import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AccessPrincipal } from './jwt-key.service';

type LoginBody = { email?: unknown; password?: unknown };
type RefreshBody = { refresh_token?: unknown };
type LogoutBody = { refresh_token?: unknown };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginBody) {
    if (typeof body?.email !== 'string' || typeof body?.password !== 'string') {
      throw new UnauthorizedException();
    }
    return this.auth.login(body.email, body.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshBody) {
    if (typeof body?.refresh_token !== 'string' || body.refresh_token.length === 0) {
      throw new UnauthorizedException();
    }
    return this.auth.refresh(body.refresh_token);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  logout(@CurrentUser() user: AccessPrincipal, @Body() body: LogoutBody) {
    const refresh =
      typeof body?.refresh_token === 'string' ? body.refresh_token : undefined;
    return this.auth.logout(user, refresh);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AccessPrincipal) {
    return { id: user.sub, role: user.role };
  }
}
