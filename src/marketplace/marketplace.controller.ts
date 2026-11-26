import {
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Res,
  Body,
} from '@nestjs/common';
import type { Response } from 'express';
import { controllerCreateOrder, controllerGetOrder } from '../observability/order-flow';
import { MarketplaceService } from './marketplace.service';

@Controller()
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('products')
  listProducts(
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitRaw === undefined ? 20 : Number(limitRaw);
    return this.marketplace.listProducts(limit, cursor);
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string) {
    return this.marketplace.getProduct(id);
  }

  @Get('orders')
  listOrders(
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitRaw === undefined ? 20 : Number(limitRaw);
    return this.marketplace.listOrders(limit, cursor);
  }

  @Get('orders/:id')
  getOrder(@Param('id') id: string) {
    return controllerGetOrder(id, (orderId) => this.marketplace.getOrder(orderId));
  }

  @Post('orders')
  createOrder(
    @Headers('idempotency-key') key: string,
    @Headers('x-user-id') userId: string | string[] | undefined,
    @Body() body: { items: { product_id: string; qty: number }[] },
    @Res({ passthrough: false }) res: Response,
  ) {
    // Header required перевіряє express-openapi-validator; тут ключ уже є.
    const result = controllerCreateOrder(() =>
      this.marketplace.createOrder(key, body, ownerFromHeader(userId)),
    );
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
    return res.status(result.status).json(result.body);
  }
}

function ownerFromHeader(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}
