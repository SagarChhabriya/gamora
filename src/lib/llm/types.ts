export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GenerateRequest = {
  model: string;
  task?: "reasoning" | "fast";
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Short label for logs, for example "ingest.concepts". */
  purpose?: string;
  requestId?: string;
  userHash?: string;
  /** When set, identical requests are served from Redis for `cacheTtlSeconds`. */
  cacheKey?: string;
  cacheTtlSeconds?: number;
  /** Provider names to treat as unavailable. Used by the outage drill. */
  skipProviders?: string[];
  /** Set by the router from the key pool. Providers fall back to their default env key. */
  apiKey?: string;
};

export type GenerateResponse = {
  text: string;
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  cached?: boolean;
  fallbackUsed?: boolean;
  keyLabel?: string;
};

export type StreamChunk = {
  text: string;
  done: boolean;
};

export interface LLMProvider {
  readonly name: string;
  generate(request: GenerateRequest): Promise<GenerateResponse>;
  stream(request: GenerateRequest): AsyncIterable<StreamChunk>;
  embed?(texts: string[], model: string): Promise<number[][]>;
}

export class LLMProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable = false,
    /** Provider-suggested wait before retrying, for rate limits. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LLMProviderError";
  }
}
