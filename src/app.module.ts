import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { MarketplaceModule } from './marketplace/marketplace.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    DatabaseModule,
    MarketplaceModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
