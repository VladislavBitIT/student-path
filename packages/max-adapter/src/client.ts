import { parseJsonLossless } from './json.js';

export interface OutboundMessage {
  text: string;
  attachments?: unknown[];
  link?: { type: string; [key: string]: unknown };
  notify?: boolean;
}

export interface MaxDeliveryResult {
  providerMessageId?: string;
}

export class MaxTransportError extends Error {
  constructor(
    message: string,
    public readonly kind: 'transient' | 'permanent' | 'ambiguous',
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'MaxTransportError';
  }
}

export interface MaxClient {
  sendToUser(userId: string, message: OutboundMessage): Promise<MaxDeliveryResult>;
  answerCallback(callbackId: string, message?: OutboundMessage, notification?: string): Promise<void>;
}

export interface MaxUpdatesPage {
  updates: Record<string, unknown>[];
  marker?: string;
}

export class RealMaxUpdatePoller {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async poll(marker?: string, signal?: AbortSignal): Promise<MaxUpdatesPage> {
    const parameters = new URLSearchParams({
      limit: '100',
      timeout: '30',
      types: 'message_created,message_callback,bot_started,bot_stopped',
    });
    if (marker) parameters.set('marker', marker);
    const response = await this.request(`${this.baseUrl}/updates?${parameters.toString()}`, {
      headers: { Authorization: this.token },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000),
    });
    if (!response.ok) {
      const kind = response.status === 429 || response.status >= 500 ? 'transient' : 'permanent';
      throw new MaxTransportError(`MAX updates returned ${response.status}`, kind, response.status);
    }
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = parseJsonLossless(text);
    } catch {
      throw new MaxTransportError('MAX updates returned invalid JSON', 'transient');
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { updates?: unknown }).updates)) {
      throw new MaxTransportError('MAX updates response has invalid shape', 'transient');
    }
    const updates = (parsed as { updates: unknown[] }).updates.filter(
      (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    );
    const markerValue = (parsed as { marker?: unknown }).marker;
    const nextMarker =
      typeof markerValue === 'string' && /^[0-9]+$/.test(markerValue)
        ? markerValue
        : typeof markerValue === 'number' && Number.isSafeInteger(markerValue) && markerValue >= 0
          ? String(markerValue)
          : undefined;
    return { updates, marker: nextMarker };
  }
}

async function parseSuccess(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.code === 'attachment.not.ready') {
    throw new MaxTransportError('MAX attachment is still processing', 'transient', response.status, 30_000);
  }
  if (!response.ok) {
    const kind =
      response.status === 429
        ? 'transient'
        : response.status >= 500 || response.status === 408
          ? 'ambiguous'
          : 'permanent';
    const retryAfterSeconds = Number(response.headers.get('retry-after'));
    const retryAfterMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds * 1000 : undefined;
    throw new MaxTransportError(`MAX API returned ${response.status}`, kind, response.status, retryAfterMs);
  }
  if (body.success === false) throw new MaxTransportError('MAX API rejected request', 'permanent');
  return body;
}

export class RealMaxClient implements MaxClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async sendToUser(userId: string, message: OutboundMessage): Promise<MaxDeliveryResult> {
    const send = async (payload: OutboundMessage) => {
      let response: Response;
      try {
        response = await this.request(`${this.baseUrl}/messages?user_id=${encodeURIComponent(userId)}`, {
          method: 'POST',
          headers: { Authorization: this.token, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        throw new MaxTransportError(error instanceof Error ? error.message : 'Unknown network error', 'ambiguous');
      }
      return parseSuccess(response);
    };
    let body: Record<string, unknown>;
    try {
      body = await send(message);
    } catch (error) {
      const attachments = message.attachments ?? [];
      const imageRejected =
        error instanceof MaxTransportError &&
        error.kind === 'permanent' &&
        (error.status === undefined || [400, 413, 422].includes(error.status)) &&
        attachments.some((attachment) =>
          Boolean(attachment && typeof attachment === 'object' && 'type' in attachment && attachment.type === 'image'),
        );
      if (!imageRejected) throw error;
      body = await send({
        ...message,
        attachments: attachments.filter(
          (attachment) =>
            !(attachment && typeof attachment === 'object' && 'type' in attachment && attachment.type === 'image'),
        ),
      });
    }
    const providerMessageId =
      typeof body.message === 'object' && body.message && 'body' in body.message ? undefined : undefined;
    return { providerMessageId };
  }

  async answerCallback(callbackId: string, message?: OutboundMessage, notification = 'Готово'): Promise<void> {
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}/answers?callback_id=${encodeURIComponent(callbackId)}`, {
        method: 'POST',
        headers: { Authorization: this.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(message ? { message } : { notification }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new MaxTransportError(error instanceof Error ? error.message : 'Unknown network error', 'ambiguous');
    }
    await parseSuccess(response);
  }
}
