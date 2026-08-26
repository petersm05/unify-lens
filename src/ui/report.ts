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

/**
 * What is on screen, in words.
 *
 * A link to the view needs an account on the tenant to open, so in an issue it
 * is close to useless — while its filters carry attribute values that would be
 * published along with it. The chart's own title says the same thing in a form
 * anyone can read, and filters are counted rather than named for the same
 * reason.
 */
function lookingAt(): string {
  const view =
    document.querySelector('nav.tabs button[aria-selected="true"]')?.textContent?.trim() ?? '';
  const type = document
    .querySelector('.picker.type-select .picker-value')
    ?.textContent?.trim();
  const chart = document.querySelector('[data-k="title"]')?.textContent?.trim();
  const filters = document.querySelectorAll('.filters .chip, .filters button').length;
  // The bar carries one "Clear all" alongside the chips.
  const applied = Math.max(0, filters - 1);

  return [
    view,
    type && type !== 'Nothing' ? type : undefined,
    chart && chart !== '—' ? chart : undefined,
    applied > 0 ? `${applied} filter${applied === 1 ? '' : 's'} applied` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
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
    body:
      'What happened?\n\n\nWhat did you expect instead?\n\n\n' +
      'Screenshot (paste here — iOS cannot capture one for you):\n\n',
  },
  idea: {
    heading: 'Request a feature',
    title: '',
    body:
      'What would you like to be able to do?\n\n\nWhat would that let you find out?\n\n',
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
        <button type="button" class="adder" data-act="add-env">Add environment</button>
        <button type="button" class="adder" data-act="add-view">Add what I'm looking at</button>
      </div>
      <div class="modal-actions">
        <button type="button" class="ghost" data-act="cancel">Cancel</button>
        <button type="button" class="primary" data-act="open">Open on GitHub</button>
      </div>
    </div>
  `;

  const heading = must(backdrop.querySelector('h2'), 'report: title');
  const title = must(backdrop.querySelector<HTMLInputElement>('.report-title'), 'report: summary');
  const body = must(backdrop.querySelector<HTMLTextAreaElement>('.report-body'), 'report: body');
  const addEnv = must(
    backdrop.querySelector<HTMLButtonElement>('[data-act="add-env"]'),
    'report: env',
  );
  const addView = must(
    backdrop.querySelector<HTMLButtonElement>('[data-act="add-view"]'),
    'report: view',
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

  const seeing = lookingAt();
  addView.disabled = seeing.length === 0;
  addView.addEventListener('click', () => {
    append(`Looking at: ${seeing}`);
    addView.disabled = true;
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
