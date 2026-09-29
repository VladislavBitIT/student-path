import { describe, expect, it } from 'vitest';
import { isValidIsoDate, supportedLanguages, languageChoices } from '@first30/domain';
import { onboardingFlow } from '@first30/config';
import { isValidCallbackPayload } from '@first30/max-adapter';
import {
  expectedQuestionIdForCallback,
  formatNextAction,
  isExpectedOnboardingCallback,
  mainMenuButtonRows,
  normalizeArrivalDateInput,
} from '@first30/application';

describe('MAX bot conversation contract', () => {
  it('binds every onboarding callback to exactly one expected question', () => {
    expect(expectedQuestionIdForCallback('onb_lang_en')).toBe('ONB_01_LANGUAGE');
    expect(expectedQuestionIdForCallback('onb_answer:ONB_01_INTRO:continue')).toBe('ONB_01_INTRO');
    expect(expectedQuestionIdForCallback('onb_date_entry:ONB_06_PLANNED_DATE')).toBe('ONB_06_PLANNED_DATE');
    expect(expectedQuestionIdForCallback('onb_date_entry:ONB_06_ENTRY_DATE')).toBe('ONB_06_ENTRY_DATE');
    expect(expectedQuestionIdForCallback('onb_back:ONB_06_PLANNED_DATE')).toBe('ONB_06_PLANNED_DATE');
    expect(expectedQuestionIdForCallback('onb_status_arrived')).toBe('ONB_05_ARRIVAL_STATUS');
    expect(expectedQuestionIdForCallback('onb_home_relatives')).toBe('ONB_07_ACCOMMODATION');
    expect(expectedQuestionIdForCallback('onb_reminders_yes')).toBeNull();
    expect(expectedQuestionIdForCallback('menu_next')).toBeNull();

    expect(isExpectedOnboardingCallback('onb_home_private', 'ONB_07_ACCOMMODATION')).toBe(true);
    expect(isExpectedOnboardingCallback('onb_home_private', 'ONB_05_ARRIVAL_STATUS')).toBe(false);
    expect(isExpectedOnboardingCallback('onb_lang_ru', undefined)).toBe(false);
    expect(isExpectedOnboardingCallback('onb_answer:ONB_01_INTRO:continue', 'ONB_01_INTRO')).toBe(true);
  });

  it('offers seven native-name language choices and localized menu actions', () => {
    const choices = onboardingFlow.questions.find((question) => question.id === 'ONB_01_LANGUAGE')?.options;
    expect(choices?.map((option) => option.value)).toEqual(supportedLanguages);
    expect(supportedLanguages.map((language) => languageChoices[language].flag)).toHaveLength(7);
    const expected = ['menu_today', 'menu_next', 'menu_situation', 'menu_ask', 'menu_human', 'menu_reminders'];
    for (const language of supportedLanguages) {
      const buttons = mainMenuButtonRows(language).flat();
      expect(buttons.map((button) => button.payload)).toEqual(expected);
      expect(buttons.every((button) => button.text.length > 0 && isValidCallbackPayload(button.payload))).toBe(true);
    }
  });

  it('uses strict calendar validation for an onboarding arrival date', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-2-8')).toBe(false);
    expect(normalizeArrivalDateInput('28.02.2026')).toBe('2026-02-28');
    expect(normalizeArrivalDateInput('31.02.2026')).toBe('31.02.2026');
    expect(normalizeArrivalDateInput('2026-02-28')).toBe('2026-02-28');
  });

  it('shows a university action with documents and its official source in the bot', () => {
    const message = formatNextAction('ru', {
      progress: { completed: 0, total: 1, percent: 0 },
      nextAction: {
        code: 'NSU_STUDENT_ACCOUNT',
        title: 'Получить учётную запись НГУ',
        description: 'Используйте резервную почту для задания пароля.',
        preparation: ['Резервная почта из заявления'],
        contact: '4141@nsu.ru',
        deadline: null,
        scope: 'university',
        source: {
          title: 'НГУ: университетский аккаунт',
          url: 'https://help.nsu.ru/pages/viewpage.action?pageId=17174184',
        },
      },
    });
    expect(message).toContain('Правило вашего вуза');
    expect(message).toContain('Резервная почта из заявления');
    expect(message).toContain('4141@nsu.ru');
    expect(message).toContain('https://help.nsu.ru/pages/viewpage.action?pageId=17174184');
    expect(message).toContain('срок нужно уточнить');
  });

  it('does not label a demonstration step or its deadline as verified', () => {
    const message = formatNextAction('ru', {
      progress: { completed: 0, total: 1, percent: 0 },
      nextAction: {
        code: 'ARCHIVE_STEP',
        title: 'Проверить документы',
        description: 'Описание',
        preparation: [],
        contact: null,
        deadline: '2026-09-27',
        scope: 'university',
        verificationStatus: 'demo',
        source: { title: 'Памятка', url: 'https://example.test/source' },
      },
    });
    expect(message).toContain('Ориентир по открытым источникам');
    expect(message).toContain('Источник для уточнения');
    expect(message).not.toContain('2026-09-27');
    expect(message).not.toContain('Правило вашего вуза');
  });
});
