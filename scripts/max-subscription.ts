import { loadRuntimeConfig } from '@first30/config';

const action = process.argv[2];
if (!['create', 'ensure', 'list', 'delete'].includes(action ?? '')) {
  throw new Error('Usage: max-subscription <create|ensure|list|delete>');
}
const config = loadRuntimeConfig();
if (config.maxProvider !== 'real' || !config.maxBotToken)
  throw new Error('MAX_PROVIDER=real and MAX_BOT_TOKEN are required');
if (!config.maxWebhookPublicUrl || !config.maxWebhookSecret)
  throw new Error('MAX_WEBHOOK_PUBLIC_URL and MAX_WEBHOOK_SECRET are required');
const maxBotToken = config.maxBotToken;
const maxWebhookPublicUrl = config.maxWebhookPublicUrl;
const maxWebhookSecret = config.maxWebhookSecret;

const endpoint = `${config.maxApiBaseUrl}/subscriptions`;
const requestCreate = () =>
  fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: maxBotToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: maxWebhookPublicUrl,
      update_types: ['message_created', 'message_callback', 'bot_started', 'bot_stopped'],
      secret: maxWebhookSecret,
    }),
  });

let response =
  action === 'create'
    ? await requestCreate()
    : action === 'ensure'
      ? await fetch(endpoint, { headers: { Authorization: maxBotToken } })
      : action === 'delete'
        ? await fetch(`${endpoint}?url=${encodeURIComponent(maxWebhookPublicUrl)}`, {
            method: 'DELETE',
            headers: { Authorization: maxBotToken },
          })
        : await fetch(endpoint, { headers: { Authorization: maxBotToken } });

let payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
if (!response.ok || payload.success === false) {
  throw new Error(
    `MAX subscription ${action} failed: HTTP ${response.status}; ${String(payload.message ?? 'no message')}`,
  );
}

if (action === 'ensure') {
  const subscriptions = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
  const alreadyRegistered = subscriptions.some(
    (item) =>
      item && typeof item === 'object' && 'url' in item && (item as { url?: unknown }).url === maxWebhookPublicUrl,
  );
  if (!alreadyRegistered) {
    response = await requestCreate();
    payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || payload.success === false) {
      throw new Error(
        `MAX subscription create failed: HTTP ${response.status}; ${String(payload.message ?? 'no message')}`,
      );
    }
  }
  console.info(alreadyRegistered ? 'MAX webhook already registered' : 'MAX webhook registered');
} else if (action === 'list') {
  const subscriptions = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
  console.info(
    JSON.stringify(
      subscriptions.map((item) => {
        if (!item || typeof item !== 'object') return {};
        const subscription = item as Record<string, unknown>;
        return { url: subscription.url, updateTypes: subscription.update_types };
      }),
      null,
      2,
    ),
  );
} else {
  console.info(`MAX subscription ${action} completed`);
}
