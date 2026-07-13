/**
 * Canonical message-type vocabulary for stats, charts, and display labels.
 * Keep in sync with {@link MessageType} in the engine interface.
 */

export const MESSAGE_TYPE_ORDER = [
  'text',
  'emoji',
  'image',
  'gif',
  'video',
  'sticker',
  'audio',
  'voice',
  'document',
  'location',
  'contact',
  'poll',
  'call',
  'revoked',
  'masked',
  'unknown',
] as const;

export type CanonicalMessageType = (typeof MESSAGE_TYPE_ORDER)[number];

/** Legacy / engine-specific tokens → neutral chart category. */
const TYPE_ALIASES: Record<string, CanonicalMessageType> = {
  chat: 'text',
  conversation: 'text',
  ptt: 'voice',
  vcard: 'contact',
  multi_vcard: 'contact',
  call_log: 'call',
  poll_creation: 'poll',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  stickerMessage: 'sticker',
  locationMessage: 'location',
  contactMessage: 'contact',
  album: 'image',
  // Interactive / list payloads still carry readable text for operators.
  list: 'text',
  list_response: 'text',
  buttons_response: 'text',
  interactive: 'text',
  template_button_reply: 'text',
  hsm: 'text',
  groups_v4_invite: 'text',
  order: 'document',
  product: 'document',
  payment: 'document',
  // Animations WhatsApp stores under video/image with an isGif flag may already be 'gif'.
  animated: 'gif',
};

/**
 * Collapse raw/legacy/engine tokens into a single chart category.
 */
export function normalizeMessageType(raw: string | null | undefined): CanonicalMessageType {
  if (!raw || !String(raw).trim()) return 'unknown';
  const key = String(raw).trim().toLowerCase();
  if ((MESSAGE_TYPE_ORDER as readonly string[]).includes(key)) {
    return key as CanonicalMessageType;
  }
  return TYPE_ALIASES[key] ?? 'unknown';
}

/** True when the body is only emoji / ZWJ sequences (short reaction-style texts). */
export function isEmojiOnlyBody(body: string | null | undefined): boolean {
  if (!body) return false;
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 48) return false;
  // Allow pictographs, emoji presentation, skin tones, ZWJ, VS16, and whitespace.
  return /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Modifier_Base}\s\u200d\ufe0f\u20e3]+$/u.test(
    trimmed,
  );
}

/** Human labels for dashboard charts (English; UI may further i18n). */
export const MESSAGE_TYPE_LABELS: Record<CanonicalMessageType, string> = {
  text: 'Text',
  emoji: 'Emoji',
  image: 'Image',
  gif: 'GIF',
  video: 'Video',
  sticker: 'Sticker',
  audio: 'Audio',
  voice: 'Voice note',
  document: 'Document',
  location: 'Location',
  contact: 'Contact',
  poll: 'Poll',
  call: 'Call',
  revoked: 'Deleted',
  masked: 'Masked',
  unknown: 'Other',
};
