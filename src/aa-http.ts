import type { SourceOptions } from "./aa-types.ts"

export const DEFAULT_TIMEOUT_MS = 15_000
export const DEFAULT_RETRY_DELAY_MS = 200
const MAX_ATTEMPTS = 3
const MAX_RETRY_DELAY_MS = 5_000

export function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

export function parseRetryAfter(header: string | null | undefined): number | undefined {
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(header)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return undefined
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message))
}

/** One request, one fresh controller/timer. Never share an abort signal. */
export async function fetchOnce(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  // Race the request as well as aborting it, so even a fetch implementation
  // that ignores the signal cannot hold up the next source forever.
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      const error = new Error(`Artificial Analysis request timed out after ${timeoutMs}ms`)
      error.name = "AbortError"
      reject(error)
    }, timeoutMs)
  })
  try {
    // Preserve a caller-provided signal (plugin cleanup) while still applying
    // this attempt's own timeout controller.
    const signal = init.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal
    return await Promise.race([
      fetchImpl(input, { ...init, signal }),
      timeout,
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Retry 429/5xx a bounded number of times; honor Retry-After when present. */
export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
  options: SourceOptions,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetchOnce(fetchImpl, input, init, options.timeoutMs)
      if (response.ok || !isRetryableStatus(response.status) || attempt >= MAX_ATTEMPTS) {
        return response
      }
      const retryAfter = parseRetryAfter(response.headers?.get?.("retry-after"))
      const requestedDelay = retryAfter ?? options.retryDelayMs * 2 ** (attempt - 1)
      if (requestedDelay > MAX_RETRY_DELAY_MS) {
        options.log(
          `[model-pricing] Artificial Analysis returned ${response.status} with Retry-After ${requestedDelay}ms; not retrying (cap ${MAX_RETRY_DELAY_MS}ms)`,
        )
        return response
      }
      options.log(
        `[model-pricing] Artificial Analysis returned ${response.status}; retry ${attempt}/${MAX_ATTEMPTS - 1} in ${requestedDelay}ms`,
      )
      await sleep(requestedDelay)
    } catch (error) {
      if (isAbortError(error) || attempt >= MAX_ATTEMPTS) throw error
      const delay = Math.min(options.retryDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS)
      options.log(
        `[model-pricing] Artificial Analysis request failed (${error instanceof Error ? error.message : String(error)}); retry ${attempt}/${MAX_ATTEMPTS - 1} in ${delay}ms`,
      )
      await sleep(delay)
    }
  }
}
