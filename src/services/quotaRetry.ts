// Vertex answers 429 RESOURCE_EXHAUSTED when the project's quota for a model is used up
// for the moment. On this project the photo model's quota clears in well under a minute
// (a retry 30 s after a 429 worked every time in a test on 2026-11-26), so waiting and
// trying again turns a failed photo into a late one.

export interface QuotaRetryOptions {
  /** How long to wait before each retry, in ms. One entry per retry. */
  delaysMs?: number[];
  /** Extra random wait, as a fraction of each delay (0.2 adds up to 20%), so callers that hit the limit together don't retry together. */
  jitter?: number;
  /** Names the call in log lines. */
  label?: string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (message: string) => void;
}

// Retries at about 10 s and 40 s after the first 429: at most ~48 s of waiting with jitter,
// far below Cloud Run's 300 s request timeout (the web app's request has no timeout of its own).
export const QUOTA_RETRY_DELAYS_MS = [10_000, 30_000];

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True for a quota error: HTTP 429, or a body with status RESOURCE_EXHAUSTED. */
export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, message } = error as { status?: unknown; message?: unknown };
  return status === 429 || (typeof message === 'string' && message.includes('RESOURCE_EXHAUSTED'));
}

/** Runs `call`, retrying only quota errors, with waits from `delaysMs`. Any other error is thrown at once. */
export async function retryOnQuota<T>(call: () => Promise<T>, options: QuotaRetryOptions = {}): Promise<T> {
  const {
    delaysMs = QUOTA_RETRY_DELAYS_MS,
    jitter = 0.2,
    label = 'Vertex call',
    sleep = sleepFor,
    random = Math.random,
    log = console.log,
  } = options;
  const retries = delaysMs.length;

  for (let attempt = 0; ; attempt++) {
    try {
      const result = await call();
      if (attempt > 0) log(`${label}: succeeded on retry ${attempt}/${retries}`);
      return result;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
      if (attempt >= retries) {
        log(`${label}: 429 RESOURCE_EXHAUSTED, giving up after ${retries} retries`);
        throw error;
      }
      const waitMs = Math.round(delaysMs[attempt] * (1 + jitter * random()));
      log(`${label}: 429 RESOURCE_EXHAUSTED, retry ${attempt + 1}/${retries} in ${(waitMs / 1000).toFixed(1)}s`);
      await sleep(waitMs);
    }
  }
}
