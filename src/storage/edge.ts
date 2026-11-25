import { createServer, type Server } from 'node:http';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';

type Cached = { body: Buffer; contentType: string; cacheControl: string };

/**
 * Local stand-in for CloudFront + OAC: the edge reads the private bucket with
 * its own credentials, the browser never does. Cache-Control is taken from the
 * object. Without it the edge stores nothing, so the second request is a miss.
 */
export function startEdge(options: {
  port: number;
  client: S3Client;
  bucket: string;
}): Promise<Server> {
  const cache = new Map<string, Cached>();
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'GET' || !req.url) {
        res.writeHead(405);
        res.end();
        return;
      }
      const key = decodeURIComponent(req.url.split('?')[0].replace(/^\//, ''));
      if (!key.startsWith('assets/') || key.includes('..')) {
        res.writeHead(403);
        res.end();
        return;
      }
      const hit = cache.get(key);
      if (hit) {
        res.writeHead(200, {
          'content-type': hit.contentType,
          'cache-control': hit.cacheControl,
          'x-cache': 'HIT',
        });
        res.end(hit.body);
        return;
      }
      try {
        const object = await options.client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        );
        const body = Buffer.from(await object.Body!.transformToByteArray());
        const cacheControl = object.CacheControl ?? '';
        const contentType = object.ContentType ?? 'application/octet-stream';
        if (isPubliclyCacheable(cacheControl)) {
          cache.set(key, { body, contentType, cacheControl });
        }
        res.writeHead(200, {
          'content-type': contentType,
          'cache-control': cacheControl,
          'x-cache': 'MISS',
        });
        res.end(body);
      } catch (err) {
        const status =
          (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ?? 502;
        res.writeHead(status);
        res.end();
      }
    })();
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

function isPubliclyCacheable(cacheControl: string): boolean {
  if (!/public/i.test(cacheControl)) return false;
  const match = /max-age=(\d+)/i.exec(cacheControl);
  return match !== null && Number(match[1]) > 0;
}
