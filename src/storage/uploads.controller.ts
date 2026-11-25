import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessPrincipal } from '../auth/jwt-key.service';
import { UploadsService } from './uploads.service';

type IntentBody = {
  contentType?: unknown;
  filename?: unknown;
  size?: unknown;
};

type IdBody = { id?: unknown };

@Controller('uploads')
@UseGuards(AuthGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('intent')
  @HttpCode(HttpStatus.OK)
  intent(
    @CurrentUser() user: AccessPrincipal,
    @Body() body: IntentBody,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.uploads.intent(user.sub, body ?? {}, idempotencyKey);
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  commit(@CurrentUser() user: AccessPrincipal, @Body() body: IdBody) {
    return this.uploads.commit(user.sub, body?.id);
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentUser() user: AccessPrincipal, @Body() body: IdBody) {
    return this.uploads.complete(user.sub, body?.id);
  }
}
