import { createHash } from 'node:crypto';
import { Keyboard } from '@maxhub/max-bot-api';

export interface NormalizedMaxUpdate {
  type: string;
  userId?: string;
  text?: string;
  callbackId?: string;
  callbackPayload?: string;
  providerKey: string;
  raw: Record<string, unknown>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function stringId(value: unknown): string | undefined {
  // Official MAX ids are decimal int64 values. Safe non-numeric strings are
  // accepted only to support the explicit mock/dev identity adapter.
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}

export function normalizeMaxUpdate(raw: Record<string, unknown>): NormalizedMaxUpdate {
  const updateType =
    typeof raw.update_type === 'string' ? raw.update_type : typeof raw.type === 'string' ? raw.type : 'unknown';
  const message = raw.message && typeof raw.message === 'object' ? (raw.message as Record<string, unknown>) : undefined;
  const body =
    message?.body && typeof message.body === 'object' ? (message.body as Record<string, unknown>) : undefined;
  const sender =
    message?.sender && typeof message.sender === 'object' ? (message.sender as Record<string, unknown>) : undefined;
  const callback =
    raw.callback && typeof raw.callback === 'object' ? (raw.callback as Record<string, unknown>) : undefined;
  const callbackUser =
    callback?.user && typeof callback.user === 'object' ? (callback.user as Record<string, unknown>) : undefined;
  const directUser = raw.user && typeof raw.user === 'object' ? (raw.user as Record<string, unknown>) : undefined;
  const callbackId = typeof callback?.callback_id === 'string' ? callback.callback_id : undefined;
  const messageId = typeof body?.mid === 'string' ? body.mid : undefined;
  const providerKey = callbackId
    ? `callback:${callbackId}`
    : messageId
      ? `message:${messageId}`
      : `fingerprint:${createHash('sha256').update(canonical(raw)).digest('hex')}`;

  return {
    type: updateType,
    userId: stringId(
      updateType === 'message_callback' ? callbackUser?.user_id : (sender?.user_id ?? directUser?.user_id),
    ),
    text: typeof body?.text === 'string' ? body.text : undefined,
    callbackId,
    callbackPayload: typeof callback?.payload === 'string' ? callback.payload : undefined,
    providerKey,
    raw,
  };
}

export function isValidCallbackPayload(payload: string): boolean {
  return payload.length > 0 && payload.length <= 128 && /^[A-Za-z0-9:_-]+$/.test(payload);
}

export function createStartAppLink(botUsername: string, stepCode?: string): string {
  const payload = stepCode ? `step_${stepCode}` : undefined;
  if (payload && (payload.length > 512 || !/^[A-Za-z0-9_-]+$/.test(payload)))
    throw new Error('Invalid startapp payload');
  return `https://max.ru/${encodeURIComponent(botUsername)}?startapp${payload ? `=${payload}` : ''}`;
}

export function createShareLink(text: string): string {
  return `https://max.ru/:share?text=${encodeURIComponent(text)}`;
}

export function createOpenAppKeyboard(label: string, botUsername: string, stepCode?: string): unknown {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(botUsername)) throw new Error('Invalid mini app bot username');
  const payload = stepCode ? `step_${stepCode}` : undefined;
  if (payload && !/^[A-Za-z0-9_-]{1,512}$/.test(payload)) throw new Error('Invalid open_app payload');
  return Keyboard.inlineKeyboard([[Keyboard.button.openApp(label, botUsername, undefined, payload)]]);
}

export function createCallbackKeyboard(rows: Array<Array<{ text: string; payload: string }>>): unknown {
  for (const row of rows) {
    for (const button of row) {
      if (!isValidCallbackPayload(button.payload)) throw new Error('Invalid callback payload');
    }
  }
  return Keyboard.inlineKeyboard(
    rows.map((row) => row.map((button) => Keyboard.button.callback(button.text, button.payload))),
  );
}

/** MAX accepts one inline keyboard attachment per message. */
export function createAppMenuKeyboard(
  appLabel: string,
  botUsername: string,
  rows: Array<Array<{ text: string; payload: string }>>,
  stepCode?: string,
): unknown {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(botUsername)) throw new Error('Invalid mini app bot username');
  for (const row of rows) {
    for (const button of row) {
      if (!isValidCallbackPayload(button.payload)) throw new Error('Invalid callback payload');
    }
  }
  const payload = stepCode ? `step_${stepCode}` : undefined;
  if (payload && !/^[A-Za-z0-9_-]{1,512}$/.test(payload)) throw new Error('Invalid open_app payload');
  return Keyboard.inlineKeyboard([
    [Keyboard.button.openApp(appLabel, botUsername, undefined, payload)],
    ...rows.map((row) => row.map((button) => Keyboard.button.callback(button.text, button.payload))),
  ]);
}
