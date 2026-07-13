/**
 * Human-readable labels for WhatsApp chat ids used in charts, tables, and tooltips.
 *
 * WhatsApp ids look like:
 *   - `62812…@c.us`     phone user
 *   - `…@g.us`          group
 *   - `…@lid`           privacy-linked id (NOT a phone number)
 *   - bare digits       legacy/partial rows (often lids or phones)
 */

export type ChatLabelKind = 'named' | 'phone' | 'group' | 'lid' | 'channel' | 'status' | 'unknown';

export interface ChatLabel {
  /** Full label for tooltips / titles */
  full: string;
  /** Short label for tight chart axes */
  short: string;
  kind: ChatLabelKind;
}

const LID_HINT_MIN_DIGITS = 13;

function stripJid(chatId: string): { local: string; domain: string } {
  const raw = (chatId || '').trim();
  const at = raw.lastIndexOf('@');
  if (at === -1) {
    return { local: raw.split(':')[0], domain: '' };
  }
  return {
    local: raw.slice(0, at).split(':')[0],
    domain: raw.slice(at + 1).toLowerCase(),
  };
}

/** Pretty-print E.164-ish digits for display (best-effort, not a full libphonenumber). */
export function formatPhoneDigits(digits: string): string {
  const d = digits.replace(/\D/g, '');
  if (!d) return digits;
  // Indonesia common case: 62XXXXXXXXXXX
  if (d.startsWith('62') && d.length >= 10) {
    const rest = d.slice(2);
    return `+62 ${rest.slice(0, 3)} ${rest.slice(3, 7)}${rest.length > 7 ? ` ${rest.slice(7)}` : ''}`.trim();
  }
  if (d.startsWith('1') && d.length === 11) {
    return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  }
  if (d.length > 8) {
    return `+${d}`;
  }
  return d;
}

export function truncateLabel(text: string, max = 16): string {
  const t = text.trim();
  if (t.length <= max) return t;
  if (max <= 1) return '…';
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * Prefer a real contact/group name; otherwise normalize the WhatsApp id so charts never show
 * opaque 15-digit privacy ids as if they were meaningful numbers.
 */
export function formatChatLabel(chatId: string, chatName?: string | null): ChatLabel {
  const name = (chatName || '').trim();
  const { local, domain } = stripJid(chatId);
  const digitsOnly = /^\d+$/.test(local);

  // Named contact — ignore names that are just the raw id / digits (no improvement).
  const nameIsJustId =
    !name ||
    name === chatId ||
    name === local ||
    (digitsOnly && name.replace(/\D/g, '') === local);

  if (name && !nameIsJustId) {
    return {
      kind: 'named',
      full: name,
      short: truncateLabel(name, 16),
    };
  }

  if (domain === 'g.us' || local.endsWith('-group')) {
    const full = `Group · ${truncateLabel(local, 10)}`;
    return { kind: 'group', full, short: truncateLabel(full, 16) };
  }

  if (domain === 'lid' || (digitsOnly && local.length >= LID_HINT_MIN_DIGITS && domain !== 'c.us' && domain !== 's.whatsapp.net')) {
    const tail = local.slice(-4);
    const full = `Private contact · ···${tail}`;
    return { kind: 'lid', full, short: `Private ···${tail}` };
  }

  if (domain === 'newsletter') {
    const full = `Channel · ${truncateLabel(local, 10)}`;
    return { kind: 'channel', full, short: truncateLabel(full, 16) };
  }

  if (domain === 'broadcast' || local === 'status') {
    return { kind: 'status', full: 'Status / broadcast', short: 'Status' };
  }

  if ((domain === 'c.us' || domain === 's.whatsapp.net' || (!domain && digitsOnly)) && digitsOnly) {
    // Bare short digit strings can still be phones; long bare digits already handled as lid above.
    if (!domain && local.length >= LID_HINT_MIN_DIGITS) {
      const tail = local.slice(-4);
      const full = `Private contact · ···${tail}`;
      return { kind: 'lid', full, short: `Private ···${tail}` };
    }
    const full = formatPhoneDigits(local);
    return { kind: 'phone', full, short: truncateLabel(full, 16) };
  }

  const fallback = local || chatId || 'Unknown chat';
  return {
    kind: 'unknown',
    full: fallback,
    short: truncateLabel(fallback, 16),
  };
}
