import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { validate } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { UploadsModule } from './storage/uploads.module';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    DatabaseModule,
    AuthModule,
    MarketplaceModule,
    UploadsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
