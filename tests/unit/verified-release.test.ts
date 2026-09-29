import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  loadVerifiedRelease,
  projectReleaseDefinitions,
  loadKnowledgeDemoDefinitions,
  getUniversityConfig,
  directoryStepDefinitions,
} from '@first30/config';
import {
  calculateReleaseSchedule,
  releaseAudience,
  releaseContext,
  releasePublicCard,
  applyFederalPublicationPolicy,
  releaseReminderTime,
  reconcileRoute,
  type UserProfile,
} from '@first30/domain';

const release = loadVerifiedRelease();
const card = (id: string) => release.cards.find((c) => c.id === id)!;
const profile: UserProfile = {
  universityCode: 'ITMO',
  arrivalStatus: 'arrived',
  arrivalDate: '2026-09-20',
  accommodationType: 'dormitory',
  remindersEnabled: true,
  attributes: { admissionYear: 2026, russiaEntryDate: '2026-09-18' },
  knowledgeFacts: { foreign_person: true },
};

describe('verified release adapter', () => {
  it('preserves every original field and stable ID, with exactly 10/122/42/2', () => {
    expect(release.universities).toHaveLength(10);
    expect(release.cards).toHaveLength(122);
    expect(release.overrides).toHaveLength(2);
    expect(new Set(release.cards.map((c) => c.id)).size).toBe(122);
    expect(release.cards.filter((c) => c.deadline.reminder_eligible && c.deadline.machine_rule)).toHaveLength(42);
    const original = JSON.parse(
      readFileSync('db/knowledge-release-2026-09-29/import/university_requirements.json', 'utf8'),
    ).items;
    expect(release.cards).toEqual(original);
  });
  it('keeps unknown answers unknown and does not reuse campaign dates in 2027', () => {
    const c = release.cards.find((c) => c.do_not_extrapolate)!;
    expect(
      releaseAudience(
        c,
        { ...profile, universityCode: c.university.id.slice(5), attributes: {} },
        new Date('2026-09-29'),
      ),
    ).toBe('unknown');
    expect(releaseAudience(c, { ...profile, universityCode: c.university.id.slice(5) }, new Date('2027-01-01'))).toBe(
      false,
    );
  });
  it('distinguishes Russia entry, city arrival and missing events; keeps past dates', () => {
    const c = card('UNI_ITMO_PREARRIVAL_NOTIFY');
    expect(calculateReleaseSchedule(c, releaseContext(c, profile)).dueOn).toBe('2026-09-08');
    expect(calculateReleaseSchedule(c, releaseContext(c, { ...profile, attributes: {} })).dueOn).toBeNull();
    expect(
      calculateReleaseSchedule(card('OVR_MIPT_HOST_DOCUMENTS'), { facts: {}, dates: { entry_to_russia: '2026-09-18' } })
        .dueOn,
    ).toBe('2026-09-20');
  });
  it('calculates windows and preserves hours; no default when a conditional fact is missing', () => {
    const visa = calculateReleaseSchedule(card('OVR_HSE_MOSCOW_VISA'), {
      facts: {},
      dates: { visa_expiry: '2026-12-31' },
    });
    expect(visa.opensOn).toBe('2026-10-02');
    expect(visa.dueOn).toBe('2026-11-16');
    const c = card('UNI_ITMO_DORM_SLOT');
    const dates = { slot_notification_received: '2026-09-29T10:00:00+03:00' };
    expect(calculateReleaseSchedule(c, { facts: {}, dates }).reason).toBe('missing_condition');
    expect(
      calculateReleaseSchedule(c, { facts: { dormitory: 'MSG', notification_explicitly_states_24h: true }, dates })
        .dueAt,
    ).toBe('2026-09-30T07:00:00.000Z');
    expect(releaseReminderTime('2026-09-30', 'Asia/Novosibirsk')).toBe('2026-09-30T02:00:00.000Z');
  });
  it('never invents a calendar, a contract date, a billing month or processing deadline', () => {
    expect(
      calculateReleaseSchedule(card('OVR_SPBU_HOST_DOCUMENTS'), { facts: {}, dates: { entry_to_russia: '2026-09-18' } })
        .reason,
    ).toBe('calendar_required');
    expect(calculateReleaseSchedule(card('UNI_NSU_PAYMENT_PROOF'), { facts: {}, dates: {} }).dueOn).toBeNull();
    expect(
      calculateReleaseSchedule(card('UNI_RUDN_DORM_PAYMENT'), { facts: {}, dates: { billing_month: '2026-10-01' } })
        .dueOn,
    ).toBe('2026-10-10');
    const processing = calculateReleaseSchedule(card('OVR_KFU_INVITE_DIRECT'), {
      facts: {},
      dates: { complete_request_received: '2026-09-01' },
    });
    expect(processing.dueOn).toBeNull();
    expect(processing.reminderOn).toBe('2026-10-16');
    expect(processing.kind).toBe('progress_check');
    for (const c of release.cards.filter((c) => !c.deadline.reminder_eligible))
      expect(calculateReleaseSchedule(c, { facts: {}, dates: {} }).reminderOn).toBeNull();
  });
  it('supports all 42 rule shapes with explicit dates, facts and a supplied test calendar', () => {
    for (const c of release.cards.filter((c) => c.deadline.reminder_eligible)) {
      const anchors = [...JSON.stringify(c.deadline.machine_rule).matchAll(/"anchor":"([^"]+)"/g)].map((m) => m[1]!);
      const dates = Object.fromEntries(
        anchors.map((a) => [a, a === 'slot_notification_received' ? '2026-06-15T12:00:00Z' : '2026-06-15']),
      );
      dates.billing_month = '2026-06-01';
      const result = calculateReleaseSchedule(c, {
        dates,
        facts: {
          visa_required: false,
          dormitory: 'OTHER',
          notification_explicitly_states_24h: false,
          event: 'passport_loss',
        },
        calendar: { from: '2025-01-01', through: '2027-12-31', workingDates: [], nonWorkingDates: [] },
      });
      expect(result.reason, c.id).toBeNull();
      expect(result.reminderOn, c.id).not.toBeNull();
    }
  });
  it('exposes only verified URLs; never exposes exclusions or traceability', () => {
    for (const c of release.cards) {
      const view = releasePublicCard(c, profile, release.overrides);
      expect(view).not.toHaveProperty('traceability');
      expect(view).not.toHaveProperty('verification');
      const allowed = new Set(c.sources.map((s) => s.verified_url));
      for (const s of view.sources) {
        expect(allowed.has(s.url), c.id).toBe(true);
        expect(s.publisher).toBeTruthy();
      }
      if (view.destination?.url) expect(allowed.has(view.destination.url), c.id).toBe(true);
    }
  });
  it('applies the medical override only to its referenced rules and confirmed profile after effective date', () => {
    const c = card('OVR_ITMO_MEDICAL_INITIAL');
    expect(releasePublicCard(c, profile, release.overrides).federalRules).toHaveLength(0);
    expect(
      releasePublicCard(
        c,
        { ...profile, knowledgeFacts: { foreign_person: true, medical_exam_required: true } },
        release.overrides,
      ).appliedFederalOverrideIds[0],
    ).toBe('FED_MEDICAL_30_DAYS_2026');
    expect(
      releasePublicCard(
        c,
        {
          ...profile,
          attributes: { russiaEntryDate: '2026-08-20' },
          knowledgeFacts: { foreign_person: true, medical_exam_required: true },
        },
        release.overrides,
      ).federalRules,
    ).toHaveLength(0);
    expect(applyFederalPublicationPolicy('Оплатить 1 600 ₽ и 1 920 ₽', release.overrides)).not.toMatch(/600|920/);
    // Even the override has no machine_rule: do not fabricate one.
    expect(
      calculateReleaseSchedule(c, { facts: { medical_exam_required: true }, dates: { entry_to_russia: '2026-09-18' } })
        .reminderOn,
    ).toBeNull();
  });
  it('suppresses the reviewed ITMO duplicate and carries completed history only on first appearance', () => {
    const definitions = projectReleaseDefinitions(release, loadKnowledgeDemoDefinitions().steps);
    const legacy = directoryStepDefinitions.find((s) => s.code === 'ITMO_FOREIGN_PREARRIVAL')!;
    const current = definitions.find((s) => s.code === 'UNI_ITMO_PREARRIVAL_NOTIFY')!;
    const base = {
      profile: {
        ...profile,
        arrivalStatus: 'preparing' as const,
        knowledgeFacts: { foreign_person: true, plans_study_entry: true, itmo_needs_dorm: true },
      },
      university: getUniversityConfig('ITMO')!,
      stepDefinitions: [legacy, current],
      now: '2026-09-29',
      previousSteps: [
        {
          code: legacy.code,
          status: 'COMPLETED' as const,
          isActive: true,
          completedAt: '2026-09-28T12:00:00Z',
          deadline: null,
        },
      ],
    };
    const first = reconcileRoute(base);
    expect(first.steps.find((s) => s.code === current.code)?.stage).toBe('pre_arrival');
    expect(first.steps.find((s) => s.code === current.code)?.status).toBe('COMPLETED');
    expect(first.steps.find((s) => s.code === legacy.code)?.isActive).toBe(false);
    const again = reconcileRoute({
      ...base,
      previousSteps: first.steps.map((s) =>
        s.code === current.code ? { ...s, status: 'NOT_STARTED' as const, completedAt: null } : s,
      ),
    });
    expect(again.steps.find((s) => s.code === current.code)?.status).toBe('NOT_STARTED');
  });
  it('uses the real route engine, retaining RF restrictions, campuses and completed stable IDs', () => {
    const definitions = projectReleaseDefinitions(release, loadKnowledgeDemoDefinitions().steps);
    for (const code of ['ITMO', 'HSE', 'KFU', 'MSU', 'NSU', 'RUDN', 'SPBU', 'MEPHI', 'MIPT', 'TSU']) {
      const result = reconcileRoute({
        profile: { ...profile, universityCode: code, knowledgeFacts: { foreign_person: false } },
        university: getUniversityConfig(code)!,
        stepDefinitions: definitions,
        now: '2026-09-29',
      });
      expect(result.steps.filter((s) => s.isActive)).toHaveLength(0);
    }
    const result = reconcileRoute({
      profile: {
        ...profile,
        knowledgeFacts: { foreign_person: true, itmo_dorm_assigned: true, itmo_account_available: true },
      },
      university: getUniversityConfig('ITMO')!,
      stepDefinitions: definitions,
      previousSteps: [
        {
          code: 'UNI_ITMO_DORM_SLOT',
          status: 'COMPLETED',
          isActive: true,
          completedAt: '2026-09-28T12:00:00Z',
          deadline: null,
        },
      ],
      now: '2026-09-29',
    });
    expect(result.steps.find((s) => s.code === 'UNI_ITMO_DORM_SLOT')?.status).toBe('COMPLETED');
  });
});
