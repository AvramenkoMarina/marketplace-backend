import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const port = process.env.PORT || '3000';
const base = `http://127.0.0.1:${port}`;
const sameRoom = process.argv.includes('--same-room');
const expectB = sameRoom ? 1 : 0;
const userId = `buyer-${randomUUID()}`;

let aReceived = 0;
let bReceived = 0;
/** @type {import('socket.io-client').Socket | undefined} */
let socketA;
/** @type {import('socket.io-client').Socket | undefined} */
let socketB;

try {
  const orderA = await createOrder(userId);
  const orderB = await createOrder(userId);
  const roomB = sameRoom ? orderA : orderB;

  socketA = await connect(orderA, userId);
  socketB = await connect(roomB, userId);

  let aSeenAt = 0;
  socketA.on('order.status', () => {
    aReceived += 1;
    if (aSeenAt === 0) {
      aSeenAt = Date.now();
    }
  });
  socketB.on('order.status', () => {
    bReceived += 1;
  });

  const updated = await fetch(`${base}/orders/${orderA}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'paid' }),
  });
  if (!updated.ok) {
    throw new Error(
      `status change failed: ${updated.status} ${await updated.text()}`,
    );
  }

  const started = Date.now();
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      const settled = aSeenAt !== 0 && Date.now() - aSeenAt >= 200;
      const timedOut = Date.now() - started >= 3000;
      if (settled || timedOut) {
        clearInterval(timer);
        resolve();
      }
    }, 20);
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  console.log(`A_RECEIVED=${aReceived}`);
  console.log(`B_RECEIVED=${bReceived}`);
  socketA?.close();
  socketB?.close();
}

process.exit(aReceived === 1 && bReceived === expectB ? 0 : 1);

async function createOrder(ownerId) {
  const response = await fetch(`${base}/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      'x-user-id': ownerId,
    },
    body: JSON.stringify({ items: [{ product_id: '1', qty: 1 }] }),
  });
  if (!response.ok) {
    throw new Error(
      `create order failed: ${response.status} ${await response.text()}`,
    );
  }
  const body = await response.json();
  return body.id;
}

function connect(orderId, ownerId) {
  return new Promise((resolve, reject) => {
    const socket = io(base, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      auth: { userId: ownerId },
    });
    let settled = false;
    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.close();
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error(`join timeout for order ${orderId}`)),
      5000,
    );
    socket.on('connect_error', (error) => fail(error));
    socket.on('exception', (payload) => {
      fail(
        new Error(
          `join refused for order ${orderId}: ${JSON.stringify(payload)}`,
        ),
      );
    });
    socket.on('connect', () => {
      socket.emit('join', { orderId }, (ack) => {
        if (settled) {
          return;
        }
        if (!ack || ack.ok !== true) {
          fail(
            new Error(
              `join refused for order ${orderId}: ${JSON.stringify(ack)}`,
            ),
          );
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      });
    });
  });
}
