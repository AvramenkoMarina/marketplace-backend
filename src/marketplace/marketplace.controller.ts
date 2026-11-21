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
    return this.marketplace.getOrder(id);
  }

  @Post('orders')
  createOrder(
    @Headers('idempotency-key') key: string,
    @Body() body: { items: { product_id: string; qty: number }[] },
    @Res({ passthrough: false }) res: Response,
  ) {
    // Header required перевіряє express-openapi-validator; тут ключ уже є.
    const result = this.marketplace.createOrder(key, body);
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
    return res.status(result.status).json(result.body);
  }
}
