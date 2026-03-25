type LogFn = (type: string, payload: Record<string, unknown>) => void;

export async function withRetry<T>(
  fn: () => Promise<T>,
  log: LogFn,
  maxAttempts = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = err instanceof Error && /5\d\d|rate.?limit|overloaded|internal server error/i.test(err.message);
      if (!isRetryable || attempt === maxAttempts) throw err;
      const delay = attempt * 5000;
      log("log", { message: `API error (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s: ${err.message}` });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}
