import { z } from 'zod';
import { isEs256PrivateKeyPem, isEs256PublicKeyPem } from './pem';

const optionalEnvString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().positive().default(3000),

  DB_URL: z
    .string()
    .min(1, 'DB_URL is required')
    .refine(
      (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
      'DB_URL must start with postgresql:// or postgres://',
    ),

  DB_PASSWORD_FILE: z.string().min(1, 'DB_PASSWORD_FILE is required'),

  BROKER_URL: z
    .string()
    .refine(
      (value) => value.startsWith('amqp://') || value.startsWith('amqps://'),
      'BROKER_URL must start with amqp:// or amqps://',
    )
    .optional(),

  REDIS_URL: z
    .string()
    .refine(
      (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
      'REDIS_URL must start with redis:// or rediss://',
    )
    .optional(),

  REDIS_QUEUE_URL: z
    .string()
    .refine(
      (value) => value.startsWith('redis://') || value.startsWith('rediss://'),
      'REDIS_QUEUE_URL must start with redis:// or rediss://',
    )
    .optional(),

  JWT_KID: z.string().trim().min(1, 'JWT_KID is required'),

  JWT_PRIVATE_KEY: z
    .string()
    .trim()
    .min(1, 'JWT_PRIVATE_KEY is required')
    .refine(
      isEs256PrivateKeyPem,
      'JWT_PRIVATE_KEY must be a base64-encoded ES256 PKCS8 PEM',
    ),

  JWT_PUBLIC_KEY: z
    .string()
    .trim()
    .min(1, 'JWT_PUBLIC_KEY is required')
    .refine(
      isEs256PublicKeyPem,
      'JWT_PUBLIC_KEY must be a base64-encoded ES256 SPKI PEM',
    ),

  REFRESH_TOKEN_PEPPER: z.string().trim().min(1, 'REFRESH_TOKEN_PEPPER is required'),

  JWT_PREVIOUS_KID: optionalEnvString,

  JWT_PREVIOUS_PUBLIC_KEY: optionalEnvString,
});

export type Env = z.infer<typeof envSchema>;

export const ENV_KEYS = Object.keys(envSchema.shape) as (keyof Env)[];

export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (result.success) {
    const env = result.data;
    const previousKid = env.JWT_PREVIOUS_KID;
    const previousKey = env.JWT_PREVIOUS_PUBLIC_KEY;
    if (Boolean(previousKid) !== Boolean(previousKey)) {
      throw new Error(
        'Environment validation failed:\n' +
          '  - JWT_PREVIOUS_KID: JWT_PREVIOUS_PUBLIC_KEY must be set together with JWT_PREVIOUS_KID\n' +
          'Fix .env / process env and restart.',
      );
    }
    if (previousKey && !isEs256PublicKeyPem(previousKey)) {
      throw new Error(
        'Environment validation failed:\n' +
          '  - JWT_PREVIOUS_PUBLIC_KEY: JWT_PREVIOUS_PUBLIC_KEY must be a base64-encoded ES256 SPKI PEM\n' +
          'Fix .env / process env and restart.',
      );
    }
    return env;
  }

  const lines = result.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    return `  - ${name}: ${issue.message}`;
  });

  throw new Error(
    `Environment validation failed:\n${lines.join('\n')}\n` +
      'Fix .env / process env and restart.',
  );
}
