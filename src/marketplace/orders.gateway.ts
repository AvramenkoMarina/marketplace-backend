import { UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import {
  ORDER_STATUS_EVENT,
  OrderEventsService,
  orderRoom,
} from './order-events.service';
import { OrderOwnerGuard } from './order-owner.guard';

@WebSocketGateway({ cors: { origin: true } })
export class OrdersGateway implements OnGatewayInit {
  constructor(private readonly events: OrderEventsService) {}

  afterInit(server: Server): void {
    this.events.setFanout((event) => {
      server.to(orderRoom(event.orderId)).emit(ORDER_STATUS_EVENT, {
        id: event.id,
        orderId: event.orderId,
        status: event.status,
      });
    });
  }

  @UseGuards(OrderOwnerGuard)
  @SubscribeMessage('join')
  async join(
    @MessageBody() body: { orderId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: true; room: string }> {
    const room = orderRoom(body.orderId);
    await client.join(room);
    return { ok: true, room };
  }
}
