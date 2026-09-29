import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  commonStepDefinitions,
  directoryStepDefinitions,
  getUniversityConfig,
  inspectKnowledgeBaseArchive,
  itmoStepDefinitions,
  loadKnowledgeAuditInput,
  loadKnowledgeDemoDefinitions,
  loadKnowledgeRouteCatalog,
  matchArchiveCampus,
} from '@first30/config';
import { reconcileRoute, type KnowledgeAuditEvent, type UserProfile } from '@first30/domain';

const archiveRoot = resolve(process.cwd(), 'db/route-knowledge-base-v0.10.0');
const temporaryRoots: string[] = [];

afterAll(() => {
  for (const directory of temporaryRoots) rmSync(directory, { recursive: true, force: true });
});

describe('attached knowledge-base admission', () => {
  function auditRoute(
    universityCode: string,
    facts: Record<string, string | number | boolean>,
    events: KnowledgeAuditEvent[],
  ) {
    const profile: UserProfile = {
      universityCode,
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'unknown',
      remindersEnabled: false,
    };
    return reconcileRoute({
      profile,
      university: getUniversityConfig(universityCode)!,
      stepDefinitions: [...commonStepDefinitions, ...directoryStepDefinitions],
      knowledgeAudit: loadKnowledgeAuditInput(facts, events, universityCode),
      now: '2026-09-27T12:00:00Z',
    });
  }

  it('loads the ten-university package and retains its editorial status', () => {
    const archive = inspectKnowledgeBaseArchive(archiveRoot, '2026-09-27');
    expect(archive.objectCounts).toEqual({
      federal: 46,
      overlays: 76,
      university: 46,
      sources: 144,
      blockingQuestions: 292,
    });
    expect(archive.contentStatus).toBe('draft');
    expect(archive.productionReady).toBe(false);
    expect(archive.blockedReasons).toContain('quality audit blocks content');
    const legacy = [...itmoStepDefinitions, ...commonStepDefinitions, ...directoryStepDefinitions];
    expect(legacy.length).toBeGreaterThan(100);
    expect(legacy.every((step) => !step.code.startsWith('FED_') && !step.code.startsWith('UNI_'))).toBe(true);
  });

  it('projects all 92 archive actions into the regular route without inventing dates', () => {
    const demo = loadKnowledgeDemoDefinitions(archiveRoot);
    expect(demo.steps).toHaveLength(92);
    expect(demo.sources).toHaveLength(144);
    expect(demo.steps.every((step) => step.verificationStatus === 'demo' && step.deadlineRule === null)).toBe(true);
    const entry = demo.steps.find((step) => step.code === 'FED_ENTRY_RULE_CHECK')!;
    const profile: UserProfile = {
      universityCode: 'ITMO',
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'unknown',
      remindersEnabled: false,
      knowledgeFacts: { foreign_person: true, plans_study_entry: true },
    };
    const route = reconcileRoute({
      profile,
      university: getUniversityConfig('ITMO')!,
      stepDefinitions: [entry],
      now: '2026-09-27T12:00:00Z',
    });
    expect(route.activeStepCodes).toContain(entry.code);
    expect(route.steps[0]?.deadline).toBeNull();
    expect(
      reconcileRoute({
        profile: { ...profile, knowledgeFacts: { foreign_person: false, plans_study_entry: true } },
        university: getUniversityConfig('ITMO')!,
        stepDefinitions: [entry],
        now: '2026-09-27T12:00:00Z',
      }).activeStepCodes,
    ).not.toContain(entry.code);
  });

  it('rejects changed archive content before seed can change any user rows', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'student-way-kb-'));
    temporaryRoots.push(temporary);
    const copy = join(temporary, 'route-knowledge-base-v0.10.0');
    cpSync(archiveRoot, copy, { recursive: true });
    cpSync(`${archiveRoot}.lock.json`, `${copy}.lock.json`);
    const manifestPath = join(copy, 'manifest.json');
    const original = readFileSync(manifestPath, 'utf8');
    writeFileSync(manifestPath, original.replace('"draft"', '"released"'));
    expect(() => inspectKnowledgeBaseArchive(copy)).toThrow('archive lock');
  });

  it('runs draft event conditions through the actual route engine without creating user tasks', () => {
    const trip: KnowledgeAuditEvent = {
      id: 'trip-1',
      eventType: 'trip_planned',
      occurredAt: '2026-09-25T09:00:00Z',
      facts: {},
    };
    const foreign = auditRoute('ITMO', { foreign_person: true, plans_study_entry: true, itmo_needs_dorm: true }, [
      trip,
    ]);
    expect(foreign.knowledgeAudit?.includedCandidates).toContain('FED_ENTRY_RULE_CHECK');
    expect(foreign.knowledgeAudit?.includedCandidates).toContain('UNI_ITMO_PREARRIVAL_NOTIFY');
    expect(foreign.knowledgeAudit?.executableSteps).toEqual([]);
    expect(foreign.activeStepCodes).not.toContain('FED_ENTRY_RULE_CHECK');

    const russian = auditRoute('ITMO', { foreign_person: false, plans_study_entry: true }, [trip]);
    expect(russian.knowledgeAudit?.excludedCandidates).toContain('FED_ENTRY_RULE_CHECK');
    const unknownHousing = auditRoute('ITMO', { foreign_person: true, plans_study_entry: true }, [trip]);
    expect(unknownHousing.knowledgeAudit?.pendingCandidates).toContain('UNI_ITMO_PREARRIVAL_NOTIFY');
  });

  it('keeps a university event scoped to its campus and does not treat city arrival as border entry', () => {
    const entry: KnowledgeAuditEvent = {
      id: 'entry-1',
      eventType: 'border_entry',
      occurredAt: '2026-09-26T08:00:00Z',
      facts: {},
    };
    expect(
      auditRoute('SPBU', { foreign_person: true, spbu_campus: 'main' }, [entry]).knowledgeAudit?.includedCandidates,
    ).toContain('UNI_SPBU_ARRIVAL_NOTIFY');
    expect(
      auditRoute('SPBU', { foreign_person: true, spbu_campus: 'other' }, [entry]).knowledgeAudit?.excludedCandidates,
    ).toContain('UNI_SPBU_ARRIVAL_NOTIFY');
    expect(
      auditRoute('SPBU', { foreign_person: true, spbu_campus: 'main' }, [{ ...entry, eventType: 'city_arrival' }])
        .knowledgeAudit?.excludedCandidates,
    ).toContain('UNI_SPBU_ARRIVAL_NOTIFY');
  });

  it('exposes every scoped draft card and overlay as read-only original text without inventing dates', () => {
    const universities = ['ITMO', 'MSU', 'MEPHI', 'MIPT', 'HSE', 'NSU', 'SPBU', 'TSU', 'KFU', 'RUDN'];
    const totals = universities.map((code) => loadKnowledgeRouteCatalog(code, { foreign_person: true }));
    expect(totals.every((cards) => cards.filter((card) => card.scope === 'federal').length === 46)).toBe(true);
    expect(totals.reduce((sum, cards) => sum + cards.filter((card) => card.scope === 'university').length, 0)).toBe(46);
    expect(totals.reduce((sum, cards) => sum + cards.flatMap((card) => card.overlays).length, 0)).toBe(76);
    expect(totals.flat().every((card) => card.deadlineKind !== 'calculated' && card.unresolvedIds.length > 0)).toBe(
      true,
    );
    const entry = totals[0]!.find((card) => card.id === 'FED_ENTRY_RULE_CHECK')!;
    expect(entry.instructions.length).toBeGreaterThan(0);
    expect(entry.documents.length).toBeGreaterThan(0);
    expect(entry.sources.length).toBeGreaterThan(0);
    expect(entry.applicability).toBe('unknown');
    expect(
      loadKnowledgeRouteCatalog('ITMO', { foreign_person: false }).find((card) => card.id === 'FED_ENTRY_RULE_CHECK')
        ?.applicability,
    ).toBe(false);
    expect(matchArchiveCampus('SPBU', 'peterhof')).toBeNull();
  });
});
