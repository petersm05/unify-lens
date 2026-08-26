type Listener = (busy: boolean) => void;

/**
 * A reference-counted "work in flight" signal.
 *
 * Counted rather than boolean because several queries overlap — a chart, its
 * coverage counts and a group-by can all be running, and the last one to finish
 * is what clears the indicator.
 */
class BusySignal {
  private depth = 0;
  private readonly listeners = new Set<Listener>();

  /** Wraps a promise so the indicator always clears, including on failure. */
  async track<T>(work: Promise<T>): Promise<T> {
    this.begin();
    try {
      return await work;
    } finally {
      this.end();
    }
  }

  begin(): void {
    this.depth += 1;
    if (this.depth === 1) this.emit();
  }

  end(): void {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) this.emit();
  }

  get isBusy(): boolean {
    return this.depth > 0;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.isBusy);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.isBusy);
  }
}

/** One signal for the whole app — every view reports into it. */
export const busy = new BusySignal();
