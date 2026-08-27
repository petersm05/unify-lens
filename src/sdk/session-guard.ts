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
 * Whether an SDK error means the session is no longer good.
 *
 * `errorType` is the SDK's own classification and is what should decide this.
 * The message is a fallback: it is the one field every error carries, and a
 * token failure that arrives without a type should still be recognised rather
 * than logged and forgotten.
 */
export function isAuthFailure(error: { errorType?: unknown; message?: unknown }): boolean {
  if (error.errorType === 'AUTHENTICATION') return true;

  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  if (
    message.includes('unauthorized') ||
    message.includes('unauthenticated') ||
    message.includes('not authorized')
  ) {
    return true;
  }

  // A missing token does not announce itself as an authentication problem. With
  // the stored tokens gone the SDK reports "GraphQL Client Error: Access Token
  // could not be retrieved", typed GQL_CLIENT — so matching only on the word
  // authorized, or on an expiry, missed the most ordinary case there is.
  //
  // Anything that names a token and says it went wrong counts. The one error
  // every boot produces is the schema-version mismatch, which mentions no
  // token, so it stays outside this.
  return (
    message.includes('token') &&
    (message.includes('could not be retrieved') ||
      message.includes('could not retrieve') ||
      message.includes('not be retrieved') ||
      message.includes('expired') ||
      message.includes('missing') ||
      message.includes('invalid') ||
      message.includes('revoked'))
  );
}

/**
 * Throws away the stored tokens, so the recovery above can be tested.
 *
 * Waiting for a token to die takes an hour, and reaching a console to delete it
 * by hand is worse: an installed app exposes its service worker as a separate
 * inspector target, and `localStorage` does not exist there — so the obvious
 * attempt fails with a confusing error. On a tablet there is no console within
 * reach at all.
 *
 * Deliberately does not reload. A reload only proves the start-up path, which
 * already worked; what needed proving is a session dying under an app that is
 * already running. Clear, switch away, come back.
 *
 * Removing every Cognito key drops the refresh token too, which forces a real
 * sign-in. Keeping it would only exercise the silent refresh.
 */
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

  session.sdk.errorClient.errors$.subscribe((error) => {
    if (isAuthFailure(error)) void recover('Your session expired. Signing you in again…');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void recover('Your session expired while the app was away. Signing you in again…');
    }
  });
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
