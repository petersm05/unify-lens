import { must } from './dom';
import { overlayHost } from './overlay';

const REPO = 'https://github.com/petersm05/unify-lens';

/**
 * Filing a bug or an idea, without a server and without a token.
 *
 * GitHub takes a prefilled `issues/new` link, so the app composes the report
 * and the browser finishes it: no credential ever reaches this code, which is
 * the only honest option for a client-side app on a public host. Whoever is
 * already signed in presses the button, so the issue is attributed to them
 * rather than to a shared robot.
 *
 * Everything is shown, and editable, before it goes anywhere. The repository is
 * public, so a report is world-readable and permanent — a filter label like
 * "Application Owner: Carlos Mendez" is a real person at a real customer. The
 * diagnostics below are deliberately limited to facts about the app and the
 * device; the tenant and the current view are offered as a separate, deliberate
 * act rather than attached by default.
 */

export type ReportKind = 'bug' | 'idea';

/** The bundle's hash, or 'dev' when running from source. */
export function buildId(): string {
  const file = import.meta.url.split('/').pop() ?? '';
  const match = /-([A-Za-z0-9_-]{6,})\.js/.exec(file);
  return match?.[1] ?? 'dev';
}

function diagnostics(): string {
  const mode = globalThis.matchMedia?.('(display-mode: standalone)').matches
    ? 'installed'
    : 'browser tab';
  const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const view =
    document.querySelector('nav.tabs button[aria-selected="true"]')?.textContent?.trim() ??
    'unknown';

  return [
    `Build: ${buildId()}`,
    `View: ${view}`,
    `Running: ${mode}, ${dark}`,
    `Viewport: ${globalThis.innerWidth}×${globalThis.innerHeight}`,
    `Online: ${navigator.onLine ? 'yes' : 'no'}`,
    `Browser: ${navigator.userAgent}`,
  ].join('\n');
}

const TEMPLATE: Record<ReportKind, { heading: string; title: string; body: string }> = {
  bug: {
    heading: 'Report a problem',
    title: '',
    body: 'What happened?\n\n\nWhat did you expect instead?\n\n',
  },
  idea: {
    heading: 'Request a feature',
    title: '',
    body: 'What would you like to be able to do?\n\n\nWhat would that let you find out?\n\n',
  },
};

export function openReport(kind: ReportKind, environment?: string): void {
  const template = TEMPLATE[kind];

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal report" role="dialog" aria-modal="true">
      <h2></h2>
      <p class="hint">Everything below is sent as written. This repository is public, so treat it as
        readable by anyone.</p>
      <label class="field">
        <span>Summary</span>
        <input type="text" class="report-title" placeholder="One line" />
      </label>
      <label class="field">
        <span>Details</span>
        <textarea class="report-body" rows="10"></textarea>
      </label>
      <div class="report-adders">
        <button type="button" class="ghost" data-act="add-env">Add environment</button>
        <button type="button" class="ghost" data-act="add-link">Add current view link</button>
      </div>
      <p class="hint report-warn" hidden></p>
      <div class="modal-actions">
        <button type="button" class="ghost" data-act="cancel">Cancel</button>
        <button type="button" class="primary" data-act="open">Open on GitHub</button>
      </div>
    </div>
  `;

  const heading = must(backdrop.querySelector('h2'), 'report: title');
  const title = must(backdrop.querySelector<HTMLInputElement>('.report-title'), 'report: summary');
  const body = must(backdrop.querySelector<HTMLTextAreaElement>('.report-body'), 'report: body');
  const warn = must(backdrop.querySelector<HTMLElement>('.report-warn'), 'report: warning');
  const addEnv = must(
    backdrop.querySelector<HTMLButtonElement>('[data-act="add-env"]'),
    'report: env',
  );
  const addLink = must(
    backdrop.querySelector<HTMLButtonElement>('[data-act="add-link"]'),
    'report: link',
  );

  heading.textContent = template.heading;
  title.value = template.title;
  body.value = `${template.body}\n---\n${diagnostics()}`;

  const append = (line: string): void => {
    body.value = `${body.value.trimEnd()}\n${line}`;
    body.scrollTop = body.scrollHeight;
  };

  addEnv.disabled = environment === undefined;
  addEnv.addEventListener('click', () => {
    if (!environment) return;
    append(`Environment: ${environment}`);
    addEnv.disabled = true;
  });

  addLink.addEventListener('click', () => {
    append(`View: ${globalThis.location.href}`);
    addLink.disabled = true;
    // Said only once it is true, rather than as a standing warning nobody reads.
    warn.hidden = false;
    warn.textContent =
      'That link carries the filters you have applied, including attribute values. Remove any you would rather not publish.';
  });

  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };

  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
  }

  backdrop.querySelector('[data-act="cancel"]')?.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);

  must(backdrop.querySelector<HTMLButtonElement>('[data-act="open"]'), 'report: open').addEventListener(
    'click',
    () => {
      const url = new URL(`${REPO}/issues/new`);
      url.searchParams.set('title', title.value.trim() || template.heading);
      url.searchParams.set('body', body.value);
      url.searchParams.set('labels', kind === 'bug' ? 'bug' : 'enhancement');
      // A new tab, so a half-written report is not lost to a navigation.
      globalThis.open(url.toString(), '_blank', 'noopener');
      close();
    },
  );

  overlayHost().append(backdrop);
  title.focus();
}
