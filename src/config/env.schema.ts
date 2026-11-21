import { z } from 'zod';

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
});

export type Env = z.infer<typeof envSchema>;

export const ENV_KEYS = Object.keys(envSchema.shape) as (keyof Env)[];

export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (result.success) {
    return result.data;
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
