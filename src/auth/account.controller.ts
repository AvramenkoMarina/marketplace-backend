import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { MarketplaceService } from '../marketplace/marketplace.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import type { AccessPrincipal } from './jwt-key.service';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

type ProductBody = { name?: unknown; price_cents?: unknown };

@Controller('account')
@UseGuards(AuthGuard)
export class AccountController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Post('orders')
  @HttpCode(HttpStatus.CREATED)
  createOrder(@CurrentUser() user: AccessPrincipal) {
    return this.marketplace.createOwnedOrder(user.sub);
  }

  @Get('orders/:id')
  getOrder(@Param('id') id: string, @CurrentUser() user: AccessPrincipal) {
    return this.marketplace.getOwnedOrder(id, user.sub);
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard)
  @Roles('seller', 'admin')
  createProduct(@Body() body: ProductBody) {
    return this.marketplace.createPrivilegedProduct({
      name: body?.name,
      priceCents: body?.price_cents,
    });
  }
}
