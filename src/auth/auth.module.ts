import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { JwtKeyService } from './jwt-key.service';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [JwtKeyService, AuthService, AuthGuard, RolesGuard],
  exports: [AuthService, AuthGuard, RolesGuard],
})
export class AuthModule {}
