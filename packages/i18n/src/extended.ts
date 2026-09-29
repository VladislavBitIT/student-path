import { baseOverlays } from './base-overlays.js';
import { routeOverlays } from './route-overlays.js';

export const localeOverlays: typeof baseOverlays = {
  kk: { ...baseOverlays.kk, ...routeOverlays.kk },
  uz: { ...baseOverlays.uz, ...routeOverlays.uz },
  tk: { ...baseOverlays.tk, ...routeOverlays.tk },
  'zh-CN': { ...baseOverlays['zh-CN'], ...routeOverlays['zh-CN'] },
  hi: { ...baseOverlays.hi, ...routeOverlays.hi },
};
