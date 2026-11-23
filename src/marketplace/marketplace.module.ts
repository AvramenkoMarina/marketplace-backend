import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { OrderEventsService } from './order-events.service';
import { OrderOwnerGuard } from './order-owner.guard';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';

@Module({
  controllers: [MarketplaceController, OrdersController],
  providers: [
    MarketplaceService,
    OrderEventsService,
    OrdersGateway,
    OrderOwnerGuard,
  ],
})
export class MarketplaceModule {}
