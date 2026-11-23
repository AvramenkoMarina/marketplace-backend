import { Module } from '@nestjs/common';
import { AccountController } from '../auth/account.controller';
import { AuthModule } from '../auth/auth.module';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { OrderEventsService } from './order-events.service';
import { OrderOwnerGuard } from './order-owner.guard';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';

@Module({
  imports: [AuthModule],
  controllers: [MarketplaceController, OrdersController, AccountController],
  providers: [
    MarketplaceService,
    OrderEventsService,
    OrdersGateway,
    OrderOwnerGuard,
  ],
})
export class MarketplaceModule {}
