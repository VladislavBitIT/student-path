interface MaxWebAppBridge {
  initData?: unknown;
  openLink?: (url: string) => void;
}

declare global {
  interface Window {
    WebApp?: MaxWebAppBridge;
  }
}

/**
 * Security boundary for MAX Bridge. The client reads only the original signed
 * initData string. Identity fields from initDataUnsafe are deliberately absent.
 */
export function getMaxInitData(location: Location = window.location): string | null {
  const initData = window.WebApp?.initData;
  if (typeof initData === 'string' && initData.length > 0) return initData;

  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fragmentValues = fragment.getAll('WebAppData');
  if (fragmentValues.length !== 1) return null;
  const fragmentData = fragmentValues[0];
  return fragmentData && fragmentData.length <= 16_384 ? fragmentData : null;
}

export function getMaxLaunchUrl(botUsername: string | undefined): string | null {
  if (!botUsername || !/^[A-Za-z0-9_.-]{1,100}$/.test(botUsername)) return null;
  return `https://max.ru/${encodeURIComponent(botUsername)}?startapp`;
}

/** MAX opens external pages through its bridge after a user click; browsers use the anchor fallback. */
export function openMaxExternalLink(url: string): boolean {
  if (!/^https:\/\//i.test(url) || typeof window.WebApp?.openLink !== 'function') return false;
  try {
    window.WebApp.openLink(url);
    return true;
  } catch {
    return false;
  }
}

export function getStartPayload(location: Location = window.location): string | null {
  // Navigation hint only: never used for identity or authorization.
  const signedData = getMaxInitData(location);
  const query = new URLSearchParams(location.search);
  const raw =
    (signedData ? new URLSearchParams(signedData).get('start_param') : null) ??
    query.get('WebAppStartParam') ??
    query.get('startapp');
  if (!raw || raw.length > 512) return null;

  const match = /^step_([A-Za-z0-9_-]{1,96})$/.exec(raw);
  return match?.[1] ?? null;
}
