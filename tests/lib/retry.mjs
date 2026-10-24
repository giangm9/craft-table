// Run `fn` up to `tries` times, `wait` ms apart; `onRetry(error, attempt)` hears each failure that is retried.
// Returns the first result; throws the last error.
export async function retry(fn, { tries = 3, wait = 2000, onRetry = () => {} } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries) throw e;
      onRetry(e, i);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
