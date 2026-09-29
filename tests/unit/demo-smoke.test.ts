import { spawn } from 'node:child_process';
import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function smoke(baseUrl: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/demo-smoke.ts'], {
    env: { ...process.env, APP_BASE_URL: baseUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { code, output };
}

async function mockServer(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('demo smoke safety boundary', () => {
  it.each(['https://student-way.tw1.su', 'https://localhost.example.org', 'http://localhost/api'])(
    'rejects %s before any request',
    async (baseUrl) => {
      const result = await smoke(baseUrl);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain('no requests sent');
    },
  );

  it('does not attempt dev auth against a local API configured for real MAX', async () => {
    const paths: string[] = [];
    const baseUrl = await mockServer((request, response) => {
      paths.push(request.url ?? '');
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify(
          request.url === '/health/live' ? { status: 'ok' } : { status: 'ready', database: 'ok', maxProvider: 'real' },
        ),
      );
    });
    const result = await smoke(baseUrl);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('dev auth was not attempted');
    expect(paths).toEqual(['/health/live', '/health/ready']);
  });

  it('does not follow redirects from an allowed host', async () => {
    const paths: string[] = [];
    const baseUrl = await mockServer((request, response) => {
      paths.push(request.url ?? '');
      response.writeHead(302, { Location: '/must-not-be-requested' });
      response.end();
    });
    const result = await smoke(baseUrl);
    expect(result.code).not.toBe(0);
    expect(paths).toEqual(['/health/live']);
  });
});
