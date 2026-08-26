/**
 * Handing a link to someone else.
 *
 * On a tablet the native share sheet is the expected gesture — AirDrop, Mail,
 * Messages, Slack — and Safari supports it for installed and browser-tab PWAs
 * alike. Everywhere else the clipboard is the honest fallback, so callers get
 * one call that does the best available thing and reports which it was.
 */

export type ShareOutcome =
  /** Handed to the system sheet. What happens next is out of our hands. */
  | 'shared'
  /** No sheet available, so the link went to the clipboard instead. */
  | 'copied'
  /** The sheet opened and was dismissed — a decision, not a failure. */
  | 'dismissed'
  | 'failed';

/** Whether the system sheet is available, so a label can say the right thing. */
export function canShare(): boolean {
  return typeof navigator.share === 'function';
}

export async function shareLink(url: string, title: string, text?: string): Promise<ShareOutcome> {
  if (canShare()) {
    try {
      await navigator.share({ title, url, ...(text === undefined ? {} : { text }) });
      return 'shared';
    } catch (error) {
      // Dismissing the sheet rejects with AbortError. Copying the link after
      // someone deliberately cancelled would be a surprise, so stop here.
      if (error instanceof DOMException && error.name === 'AbortError') return 'dismissed';
      // Any other rejection is a broken sheet rather than a decision: fall
      // through and still get the link into their hands.
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
