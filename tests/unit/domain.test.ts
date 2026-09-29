import { describe, expect, it } from 'vitest';

import {
  MockLlmAdapter,
  NoneLlmAdapter,
  answerFromKnowledge,
  answerOnboardingQuestion,
  calculateDeadline,
  calculateProgress,
  calculateRouteStage,
  createOnboardingState,
  extractAccommodationEventCandidate,
  goBackOnboarding,
  reconcileRoute,
  retrieveKnowledge,
  validateContent,
  validateGroundedAnswerResult,
  validateI18nDictionaries,
  type PreviousRouteStep,
  type StepDefinition,
  type UserProfile,
} from '../../packages/domain/src/index.js';
import {
  itmoKnowledgeDocuments,
  itmoSources,
  itmoStepDefinitions,
  itmoUniversityConfig,
  onboardingFlow,
  commonStepDefinitions,
  directoryStepDefinitions,
  universityConfigs,
  universityDirectory,
  universityActionSteps,
} from '../../packages/config/src/index.js';
import { dictionaries, translate } from '../../packages/i18n/src/index.js';
import { universityActions } from '../../packages/config/src/university-actions.js';
import { translate as translateMiniapp } from '../../apps/miniapp/src/i18n.js';

const NOW = '2026-09-21T09:00:00.000Z';

it('uses a Russian public name and Russian copy in the Russian interface', () => {
  expect(translate('ru', 'app.name')).toBe('Путь студента');
  expect(translateMiniapp('ru', 'appName')).toBe('Путь студента');
  for (const text of [
    ...Object.values(dictionaries.ru),
    ...(['appName', 'pilot', 'demo', 'overallProgress', 'deactivated', 'english'] as const).map((key) =>
      translateMiniapp('ru', key),
    ),
  ]) {
    expect(text.replaceAll(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '')).not.toMatch(
      /StudyWay|onboarding|demo|pilot|webhook|International/i,
    );
  }
});

function profile(accommodationType: UserProfile['accommodationType']): UserProfile {
  return {
    userId: 'user-1',
    universityCode: 'ITMO',
    arrivalStatus: 'preparing',
    arrivalDate: '2026-09-24',
    accommodationType,
    remindersEnabled: false,
  };
}

function routeFor(
  accommodationType: UserProfile['accommodationType'],
  previousSteps: readonly PreviousRouteStep[] = [],
  previousVersion = 0,
) {
  return reconcileRoute({
    profile: profile(accommodationType),
    university: itmoUniversityConfig,
    stepDefinitions: itmoStepDefinitions,
    previousSteps,
    previousVersion,
    now: NOW,
  });
}

function completeStep(steps: readonly PreviousRouteStep[], code: string): readonly PreviousRouteStep[] {
  return steps.map((step) =>
    step.code === code
      ? {
          code: step.code,
          status: 'COMPLETED' as const,
          isActive: step.isActive,
          deadline: step.deadline,
          completedAt: '2026-09-21T10:00:00.000Z',
        }
      : step,
  );
}

describe('post-enrollment directory routes', () => {
  function routeCase(
    universityCode: string,
    attributes: NonNullable<UserProfile['attributes']>,
    accommodationType: UserProfile['accommodationType'] = 'private',
    arrivalStatus: UserProfile['arrivalStatus'] = 'preparing',
  ) {
    return reconcileRoute({
      profile: {
        universityCode,
        arrivalStatus,
        arrivalDate: null,
        accommodationType,
        remindersEnabled: false,
        attributes,
      },
      university: universityConfigs[universityCode]!,
      stepDefinitions: [
        ...commonStepDefinitions,
        ...directoryStepDefinitions.filter((step) => step.universityCode === universityCode),
      ],
      now: NOW,
    });
  }

  it('does not ask students with known private housing to confirm an unknown dormitory situation', () => {
    const base = { citizenshipType: 'foreign', mobilityStatus: 'moving', campusCode: 'main' };
    expect(routeCase('HSE', { ...base, housingStatus: 'private' }).activeStepCodes).not.toContain(
      'CHECK_HOUSING_STATUS',
    );
    expect(routeCase('HSE', { ...base, housingStatus: 'unknown' }).activeStepCodes).toContain('CHECK_HOUSING_STATUS');
  });

  it('does not offer a dormitory application after the place is confirmed', () => {
    const cases = [
      ['MIPT', 'MIPT_DORM_APPLICATION', 'MIPT_DORM_DOCUMENTS'],
      ['HSE', 'HSE_NN_DORM_APPLICATION', 'HSE_NN_DORM_DOCUMENTS'],
      ['ITMO', 'ITMO_DORM_APPLICATION', 'ITMO_DORM_MIGRATION'],
      ['ITMO', 'ITMO_DORM_QUEUE', 'ITMO_DORM_MIGRATION'],
      ['KFU', 'KFU_DORM_APPLICATION', 'KFU_DORM_FOREIGN_PACKAGE_2026'],
      ['SPBU', 'SPBU_DORM_ASSIGNMENT', 'SPBU_DORM_REGISTRATION'],
      ['RUDN', 'RUDN_DORM_ADAPTATION', 'RUDN_DORM_PACKAGE'],
    ] as const;
    for (const [university, applicationCode, moveInCode] of cases) {
      const campusCode = university === 'HSE' ? 'nnov' : 'main';
      const base = {
        citizenshipType: 'foreign',
        campusCode,
        mobilityStatus: 'moved',
        enrollmentState: 'admitted',
        admissionYear: 2026,
        programLevel: 'bachelor_specialist',
      };
      const confirmed = routeCase(university, { ...base, housingStatus: 'confirmed' }, 'dormitory', 'arrived');
      expect(confirmed.activeStepCodes, `${university}: confirmed place`).not.toContain(applicationCode);
      expect(confirmed.activeStepCodes, `${university}: next meaningful step`).toContain(moveInCode);
      expect(confirmed.nextAction?.code, `${university}: next action`).not.toBe(applicationCode);
      expect(confirmed.activeStepCodes.length, `${university}: meaningful route`).toBeGreaterThan(0);
      const unknown = routeCase(university, { ...base, housingStatus: 'unknown' }, 'dormitory', 'arrived');
      expect(unknown.activeStepCodes, `${university}: place unknown`).toContain(applicationCode);
      expect(unknown.activeStepCodes, `${university}: no duplicate housing check`).not.toContain(
        'CHECK_HOUSING_STATUS',
      );
    }
  });

  it('shows document preparation separately from the action for verified housing steps', () => {
    for (const code of [
      'MIPT_DORM_DOCUMENTS',
      'HSE_PERM_DORM',
      'HSE_SPB_MIGRATION_DORM',
      'ITMO_DORM_MIGRATION',
      'KFU_DORM_FOREIGN_PACKAGE_2026',
    ]) {
      const step = universityActionSteps.find((candidate) => candidate.code === code);
      expect(step?.preparationKeys.length, code).toBeGreaterThan(0);
      for (const key of step?.preparationKeys ?? []) {
        expect(translate('ru', key), `${code}: RU`).not.toBe(key);
        expect(translate('en', key), `${code}: EN`).not.toBe(key);
      }
    }
  });

  it('keeps MIPT housing rules separate by programme level and asks when it is unknown', () => {
    const base = { citizenshipType: 'rf', campusCode: 'main', mobilityStatus: 'moving', housingStatus: 'unknown' };
    const unknown = routeCase('MIPT', { ...base, programLevel: 'unknown' }, 'dormitory');
    expect(unknown.activeStepCodes).toContain('MIPT_CONFIRM_PROGRAM_LEVEL');
    expect(unknown.activeStepCodes).not.toContain('MIPT_DORM_APPLICATION');
    expect(unknown.activeStepCodes).not.toContain('MIPT_MASTER_DORM_APPLICATION');
    expect(unknown.activeStepCodes.length).toBeGreaterThan(1);

    const bachelor = routeCase('MIPT', { ...base, programLevel: 'bachelor_specialist' }, 'dormitory');
    expect(bachelor.activeStepCodes).toContain('MIPT_DORM_APPLICATION');
    expect(bachelor.activeStepCodes).not.toContain('MIPT_MASTER_DORM_APPLICATION');

    for (const programLevel of ['masters', 'postgraduate'] as const) {
      const route = routeCase('MIPT', { ...base, programLevel }, 'dormitory');
      expect(route.activeStepCodes).toContain('MIPT_MASTER_DORM_APPLICATION');
      expect(route.activeStepCodes).not.toContain('MIPT_DORM_APPLICATION');
    }
    const master = universityActions.find((action) => action.code === 'MIPT_MASTER_DORM_APPLICATION');
    expect(master?.sourceUrl).toBe('https://pk.mipt.ru/master/obshchezhitie-i-meditsinskoe-obsledovanie/');
    expect(master?.actionRu).toContain('не гарантируют комнату');
  });

  it('uses repaired official links and explicit contacts without making document lists exhaustive', () => {
    const action = (code: string) => universityActions.find((entry) => entry.code === code);
    expect(action('NSU_STUDENT_ACCOUNT')?.sourceUrl).toContain('help.nsu.ru/pages/viewpage.action');
    expect(action('SPBU_DORM_ASSIGNMENT')?.actionRu).toContain('911@spbu.ru');
    expect(action('ITMO_DORM_APPOINTMENT')?.actionRu).toContain('medinform@itmo.ru');
    expect(action('RUDN_DORM_PACKAGE')?.actionRu).toContain('cdc@rudn.ru');
    expect(action('RUDN_DORM_PACKAGE')?.actionRu).toContain('не считайте этот список полным');
  });

  it('keeps local RF students free from automatic move and military obligations', () => {
    const route = routeCase('MSU', {
      citizenshipType: 'rf',
      mobilityStatus: 'local',
      militaryStatus: 'no',
      campusCode: 'main',
    });
    expect(route.activeStepCodes).not.toContain('CHECK_RF_REGISTRATION');
    expect(route.activeStepCodes).not.toContain('CHECK_MILITARY_STATUS');
    expect(route.activeStepCodes).not.toContain('CHECK_FOREIGN_ENTRY');
    expect(route.activeStepCodes).toContain('CHECK_UNIVERSITY_FIRST_STEPS');
    expect(route.steps.every((step) => step.deadline === null)).toBe(true);
  });

  it('separates visa, visa-free, already-in-Russia and unknown entry situations', () => {
    const base = { citizenshipType: 'foreign', mobilityStatus: 'moving', campusCode: 'main', russiaPresence: 'no' };
    expect(routeCase('RUDN', { ...base, entryMode: 'visa' }).activeStepCodes).toContain('CHECK_VISA_ENTRY');
    expect(routeCase('RUDN', { ...base, entryMode: 'visa_free' }).activeStepCodes).toContain('CHECK_VISA_FREE_ENTRY');
    expect(
      routeCase('RUDN', { ...base, entryMode: 'already_in_russia', russiaPresence: 'yes' }).activeStepCodes,
    ).toContain('CHECK_CURRENT_STAY');
    expect(routeCase('RUDN', { ...base, entryMode: 'unknown' }).activeStepCodes).toContain('CHECK_FOREIGN_ENTRY');
    expect(routeCase('RUDN', { ...base, entryMode: 'visa' }).activeStepCodes).not.toContain('CHECK_RF_REGISTRATION');
  });

  it('uses status, not gender, for the military-registration clarification', () => {
    const base = { citizenshipType: 'rf', mobilityStatus: 'moving', campusCode: 'main' };
    expect(routeCase('NSU', { ...base, militaryStatus: 'yes' }).activeStepCodes).toContain('CHECK_MILITARY_STATUS');
    expect(routeCase('NSU', { ...base, militaryStatus: 'unknown' }).activeStepCodes).toContain('CHECK_MILITARY_STATUS');
    expect(routeCase('NSU', { ...base, militaryStatus: 'no' }).activeStepCodes).not.toContain('CHECK_MILITARY_STATUS');
    expect(routeCase('NSU', { ...base, militaryStatus: 'decline' }).activeStepCodes).not.toContain(
      'CHECK_MILITARY_STATUS',
    );
  });

  it('does not reuse 2026 housing campaigns for a different admission year or campus', () => {
    const base = {
      citizenshipType: 'rf',
      mobilityStatus: 'moving',
      campusCode: 'main',
      admissionYear: 2026,
      programLevel: 'bachelor_specialist',
    };
    expect(routeCase('HSE', base, 'dormitory').activeStepCodes).toContain('HSE_2026_RF_DORM');
    expect(routeCase('HSE', { ...base, admissionYear: 2027 }, 'dormitory').activeStepCodes).not.toContain(
      'HSE_2026_RF_DORM',
    );
    expect(routeCase('HSE', { ...base, campusCode: 'spb' }, 'dormitory').activeStepCodes).not.toContain(
      'HSE_2026_RF_DORM',
    );
    expect(routeCase('HSE', { ...base, citizenshipType: 'foreign' }, 'dormitory').activeStepCodes).not.toContain(
      'HSE_2026_RF_DORM',
    );
    expect(routeCase('HSE', { ...base, programLevel: 'masters' }, 'dormitory').activeStepCodes).not.toContain(
      'HSE_2026_RF_DORM',
    );
  });

  it('shows concrete post-enrollment actions for each researched university without cross-university steps', () => {
    const cases = [
      ['MSU', 'MSU_FACULTY_BEFORE', 'preparing', 'private'],
      ['MEPHI', 'MEPHI_VISA_SUPPORT', 'preparing', 'private'],
      ['MIPT', 'MIPT_VISA_INVITATION', 'preparing', 'private'],
      ['HSE', 'HSE_MOSCOW_FOREIGN_INTAKE', 'preparing', 'private'],
      ['NSU', 'NSU_STUDENT_ACCOUNT', 'preparing', 'private'],
      ['SPBU', 'SPBU_NOTIFY_ENTRY', 'arrived', 'private'],
      ['TSU', 'TSU_FOREIGN_SUPPORT', 'preparing', 'private'],
      ['KFU', 'KFU_PRIVATE_HOST', 'arrived', 'private'],
      ['RUDN', 'RUDN_PRIVATE_HODATAYSTVO', 'arrived', 'private'],
    ] as const;
    for (const [university, expected, arrival, housing] of cases) {
      const route = routeCase(
        university,
        {
          citizenshipType: 'foreign',
          entryMode: 'visa',
          campusCode: 'main',
          admissionYear: 2026,
          mobilityStatus: 'moving',
          enrollmentState: 'admitted',
        },
        housing,
        arrival,
      );
      expect(route.activeStepCodes, university).toContain(expected);
      expect(
        route.activeStepCodes.every(
          (code) => !/^(MSU|MEPHI|MIPT|HSE|NSU|SPBU|TSU|KFU|RUDN)_/.test(code) || code.startsWith(`${university}_`),
        ),
      ).toBe(true);
      expect(route.steps.every((step) => step.deadline === null)).toBe(true);
    }
  });

  it('keeps 2026-only housing steps out of later and unknown intake routes', () => {
    for (const [university, code] of [
      ['MEPHI', 'MEPHI_DORM_PACKAGE_2026'],
      ['KFU', 'KFU_DORM_FOREIGN_PACKAGE_2026'],
    ] as const) {
      const base = {
        citizenshipType: 'foreign' as const,
        campusCode: 'main',
        mobilityStatus: 'moving' as const,
        housingStatus: 'confirmed' as const,
      };
      expect(routeCase(university, { ...base, admissionYear: 2026 }, 'dormitory').activeStepCodes).toContain(code);
      expect(routeCase(university, { ...base, admissionYear: 2027 }, 'dormitory').activeStepCodes).not.toContain(code);
      expect(routeCase(university, base, 'dormitory').activeStepCodes).not.toContain(code);
    }
  });

  it('branches verified procedures across ten universities and four student situations', () => {
    const universities = universityDirectory.map((entry) => entry.code);
    for (const university of universities) {
      const campusCode = 'main';
      const common = { campusCode, admissionYear: 2026, programLevel: 'bachelor_specialist' };
      const situations = [
        routeCase(
          university,
          {
            ...common,
            citizenshipType: 'rf',
            mobilityStatus: 'moving',
            housingStatus: 'confirmed',
            facultyCode: university === 'MSU' ? 'msu_econ' : 'other',
          },
          'dormitory',
        ),
        routeCase(
          university,
          { ...common, citizenshipType: 'rf', mobilityStatus: 'local', housingStatus: 'private', facultyCode: 'other' },
          'private',
        ),
        routeCase(
          university,
          {
            ...common,
            citizenshipType: 'foreign',
            mobilityStatus: 'moving',
            entryMode: 'visa',
            housingStatus: 'confirmed',
          },
          'dormitory',
          'arrived',
        ),
        routeCase(
          university,
          {
            ...common,
            citizenshipType: 'foreign',
            mobilityStatus: 'moving',
            entryMode: 'visa_free',
            housingStatus: 'private',
          },
          'private',
          'arrived',
        ),
      ];
      for (const route of situations) {
        expect(route.activeStepCodes.length, `${university}: empty route`).toBeGreaterThan(0);
        expect(
          route.activeStepCodes.every(
            (code) =>
              !/^(MSU|MEPHI|MIPT|HSE|NSU|SPBU|TSU|ITMO|KFU|RUDN)_/.test(code) || code.startsWith(`${university}_`),
          ),
          university,
        ).toBe(true);
      }
      expect(
        situations[1]!.activeStepCodes.some((code) => code.includes('DORM')),
        `${university}: local dorm`,
      ).toBe(false);
      expect(
        situations[1]!.activeStepCodes.some((code) => code.includes('MIGRATION')),
        `${university}: RF migration`,
      ).toBe(false);
    }
  });

  it('limits faculty, campus and year-specific instructions to their actual audience', () => {
    const msu = {
      citizenshipType: 'rf',
      mobilityStatus: 'moving',
      campusCode: 'main',
      admissionYear: 2026,
      housingStatus: 'confirmed',
    };
    expect(routeCase('MSU', { ...msu, facultyCode: 'msu_econ' }, 'dormitory').activeStepCodes).toContain(
      'MSU_ECON_DORM_2026',
    );
    expect(routeCase('MSU', { ...msu, facultyCode: 'msu_econ' }, 'dormitory').activeStepCodes).not.toContain(
      'MSU_SOIL_DORM_2026',
    );
    expect(routeCase('MSU', { ...msu, facultyCode: 'msu_soil' }, 'dormitory').activeStepCodes).toContain(
      'MSU_SOIL_DORM_2026',
    );
    expect(routeCase('MSU', { ...msu, facultyCode: 'other' }, 'dormitory').activeStepCodes).not.toContain(
      'MSU_ECON_DORM_2026',
    );
    expect(
      routeCase('MSU', { ...msu, admissionYear: 2027, facultyCode: 'msu_econ' }, 'dormitory').activeStepCodes,
    ).not.toContain('MSU_ECON_DORM_2026');
    const tsu = { ...msu, facultyCode: 'tsu_law' };
    expect(routeCase('TSU', tsu, 'dormitory').activeStepCodes).toContain('TSU_LAW_DORM_EXTRA');
    expect(routeCase('TSU', { ...tsu, facultyCode: 'other' }, 'dormitory').activeStepCodes).not.toContain(
      'TSU_LAW_DORM_EXTRA',
    );
    for (const campusCode of ['main', 'nnov', 'perm']) {
      const hse = routeCase('HSE', { ...msu, campusCode, programLevel: 'bachelor_specialist' }, 'dormitory');
      const expected = {
        main: 'HSE_2026_RF_DORM',
        nnov: 'HSE_NN_DORM_DOCUMENTS',
        perm: 'HSE_PERM_DORM',
      }[campusCode]!;
      expect(hse.activeStepCodes, campusCode).toContain(expected);
    }
    const spb = { ...msu, campusCode: 'spb', programLevel: 'bachelor_specialist' };
    expect(routeCase('HSE', spb, 'dormitory').activeStepCodes).not.toContain('HSE_SPB_HOUSING');
    expect(routeCase('HSE', { ...spb, housingStatus: 'unknown' }, 'dormitory').activeStepCodes).toContain(
      'HSE_SPB_HOUSING',
    );
    expect(routeCase('KFU', { ...msu, campusCode: 'other' }, 'dormitory').activeStepCodes).not.toContain(
      'KFU_DORM_APPLICATION',
    );
  });

  it('does not turn the Moscow Amina branch or medical guidance into universal deadlines', () => {
    const base = {
      citizenshipType: 'foreign',
      campusCode: 'main',
      entryMode: 'visa_free',
      mobilityStatus: 'moved',
      russiaPresence: 'yes',
    };
    const moscowPrivate = routeCase('RUDN', base, 'private', 'arrived');
    expect(moscowPrivate.activeStepCodes).toContain('CHECK_AMINA_ELIGIBILITY');
    expect(moscowPrivate.activeStepCodes).toContain('CHECK_MEDICAL_2026');
    expect(moscowPrivate.steps.find((step) => step.code === 'CHECK_MEDICAL_2026')?.deadline).toBeNull();
    expect(routeCase('RUDN', base, 'dormitory', 'arrived').activeStepCodes).not.toContain('CHECK_AMINA_ELIGIBILITY');
    expect(routeCase('RUDN', { ...base, entryMode: 'visa' }, 'private', 'arrived').activeStepCodes).not.toContain(
      'CHECK_AMINA_ELIGIBILITY',
    );
    expect(routeCase('KFU', base, 'private', 'arrived').activeStepCodes).not.toContain('CHECK_AMINA_ELIGIBILITY');
  });

  it('has exactly ten public-directory entries with no partnership claim', () => {
    expect(universityDirectory).toHaveLength(10);
    expect(new Set(universityDirectory.map((item) => item.code)).size).toBe(10);
    expect(universityDirectory.every((item) => item.partnerStatus === 'directory_public')).toBe(true);
  });
});

describe('ITMO route definitions', () => {
  it('contains ten bilingual definitions across all four stages', () => {
    expect(itmoStepDefinitions).toHaveLength(10);
    expect(new Set(itmoStepDefinitions.map((step) => step.code)).size).toBe(10);
    expect(new Set(itmoStepDefinitions.map((step) => step.stage))).toEqual(
      new Set(['pre_arrival', 'first_three_days', 'first_week', 'first_30_days']),
    );
    for (const step of itmoStepDefinitions) {
      expect(translate('ru', step.titleKey)).not.toBe(step.titleKey);
      expect(translate('en', step.titleKey)).not.toBe(step.titleKey);
    }
  });

  it('builds a stable 9-step dormitory route', () => {
    const first = routeFor('dormitory');
    const second = routeFor('dormitory');
    expect(first.activeStepCodes).toHaveLength(9);
    expect(first.activeStepCodes).toEqual(second.activeStepCodes);
    expect(first.activeStepCodes).toContain('ARRANGE_DORMITORY');
    expect(first.activeStepCodes).toContain('REGISTER_DORM_RESIDENCE');
    expect(first.activeStepCodes).not.toContain('REGISTER_PRIVATE_RESIDENCE');
    expect(first.steps.filter((step) => step.isActive).every((step) => step.deadline === null)).toBe(true);
  });

  it('replaces pre-arrival tasks after confirmed arrival and keeps a next action', () => {
    const before = routeFor('dormitory');
    const after = reconcileRoute({
      profile: { ...profile('dormitory'), arrivalStatus: 'arrived', arrivalDate: '2026-09-20' },
      university: itmoUniversityConfig,
      stepDefinitions: itmoStepDefinitions,
      previousSteps: before.steps,
      previousVersion: before.suggestedVersion,
      now: NOW,
    });
    expect(after.diff.deactivated).toContain('CHECK_ENTRY_REQUIREMENTS');
    expect(after.diff.deactivated).toContain('NOTIFY_PLANNED_ARRIVAL');
    expect(after.activeStepCodes).toContain('CHECK_BORDER_DOCUMENTS');
    expect(after.nextAction).not.toBeNull();
  });

  it('builds a distinct 8-step private/relatives route', () => {
    for (const accommodationType of ['private', 'relatives'] as const) {
      const route = routeFor(accommodationType);
      expect(route.activeStepCodes).toHaveLength(8);
      expect(route.activeStepCodes).toContain('REGISTER_PRIVATE_RESIDENCE');
      expect(route.activeStepCodes).not.toContain('REGISTER_DORM_RESIDENCE');
      expect(route.activeStepCodes).not.toContain('ARRANGE_DORMITORY');
    }
  });
});

describe('deterministic Rule Engine', () => {
  it('calculates route stage from an injected clock and explicit timezone', () => {
    const arrived = { ...profile('dormitory'), arrivalStatus: 'arrived' as const };
    expect(calculateRouteStage(arrived, '2026-09-24T09:00:00Z', 'Europe/Moscow')).toBe('first_three_days');
    expect(calculateRouteStage(arrived, '2026-09-28T09:00:00Z', 'Europe/Moscow')).toBe('first_week');
    expect(calculateRouteStage(arrived, '2026-10-02T09:00:00Z', 'Europe/Moscow')).toBe('first_30_days');
  });

  it('calculates only verified deadlines and otherwise returns null', () => {
    const base = itmoStepDefinitions[0];
    expect(base).toBeDefined();
    const verified: StepDefinition = {
      ...base!,
      deadlineRule: {
        basis: 'arrival_date',
        offsetDays: 2,
        verificationStatus: 'verified',
      },
    };
    const unverified: StepDefinition = {
      ...base!,
      deadlineRule: {
        basis: 'arrival_date',
        offsetDays: 2,
        verificationStatus: 'needs_confirmation',
      },
    };
    expect(calculateDeadline(verified, profile('dormitory'))).toBe('2026-09-26');
    expect(calculateDeadline(unverified, profile('dormitory'))).toBeNull();
  });

  it('selects next action by prerequisites, urgency and stable order', () => {
    const initial = routeFor('dormitory');
    expect(initial.nextAction?.code).toBe('CHECK_ENTRY_REQUIREMENTS');
    const afterFirst = routeFor(
      'dormitory',
      completeStep(initial.steps, 'CHECK_ENTRY_REQUIREMENTS'),
      initial.suggestedVersion,
    );
    expect(afterFirst.nextAction?.code).toBe('NOTIFY_PLANNED_ARRIVAL');
    expect(afterFirst.nextAction?.prerequisites).toEqual(['CHECK_ENTRY_REQUIREMENTS']);
  });

  it('updates progress and preserves an idempotently completed step', () => {
    const initial = routeFor('dormitory');
    const completed = completeStep(initial.steps, 'CHECK_ENTRY_REQUIREMENTS');
    const once = routeFor('dormitory', completed, 1);
    const twice = routeFor('dormitory', once.steps, once.suggestedVersion);
    expect(calculateProgress(once.steps)).toEqual({ completed: 1, total: 9, percent: 11 });
    expect(twice.progress).toEqual(once.progress);
    expect(twice.steps.find((step) => step.code === 'CHECK_ENTRY_REQUIREMENTS')).toMatchObject({
      status: 'COMPLETED',
      completedAt: '2026-09-21T10:00:00.000Z',
    });
    expect(twice.diff.hasMeaningfulChanges).toBe(false);
    expect(twice.suggestedVersion).toBe(once.suggestedVersion);
  });

  it('reconciles an accommodation event without duplicates or lost completion', () => {
    const dormitory = routeFor('dormitory');
    const previous = completeStep(completeStep(dormitory.steps, 'CHECK_ENTRY_REQUIREMENTS'), 'REGISTER_DORM_RESIDENCE');
    const changed = reconcileRoute({
      profile: profile('dormitory'),
      events: [
        {
          id: 'event-1',
          idempotencyKey: 'accommodation-change-1',
          type: 'ACCOMMODATION_CHANGED',
          payload: { accommodationType: 'private' },
          confirmedAt: '2026-09-21T11:00:00.000Z',
        },
        {
          id: 'event-1-redelivery',
          idempotencyKey: 'accommodation-change-1',
          type: 'ACCOMMODATION_CHANGED',
          payload: { accommodationType: 'private' },
          confirmedAt: '2026-09-21T11:00:01.000Z',
        },
      ],
      university: itmoUniversityConfig,
      stepDefinitions: itmoStepDefinitions,
      previousSteps: previous,
      previousVersion: 1,
      now: NOW,
    });

    expect(changed.activeStepCodes).toHaveLength(8);
    expect(new Set(changed.steps.map((step) => step.code)).size).toBe(changed.steps.length);
    expect(changed.diff.added).toContain('REGISTER_PRIVATE_RESIDENCE');
    expect(changed.diff.deactivated).toEqual(expect.arrayContaining(['ARRANGE_DORMITORY', 'REGISTER_DORM_RESIDENCE']));
    expect(changed.diff.preservedCompleted).toContain('CHECK_ENTRY_REQUIREMENTS');
    expect(changed.diff.preservedCompleted).toContain('REGISTER_DORM_RESIDENCE');
    expect(changed.steps.find((step) => step.code === 'CHECK_ENTRY_REQUIREMENTS')?.status).toBe('COMPLETED');
    expect(changed.steps.find((step) => step.code === 'REGISTER_DORM_RESIDENCE')).toMatchObject({
      isActive: false,
      status: 'COMPLETED',
      completedAt: '2026-09-21T10:00:00.000Z',
    });
  });

  it('applies a confirmed arrival event to stage and arrival-specific applicability', () => {
    const changed = reconcileRoute({
      profile: profile('dormitory'),
      events: [
        {
          id: 'arrival-event-1',
          idempotencyKey: 'arrival-confirmation-1',
          type: 'ARRIVAL_CONFIRMED',
          payload: { arrivalDate: '2026-09-20' },
          confirmedAt: '2026-09-21T08:00:00.000Z',
        },
      ],
      university: itmoUniversityConfig,
      stepDefinitions: itmoStepDefinitions,
      now: NOW,
    });

    expect(changed.stage).toBe('first_three_days');
    expect(changed.activeStepCodes).toContain('CHECK_BORDER_DOCUMENTS');
  });
});

describe('onboarding', () => {
  it('branches by citizenship and arrival without asking about completed tasks', () => {
    const move = (state: ReturnType<typeof createOnboardingState>, answer: string | null) =>
      answerOnboardingQuestion(onboardingFlow, state, answer, NOW).state;
    let foreign = createOnboardingState(onboardingFlow, NOW);
    for (const answer of ['ru', 'ITMO', 'main', 'Индия']) foreign = move(foreign, answer);
    expect(foreign.questionId).toBe('ONB_04_SPECIAL_STATUS');
    foreign = move(foreign, 'rvpo');
    foreign = move(foreign, 'arrived');
    expect(foreign.questionId).toBe('ONB_06_ENTRY_DATE');
    foreign = move(foreign, null);
    expect(foreign.questionId).toBe('ONB_07_ACCOMMODATION');

    let russian = createOnboardingState(onboardingFlow, NOW);
    for (const answer of ['ru', 'ITMO', 'main', 'Россия']) russian = move(russian, answer);
    expect(russian.collectedAnswers.citizenshipType).toBe('rf');
    expect(russian.questionId).toBe('ONB_05_ARRIVAL_STATUS');
    russian = move(russian, 'preparing');
    expect(russian.questionId).toBe('ONB_06_PLANNED_DATE');
    expect(onboardingFlow.questions.map((question) => question.targetField)).not.toContain('remindersEnabled');
  });
  it('supports the same complete flow for all seven language values', () => {
    for (const language of ['ru', 'en', 'kk', 'uz', 'tk', 'zh-CN', 'hi'] as const) {
      let state = createOnboardingState(onboardingFlow, NOW);
      const answers: Array<string | null> = [
        language,
        'ITMO',
        'main',
        'India',
        'none',
        'preparing',
        '2026-09-24',
        'dormitory',
        '2026',
        'visa',
        'applied',
        'moving',
        'bachelor_specialist',
      ];
      for (const answer of answers) {
        const result = answerOnboardingQuestion(onboardingFlow, state, answer, NOW);
        expect(result.accepted).toBe(true);
        state = result.state;
      }
      expect(state.completed).toBe(true);
      expect(state.collectedAnswers).toMatchObject({
        preferredLanguage: language,
        housingChoice: 'dormitory',
        citizenshipType: 'foreign',
      });
      expect(state.collectedAnswers).not.toHaveProperty('introSeen');
      expect(state.collectedAnswers.universityCode).toBe('ITMO');
    }
  });

  it('does not lose state on an invalid answer and supports Back', () => {
    const initial = createOnboardingState(onboardingFlow, NOW);
    const language = answerOnboardingQuestion(onboardingFlow, initial, 'en', NOW).state;
    const invalid = answerOnboardingQuestion(onboardingFlow, language, 'UNKNOWN', NOW);
    expect(invalid.accepted).toBe(false);
    expect(invalid.error).toBe('invalid_answer');
    expect(invalid.state).toBe(language);
    const back = goBackOnboarding(onboardingFlow, language, NOW);
    expect(back.questionId).toBe('ONB_01_LANGUAGE');
    expect(back.collectedAnswers).not.toHaveProperty('preferredLanguage');
  });
});

describe('knowledge and safe LLM adapters', () => {
  it('grounds every assistant quick question in a same-language document', () => {
    for (const language of ['ru', 'en'] as const) {
      for (const key of ['quickNow', 'quickDocuments', 'quickDeadline'] as const) {
        const question = translateMiniapp(language, key);
        expect(retrieveKnowledge(question, itmoKnowledgeDocuments, { language }).status).toBe('found');
      }
    }
  });

  it('retrieves a grounded RU and EN document with source', () => {
    const ru = retrieveKnowledge('Как заселиться в общежитие?', itmoKnowledgeDocuments, {
      language: 'ru',
    });
    const en = retrieveKnowledge('Where can I check dormitory booking?', itmoKnowledgeDocuments, {
      language: 'en',
    });
    expect(ru.status).toBe('found');
    expect(ru.hits[0]?.document.sourceId).toBe('itmo_dorm_booking');
    expect(en.status).toBe('found');
    expect(en.hits[0]?.document.sourceId).toBe('itmo_dorm_booking');
  });

  it('finds curated sources for ordinary Russian forms without guessing unrelated facts', () => {
    for (const question of [
      'как мне оформить миграционный учет',
      'что делать после приезда',
      'как заселиться в общагу',
    ]) {
      expect(retrieveKnowledge(question, itmoKnowledgeDocuments, { language: 'ru' }).status, question).toBe('found');
    }
    expect(retrieveKnowledge('какие документы нужны для визы', itmoKnowledgeDocuments, { language: 'ru' }).status).toBe(
      'not_found',
    );
  });

  it('explains the assistant locally without inventing an external source', () => {
    const result = answerFromKnowledge({
      query: 'кто ты',
      language: 'ru',
      documents: itmoKnowledgeDocuments,
      sources: itmoSources,
      contact: itmoUniversityConfig.officialContact,
      notFoundMessage: translate('ru', 'knowledge.not_found'),
      contactNextAction: translate('ru', 'knowledge.contact_next'),
    });
    expect(result.status).toBe('product_help');
    expect(result.answer).toContain('Пути студента');
    expect(result.sources).toEqual([]);
    expect(result.contact).toBeNull();
  });

  it('answers greetings without claiming an official source or invoking a model', () => {
    for (const [query, language] of [
      ['привет', 'ru'],
      ['Здравствуйте!', 'ru'],
      ['hello', 'en'],
    ] as const) {
      const result = answerFromKnowledge({
        query,
        language,
        documents: itmoKnowledgeDocuments,
        sources: itmoSources,
        contact: itmoUniversityConfig.officialContact,
        notFoundMessage: translate(language, 'knowledge.not_found'),
        contactNextAction: translate(language, 'knowledge.contact_next'),
      });
      expect(result.status).toBe('product_help');
      expect(result.answer).toBeTruthy();
      expect(result.sources).toEqual([]);
      expect(result.contact).toBeNull();
    }
  });

  it('returns no invented fact or source for an unknown question', () => {
    const result = answerFromKnowledge({
      query: 'Where can I buy a used bicycle tonight?',
      language: 'en',
      documents: itmoKnowledgeDocuments,
      sources: itmoSources,
      contact: itmoUniversityConfig.officialContact,
      notFoundMessage: translate('en', 'knowledge.not_found'),
      contactNextAction: translate('en', 'knowledge.contact_next'),
    });
    expect(result.status).toBe('not_found');
    expect(result.answer).toBeNull();
    expect(result.sources).toEqual([]);
    expect(result.contact?.email).toBe('int.students@itmo.ru');
  });

  it('uses deterministic none/mock adapters and rejects sources outside context', async () => {
    const input = {
      question: 'Dormitory?',
      language: 'en' as const,
      context: [
        {
          documentId: 'kb-en-dormitory',
          sourceId: 'itmo_dorm_booking',
          title: 'Dormitory arrangements',
          content: 'Confirm the current instructions on the official page.',
          validAsOf: '2026-09-21',
        },
      ],
    };
    const none = await new NoneLlmAdapter().answerFromContext(input);
    const mock = await new MockLlmAdapter().answerFromContext(input);
    expect(none).toEqual(mock);
    expect(none.usedSourceIds).toEqual(['itmo_dorm_booking']);
    expect(validateGroundedAnswerResult({ ...none, usedSourceIds: ['invented-source'] }, input).status).toBe(
      'insufficient',
    );
  });

  it('extracts only the closed accommodation event and requires confirmation', () => {
    expect(
      extractAccommodationEventCandidate({
        text: 'I moved to a private apartment',
        language: 'en',
      }),
    ).toMatchObject({
      status: 'supported',
      type: 'ACCOMMODATION_CHANGED',
      payload: { accommodationType: 'private' },
      requiresConfirmation: true,
    });
    expect(extractAccommodationEventCandidate({ text: 'I changed my phone', language: 'en' })).toEqual({
      status: 'unsupported',
      type: null,
      payload: null,
      confidence: 'insufficient',
      requiresConfirmation: false,
    });
  });
});

describe('content and localization validation', () => {
  it('has complete RU/EN dictionaries with matching placeholders', () => {
    expect(validateI18nDictionaries(dictionaries)).toEqual([]);
  });

  it('has no duplicate/dangling content references', () => {
    expect(
      validateContent({
        university: itmoUniversityConfig,
        sources: itmoSources,
        steps: itmoStepDefinitions,
        knowledgeDocuments: itmoKnowledgeDocuments,
        onboarding: onboardingFlow,
        dictionaries,
      }),
    ).toEqual([]);
  });

  it('reports an unverified calculated deadline and a dangling source', () => {
    const base = itmoStepDefinitions[0];
    expect(base).toBeDefined();
    const invalid: StepDefinition = {
      ...base!,
      sourceId: 'missing-source',
      deadlineRule: {
        basis: 'arrival_date',
        offsetDays: 1,
        verificationStatus: 'demo',
      },
    };
    const issues = validateContent({
      university: itmoUniversityConfig,
      sources: itmoSources,
      steps: [invalid, ...itmoStepDefinitions.slice(1)],
      dictionaries,
    });
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['dangling_source', 'unverified_deadline_rule']),
    );
  });
});
