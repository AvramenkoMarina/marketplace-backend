import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export const ORDER_STATUS_EVENT = 'order.status';

const BUFFER_LIMIT = 200;

export type OrderStatusEvent = {
  id: number;
  orderId: string;
  status: string;
};

export function orderRoom(orderId: string): string {
  return `orders:${orderId}`;
}

@Injectable()
export class OrderEventsService {
  private readonly nextId = new Map<string, number>();
  private readonly buffer: OrderStatusEvent[] = [];
  private readonly events$ = new Subject<OrderStatusEvent>();
  private fanout: ((event: OrderStatusEvent) => void) | null = null;

  setFanout(fanout: (event: OrderStatusEvent) => void): void {
    this.fanout = fanout;
  }

  publish(orderId: string, status: string): OrderStatusEvent {
    const id = (this.nextId.get(orderId) ?? 0) + 1;
    this.nextId.set(orderId, id);
    const event: OrderStatusEvent = { id, orderId, status };
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_LIMIT) {
      this.buffer.shift();
    }
    this.events$.next(event);
    this.fanout?.(event);
    return event;
  }

  replay(orderId: string, afterId: number): OrderStatusEvent[] {
    return this.buffer.filter(
      (event) => event.orderId === orderId && event.id > afterId,
    );
  }

  stream(): Observable<OrderStatusEvent> {
    return this.events$.asObservable();
  }
}
