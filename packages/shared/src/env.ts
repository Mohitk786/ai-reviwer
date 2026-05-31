
import { z } from 'zod';

const hex32Bytes = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex chars (32 bytes hex-encoded)');

const requiredString = z.string().trim().min(1);

const pemKey = z
  .string()
  .min(1)
  .transform((v) => v.replace(/\\n/g, '\n'));


const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.string().url(),

  DATABASE_URL: requiredString,

  ENCRYPTION_KEY: hex32Bytes,
  SESSION_SECRET: hex32Bytes,

  // GitHub App
  // App slug = the URL slug shown in https://github.com/apps/<slug> — used to
  // build the install URL the user is redirected to during sign-in.
  GITHUB_APP_SLUG: requiredString,
  GITHUB_APP_ID: positiveInt,
  GITHUB_APP_CLIENT_ID: requiredString,
  GITHUB_APP_CLIENT_SECRET: requiredString,
  GITHUB_APP_PRIVATE_KEY: pemKey,
  GITHUB_WEBHOOK_SECRET: requiredString,

  // Default LLM provider (app-owned) — OpenAI for embeddings, Anthropic for review
  OPENAI_API_KEY: requiredString,
  OPENAI_DEFAULT_CHAT_MODEL: requiredString.default('gpt-4.1-mini'),
  OPENAI_DEFAULT_EMBEDDING_MODEL: requiredString.default('text-embedding-3-large'),
  OPENAI_EMBEDDING_DIMENSIONS: positiveInt.default(1536),

  // Anthropic — wired but not active; set when switching the review pipeline to Claude.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_REVIEW_MODEL: z.string().default('claude-sonnet-4-6'),

  // Groq — free OpenAI-compatible tier. Takes priority over OpenAI if set.
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().default('https://api.groq.com/openai/v1'),
  GROQ_REVIEW_MODEL: z.string().default('llama-3.3-70b-versatile'),
  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_EMBEDDING_MODEL: z.string().default('voyage-code-2'),


  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),


  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env` (or any object). Throws a readable error
 * naming each missing or invalid field — never returns a partially-valid object.
 */
export function parseEnv(input: NodeJS.ProcessEnv | Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration. Check .env.example.\n${issues}`,
    );
  }
  return result.data;
}


let cached: Env | null = null;
export function getEnv(): Env {
  if (!cached) {
    cached = Object.freeze(parseEnv()) as Env;
  }
  return cached;
}
