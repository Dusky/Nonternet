import { errorText } from './hooks';

// The browser says the person closed its prompt (or it timed out) with a NotAllowedError; that is not a fault.
export function passkeyError(e: unknown, cancelled: string): string {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  const cause = e && typeof e === 'object' && 'cause' in e ? (e as { cause?: { name?: string } }).cause?.name : undefined;
  if (name === 'NotAllowedError' || cause === 'NotAllowedError' || name === 'AbortError') return cancelled;
  return errorText(e);
}
