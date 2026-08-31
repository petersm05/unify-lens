import type { ObjectType, UUID } from '@bizzdesign/sdk-bundle/browser';

/** Enough of an object to name it in a title before its record is read. */
export interface ObjectRef {
  readonly id: UUID;
  readonly name: string;
  readonly type: string;
}

/**
 * One screen, and everything it needs to be the screen it is.
 *
 * Deliberately not a view id plus ambient state: the type an attribute chart
 * is about, and the object a graph is centred on, are what distinguish two
 * *different* screens of the same kind. Holding them here is what lets the
 * back button say `‹ Applications` without asking anything else where it is.
 */
export type Route =
  | { readonly at: 'population' }
  | { readonly at: 'attributes'; readonly type: ObjectType }
  | { readonly at: 'network'; readonly type?: ObjectType; readonly focus?: ObjectRef };

export type RouteId = Route['at'];

/** Why the stack moved — the shell writes history differently for each. */
export type RouteChange = 'push' | 'pop' | 'replace' | 'restore';

type Listener = (path: readonly Route[], change: RouteChange) => void;

export const ROOT: Route = { at: 'population' };

/**
 * The trail: which screens are open, innermost last.
 *
 * Replaces a view id and a filter that had to agree with each other. The type
 * being explored is a property of the screen rather than a chip floating above
 * every screen, so going back cannot leave a filter behind that nothing on
 * screen explains.
 */
export class RouteStack {
  private stack: readonly Route[] = [ROOT];
  private readonly listeners = new Set<Listener>();

  get current(): Route {
    // The stack is never empty — `pop` refuses to remove the root.
    return this.stack[this.stack.length - 1] as Route;
  }

  get path(): readonly Route[] {
    return this.stack;
  }

  get depth(): number {
    return this.stack.length;
  }

  /** The route one level up, which is what a back button is named after. */
  get parent(): Route | undefined {
    return this.stack[this.stack.length - 2];
  }

  push(route: Route): void {
    // Pushing the screen already on top would put an identical entry in the
    // history, so Back would appear to do nothing.
    if (sameRoute(this.current, route)) return;
    this.stack = [...this.stack, route];
    this.emit('push');
  }

  /** Leaves the root in place: there is nowhere above the population. */
  pop(): void {
    if (this.stack.length === 1) return;
    this.stack = this.stack.slice(0, -1);
    this.emit('pop');
  }

  /** Swaps the current screen for another at the same depth. */
  replace(route: Route): void {
    if (sameRoute(this.current, route)) return;
    this.stack = [...this.stack.slice(0, -1), route];
    this.emit('replace');
  }

  popToRoot(): void {
    if (this.stack.length === 1) return;
    this.stack = [ROOT];
    this.emit('pop');
  }

  /**
   * Puts a whole trail back — restoring a shared link, or answering the browser
   * going back past a state this stack never pushed itself.
   *
   * Reported as `restore` so the shell knows not to write the URL it just read.
   */
  restore(path: readonly Route[]): void {
    this.stack = path.length > 0 ? [...path] : [ROOT];
    this.emit('restore');
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: RouteChange): void {
    for (const listener of this.listeners) listener(this.stack, change);
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  if (a.at !== b.at) return false;
  if (a.at === 'attributes' && b.at === 'attributes') return a.type === b.type;
  if (a.at === 'network' && b.at === 'network') {
    return a.type === b.type && a.focus?.id === b.focus?.id;
  }
  return true;
}

export function samePath(a: readonly Route[], b: readonly Route[]): boolean {
  return a.length === b.length && a.every((route, index) => sameRoute(route, b[index] as Route));
}

/**
 * Reads a trail back out of a link, dropping anything that is not a route.
 *
 * A link is untrusted input — it may have been written by an older build, or
 * hand-edited. Returning what parses rather than throwing means a partly
 * unreadable trail still opens at the deepest screen it can describe.
 */
export function parsePath(value: unknown): Route[] {
  if (!Array.isArray(value)) return [];
  const path: Route[] = [];
  for (const entry of value) {
    const route = parseRoute(entry);
    if (route) path.push(route);
  }
  // A trail that does not start at the population is not one this app can
  // draw a back button for.
  if (path.length > 0 && path[0]?.at !== 'population') return [ROOT, ...path];
  return path;
}

function parseRoute(value: unknown): Route | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as { at?: unknown; type?: unknown; focus?: unknown };

  if (candidate.at === 'population') return ROOT;

  if (candidate.at === 'attributes') {
    return typeof candidate.type === 'string'
      ? { at: 'attributes', type: candidate.type as ObjectType }
      : null;
  }

  if (candidate.at === 'network') {
    const focus = parseFocus(candidate.focus);
    return {
      at: 'network',
      ...(typeof candidate.type === 'string' ? { type: candidate.type as ObjectType } : {}),
      ...(focus ? { focus } : {}),
    };
  }

  return null;
}

function parseFocus(value: unknown): ObjectRef | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as { id?: unknown; name?: unknown; type?: unknown };
  if (typeof candidate.id !== 'string' || typeof candidate.type !== 'string') return null;
  return {
    id: candidate.id as UUID,
    name: typeof candidate.name === 'string' ? candidate.name : '',
    type: candidate.type,
  };
}
