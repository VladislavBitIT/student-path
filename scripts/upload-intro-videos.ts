import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Run once with a private env file. The bot token and returned media tokens never go to stdout.
const secretFile = process.argv[2];
if (!secretFile || !isAbsolute(secretFile)) {
  throw new Error('Usage: upload-intro-videos <absolute-secrets.env-path>');
}
const file = resolve(secretFile);
const current = await readFile(file, 'utf8');
const mode = (await stat(file)).mode & 0o777;
if (mode !== 0o600) throw new Error('The secrets file must have mode 600');
const lines = current.trimEnd().split('\n');
const values = new Map<string, string>();
for (const line of lines) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match) values.set(match[1]!, match[2]!);
}
const botToken = values.get('MAX_BOT_TOKEN');
if (!botToken) throw new Error('MAX_BOT_TOKEN is missing from the secrets file');

async function uploadVideo(path: string): Promise<string> {
  const data = await readFile(path);
  if (data.length > 250 * 1024 * 1024) throw new Error('Intro video exceeds MAX 250 MB limit');
  let prepared: Response;
  try {
    prepared = await fetch('https://platform-api2.max.ru/uploads?type=video', {
      method: 'POST',
      headers: { Authorization: botToken! },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('MAX upload preparation could not connect');
  }
  if (!prepared.ok) throw new Error(`MAX upload preparation failed: HTTP ${prepared.status}`);
  const result = (await prepared.json()) as { url?: unknown; token?: unknown };
  if (typeof result.url !== 'string' || typeof result.token !== 'string' || !result.token) {
    throw new Error('MAX upload preparation returned no URL or token');
  }
  let uploadUrl: URL;
  try {
    uploadUrl = new URL(result.url);
  } catch {
    throw new Error('MAX upload preparation returned an invalid URL');
  }
  if (uploadUrl.protocol !== 'https:' || !/(^|\.)okcdn\.ru$/.test(uploadUrl.hostname)) {
    throw new Error('MAX upload preparation returned an unexpected upload host');
  }
  const body = new FormData();
  body.set('data', new Blob([new Uint8Array(data)], { type: 'video/mp4' }), basename(path));
  let uploaded: Response;
  try {
    uploaded = await fetch(uploadUrl, { method: 'POST', body, signal: AbortSignal.timeout(300_000) });
  } catch {
    throw new Error('MAX video upload could not connect or timed out');
  }
  if (!uploaded.ok || !(await uploaded.text()).includes('<retval>1</retval>')) {
    throw new Error(`MAX video upload failed: HTTP ${uploaded.status}`);
  }
  return result.token;
}

let added = 0;
for (const [name, path] of [
  ['MAX_INTRO_VIDEO_RU_TOKEN', resolve('assets/bot-intro/student-path-ru.mp4')],
  ['MAX_INTRO_VIDEO_EN_TOKEN', resolve('assets/bot-intro/student-path-en.mp4')],
] as const) {
  if (values.get(name)) continue;
  const token = await uploadVideo(path);
  values.set(name, token);
  lines.push(`${name}=${token}`);
  const temporary = resolve(dirname(file), `.secrets.env.${randomUUID()}`);
  try {
    await writeFile(temporary, `${lines.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } catch (error) {
    await import('node:fs/promises').then(({ unlink }) => unlink(temporary).catch(() => undefined));
    throw error;
  }
  added += 1;
}
console.info(
  `Intro videos uploaded: ${added}; existing tokens reused: ${2 - added}. Allow processing time before release.`,
);
