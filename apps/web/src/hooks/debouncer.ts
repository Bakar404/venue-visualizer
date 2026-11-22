export type Debounced<A extends unknown[]> = ((...args: A) => void) & {
  /** Drops the pending call, if any. */
  cancel: () => void;
  /** Runs the pending call now, if any. */
  flush: () => void;
  pending: () => boolean;
  /** Swaps the function a pending call will run, without resetting the timer. */
  setFn: (fn: (...args: A) => void) => void;
};

/** Framework-free debouncer with `cancel()`, `flush()` and a swappable target. */
export function createDebouncer<A extends unknown[]>(initialFn: (...args: A) => void, delay: number): Debounced<A> {
  let fn = initialFn;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let args: A | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    args = null;
  };
  const flush = () => {
    if (!args) return;
    const pending = args;
    cancel();
    fn(...pending);
  };
  const call = (...next: A) => {
    if (timer) clearTimeout(timer);
    args = next;
    timer = setTimeout(flush, delay);
  };
  const setFn = (next: (...args: A) => void) => {
    fn = next;
  };
  return Object.assign(call, { cancel, flush, pending: () => args !== null, setFn });
}
