import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { MarketplaceService } from './marketplace.service';
import {
  ORDER_STATUS_EVENT,
  OrderEventsService,
  type OrderStatusEvent,
} from './order-events.service';
import type { Order } from './marketplace.util';

@Controller()
export class OrdersController {
  constructor(
    private readonly marketplace: MarketplaceService,
    private readonly events: OrderEventsService,
  ) {}

  @Patch('orders/:id')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: Order['status'] },
  ) {
    return this.marketplace.updateStatus(id, body.status);
  }

  @Get('orders/:id/events')
  streamStatus(
    @Param('id') id: string,
    @Headers('last-event-id') lastEventId: string | string[] | undefined,
    @Res() res: Response,
  ): void {
    this.marketplace.getOrder(id);

    const afterId = parseLastEventId(lastEventId);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');

    const seen = new Set<number>();
    const write = (event: OrderStatusEvent) => {
      if (event.orderId !== id || event.id <= afterId || seen.has(event.id)) {
        return;
      }
      seen.add(event.id);
      res.write(
        `id: ${event.id}\nevent: ${ORDER_STATUS_EVENT}\ndata: ${JSON.stringify({
          orderId: event.orderId,
          status: event.status,
        })}\n\n`,
      );
    };

    const subscription = this.events.stream().subscribe(write);
    for (const event of this.events.replay(id, afterId)) {
      write(event);
    }

    const close = () => subscription.unsubscribe();
    res.on('close', close);
    res.on('error', close);
  }
}

function parseLastEventId(header: string | string[] | undefined): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw.trim() === '') {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
