import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { MarketplaceService } from './marketplace.service';

@Injectable()
export class OrderOwnerGuard implements CanActivate {
  constructor(private readonly marketplace: MarketplaceService) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();
    const data = context.switchToWs().getData<{ orderId?: unknown }>();
    const userId = userIdFromSocket(client);
    const orderId = data?.orderId;
    if (!userId) {
      throw new WsException('anonymous');
    }
    if (
      typeof orderId !== 'string' ||
      orderId.length === 0 ||
      !this.marketplace.isOwner(orderId, userId)
    ) {
      throw new WsException('forbidden');
    }
    return true;
  }
}

export function userIdFromSocket(client: Socket): string | null {
  const userId = (client.handshake.auth as { userId?: unknown } | undefined)
    ?.userId;
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}
