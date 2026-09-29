import { validateI18nDictionaries } from '@first30/domain';
import { dictionaries } from '@first30/i18n';
import { localeOverlays } from '../packages/i18n/src/extended.js';
import { en as miniappEnglish } from '../apps/miniapp/src/i18n.js';
import { miniappLocaleOverlays } from '../apps/miniapp/src/locale-overlays.js';

const issues = [...validateI18nDictionaries(dictionaries)];
for (const [language, overlay] of Object.entries(localeOverlays)) {
  for (const key of Object.keys(dictionaries.en)) {
    if (!overlay[key]?.trim()) {
      issues.push({ code: 'missing_translation', path: `i18n.${language}.${key}`, message: 'Untranslated locale key' });
    }
  }
}
const miniPlaceholders = (value: string) =>
  [...value.matchAll(/(?<!\{)\{([a-zA-Z]+)\}(?!\})/g)]
    .map((match) => match[1])
    .sort()
    .join('|');
for (const [language, overlay] of Object.entries(miniappLocaleOverlays)) {
  for (const [key, baseline] of Object.entries(miniappEnglish)) {
    if (!overlay[key]?.trim()) {
      issues.push({
        code: 'missing_translation',
        path: `miniapp.${language}.${key}`,
        message: 'Untranslated locale key',
      });
    } else if (miniPlaceholders(overlay[key]) !== miniPlaceholders(baseline)) {
      issues.push({
        code: 'placeholder_mismatch',
        path: `miniapp.${language}.${key}`,
        message: 'Placeholder mismatch',
      });
    }
  }
}
if (issues.length) {
  const byLanguage = Object.entries(localeOverlays).map(
    ([language]) =>
      `${language}: ${issues.filter((issue) => issue.path.startsWith(`i18n.${language}.`) || issue.path.startsWith(`miniapp.${language}.`)).length} missing`,
  );
  console.error(`i18n incomplete: ${byLanguage.join(', ')}`);
  for (const issue of issues
    .filter((issue) => !issue.path.startsWith('i18n.') && !issue.path.startsWith('miniapp.'))
    .slice(0, 20))
    console.error(`${issue.code} ${issue.path}: ${issue.message}`);
  process.exitCode = 1;
} else {
  console.info(`i18n dictionaries are aligned (${Object.keys(dictionaries.en).length} keys)`);
}
