import type { Session } from './client';

/**
 * Notices when a session has stopped being valid, and gets it back.
 *
 * Authentication is only established at start-up. That is enough for a page
 * someone opens, uses and closes — but an installed app is not closed. It sits
 * on a home screen for days, and when it is opened again the access token is
 * long gone. Every query then fails, the failures go to the console, and the
 * app shows a view that quietly stopped being true. Reloading fixes it, which
 * nobody should have to know.
 *
 * Two things are watched, because they catch different halves of the problem:
 * coming back to the foreground catches it before anything is asked for, and an
 * authentication error catches a token that expired while the app was open and
 * in use.
 */

/** Where the current view is kept while signing in, since the callback drops the query. */
const RESUME_KEY = 'unify-lens:resume';

/** Long enough that a failing sign-in cannot become a redirect loop. */
const RETRY_AFTER_MS = 60_000;

/**
 * How often the session is checked while someone is actually looking at it.
 *
 * Errors are a hint, not a contract: the failure that started this reached the
 * SDK's logger, and whether it also reaches `errors$` — and in what shape — is
 * not something this app should have to be right about. Asking directly does
 * not care. Only while visible, because a backgrounded app has nobody to
 * recover for and is checked on its way back anyway.
 */
const CHECK_EVERY_MS = 60_000;

/**
 * Every string and every classification anywhere shallow in an error.
 *
 * The shape emitted on `errors$` is not the shape it appears to be. A token
 * failure arrives as `{ context, msg, error: { errorType } }` — the type nested
 * a level down, the text under `msg` rather than `message`. Reading the two
 * obvious fields found neither. Rather than encode one more guess about the
 * layout, everything within reach is gathered and the decision is made on the
 * contents.
 */
function fieldsOf(value: unknown, depth = 0): { types: string[]; texts: string[] } {
  const types: string[] = [];
  const texts: string[] = [];
  if (depth > 2 || value === null || typeof value !== 'object') return { types, texts };

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      if (key === 'errorType' || key === 'type' || key === 'name' || key === 'code') {
        types.push(entry);
      } else if (key === 'message' || key === 'msg' || key === 'context' || key === 'detail') {
        texts.push(entry);
      }
    } else if (typeof entry === 'object') {
      const nested = fieldsOf(entry, depth + 1);
      types.push(...nested.types);
      texts.push(...nested.texts);
    }
  }
  return { types, texts };
}

/**
 * Whether an SDK error means the session is no longer good.
 *
 * The SDK's own classification decides it wherever one is present, at whatever
 * depth. The wording is a fallback for a failure that arrives without one:
 * with the tokens gone the message is "Access Token could not be retrieved",
 * which is neither an expiry nor a refusal, so matching only those missed the
 * most ordinary case there is — no token rather than a stale one.
 */
export function isAuthFailure(error: unknown): boolean {
  const { types, texts } = fieldsOf(error);
  if (types.includes('AUTHENTICATION')) return true;

  const message = texts.join(' ').toLowerCase();
  if (
    message.includes('unauthorized') ||
    message.includes('unauthenticated') ||
    message.includes('not authorized')
  ) {
    return true;
  }

  // Anything naming a token and saying it went wrong. The error every boot
  // emits is the schema-version mismatch, which names no token, so it stays
  // outside this — treating it as a session failure would send someone to sign
  // in on every launch.
  return (
    message.includes('token') &&
    (message.includes('could not be retrieved') ||
      message.includes('could not retrieve') ||
      message.includes('not be retrieved') ||
      message.includes('retrieving') ||
      message.includes('expired') ||
      message.includes('missing') ||
      message.includes('invalid') ||
      message.includes('revoked'))
  );
}

export function expireSession(): number {
  let removed = 0;
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      if (!store) continue;
      for (const key of Object.keys(store)) {
        if (key.startsWith('CognitoIdentityServiceProvider.')) {
          store.removeItem(key);
          removed += 1;
        }
      }
    } catch {
      // Nothing readable here; whatever was found elsewhere still counts.
    }
  }
  return removed;
}

export function guardSession(session: Session, notify: (message: string) => void): void {
  let recovering = false;
  let lastAttempt = 0;

  async function recover(reason: string): Promise<void> {
    if (recovering || Date.now() - lastAttempt < RETRY_AFTER_MS) return;
    recovering = true;
    lastAttempt = Date.now();

    try {
      if (await session.sdk.authClient.isAuthenticated()) return;

      notify(reason);
      rememberView();

      // Refreshes silently where it can, and sends someone to sign in where it
      // cannot — which is what should have happened the moment the token died.
      await session.sdk.authClient.ensureAuthenticated();
    } catch {
      notify('Your session has expired. Reload to sign in again.');
    } finally {
      recovering = false;
    }
  }

  // Free when it works, and it works for errors that carry a classification.
  session.sdk.errorClient.errors$.subscribe((error) => {
    if (isAuthFailure(error)) void recover('Your session expired. Signing you in again…');
  });

  // The one that does not depend on being told. A token can go without any
  // error being raised at all until something is asked for, and the thing asked
  // for might be a chart that fails quietly.
  // Node's types are in scope, so this is the browser's handle, not a Timeout.
  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  const stop = (): void => {
    if (timer !== undefined) globalThis.clearInterval(timer);
    timer = undefined;
  };
  const start = (): void => {
    stop();
    timer = globalThis.setInterval(() => {
      void recover('Your session expired. Signing you in again…');
    }, CHECK_EVERY_MS);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void recover('Your session expired while the app was away. Signing you in again…');
      start();
    } else {
      stop();
    }
  });

  if (document.visibilityState === 'visible') start();
}

/**
 * Keeps the current view for the far side of a sign-in.
 *
 * The Cognito callback is the app's base URL, so the round trip drops the query
 * the analysis lives in. This matters in two places: a session dying under
 * someone mid-use, and a shared link opened by someone not signed in — where
 * the whole point of the link is the query that would be thrown away.
 *
 * Only a view worth returning to is kept, so an ordinary sign-in does not
 * resurrect an analysis nobody asked for.
 */
export function rememberView(): void {
  try {
    const url = new URL(globalThis.location.href);
    if (!url.searchParams.has('a')) return;
    globalThis.sessionStorage?.setItem(RESUME_KEY, url.href);
  } catch {
    // Private browsing: signing in still works, the view is just not restored.
  }
}

/**
 * The view to return to after signing in, if there is one.
 *
 * Read once: a resume that failed should not be retried on every later start.
 */
export function takeResumeUrl(): string | null {
  try {
    const url = globalThis.sessionStorage?.getItem(RESUME_KEY) ?? null;
    globalThis.sessionStorage?.removeItem(RESUME_KEY);
    return url;
  } catch {
    return null;
  }
}
