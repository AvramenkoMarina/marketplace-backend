import { connect, type ChannelModel } from 'amqplib';

export function brokerUrl(): string {
  const url = process.env.BROKER_URL;
  if (!url || (!url.startsWith('amqp://') && !url.startsWith('amqps://'))) {
    throw new Error('BROKER_URL must start with amqp:// or amqps://');
  }
  if (/[?&]heartbeat=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}heartbeat=5`;
}

export async function connectBroker(): Promise<ChannelModel> {
  const conn = await connect(brokerUrl());
  conn.on('error', (err: Error) => {
    if (/closed/i.test(err.message)) return;
    console.error(`broker connection error: ${err.message}`);
  });
  return conn;
}

export async function closeQuietly(
  closable: { close(): Promise<void> } | undefined,
): Promise<void> {
  if (!closable) return;
  try {
    await closable.close();
  } catch {
    // The peer already closed this socket.
  }
}

export async function withBroker<T>(
  fn: (conn: ChannelModel) => Promise<T>,
): Promise<T> {
  const conn = await connectBroker();
  try {
    return await fn(conn);
  } finally {
    await closeQuietly(conn);
  }
}
