/** Sharing from the page: the device's share sheet when it has one, the clipboard otherwise. */
import { useEffect, useRef, useState } from 'react';

/** Copies text; false when the browser refuses (no clipboard API, no permission). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * The share sheet with `data` when the device has one; otherwise `fallback` goes to the clipboard. Closing the sheet
 * is `cancelled`, not an error.
 */
export async function shareOrCopy(data: ShareData, fallback: string): Promise<ShareOutcome> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Any other refusal (not allowed here): fall back to copying.
    }
  }
  return (await copyText(fallback)) ? 'copied' : 'failed';
}

const DONE_MS = 2500;

/** A button's "done" state (Đã chép) that turns itself off after a moment. */
export function useFlag(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [
    on,
    () => {
      setOn(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setOn(false), DONE_MS);
    },
  ];
}
