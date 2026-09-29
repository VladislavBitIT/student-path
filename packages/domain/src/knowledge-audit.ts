import type { KnowledgeAuditInput, KnowledgeAuditResult, KnowledgeCondition, KnowledgeFactValue } from './types.js';

export type ThreeValued = true | false | 'unknown';

function comparable(left: KnowledgeFactValue, right: KnowledgeFactValue): number | null {
  if (typeof left !== typeof right || typeof left === 'boolean' || typeof right === 'boolean') return null;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'string' && typeof right === 'string') {
    if (/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(left) && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(right)) {
      const leftTime = Date.parse(left);
      const rightTime = Date.parse(right);
      return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? leftTime - rightTime : null;
    }
  }
  return null;
}

/** Missing facts stay unknown, including under negation. */
export function evaluateKnowledgeCondition(
  condition: KnowledgeCondition,
  facts: Readonly<Record<string, KnowledgeFactValue>>,
): ThreeValued {
  if (condition.op === 'always') return true;
  if (condition.op === 'not') {
    if (!condition.arg) throw new Error('Knowledge condition is missing arg');
    const value = evaluateKnowledgeCondition(condition.arg, facts);
    return value === 'unknown' ? value : !value;
  }
  if (condition.op === 'all' || condition.op === 'any') {
    if (!condition.args) throw new Error('Knowledge condition is missing args');
    const values = condition.args.map((arg) => evaluateKnowledgeCondition(arg, facts));
    if (condition.op === 'all') {
      return values.includes(false) ? false : values.includes('unknown') ? 'unknown' : true;
    }
    return values.includes(true) ? true : values.includes('unknown') ? 'unknown' : false;
  }
  if (!condition.fact) throw new Error('Knowledge condition is missing fact');
  const exists = Object.hasOwn(facts, condition.fact) && facts[condition.fact] !== null;
  if (condition.op === 'exists') return exists;
  if (!exists) return 'unknown';
  const actual = facts[condition.fact]!;
  if (condition.op === 'in' || condition.op === 'not_in') {
    if (!condition.values) throw new Error('Knowledge condition is missing values');
    const found = condition.values.some((value) => actual === value);
    return condition.op === 'in' ? found : !found;
  }
  if (condition.value === undefined) throw new Error('Knowledge condition is missing value');
  if (condition.op === 'eq') return actual === condition.value;
  if (condition.op === 'ne') return actual !== condition.value;
  const difference = comparable(actual, condition.value);
  if (difference === null) return 'unknown';
  if (condition.op === 'gt') return difference > 0;
  if (condition.op === 'gte') return difference >= 0;
  if (condition.op === 'lt') return difference < 0;
  if (condition.op === 'lte') return difference <= 0;
  throw new Error(`Unsupported knowledge condition: ${condition.op}`);
}

/** Replays attached event scenarios inside the project's Route Engine. */
export function evaluateKnowledgeAudit(
  input: KnowledgeAuditInput,
  universityCode: string,
  now: Date | string,
): KnowledgeAuditResult {
  const reference = new Date(now);
  if (Number.isNaN(reference.getTime())) throw new Error('Invalid knowledge audit time');
  const aliases = new Map<string, string[]>();
  for (const item of input.aliases) {
    aliases.set(item.event_type, [...(aliases.get(item.event_type) ?? []), item.also_triggers]);
  }
  const currentFacts: Record<string, KnowledgeFactValue> = { ...input.facts };
  for (const [fact, value] of Object.entries(currentFacts)) {
    if (value === null || value === undefined || value === 'unknown') delete currentFacts[fact];
  }
  const snapshots: {
    id: string;
    eventTypes: readonly string[];
    facts: Readonly<Record<string, KnowledgeFactValue>>;
  }[] = [];
  const uniqueEvents = new Map<string, (typeof input.events)[number]>();
  for (const event of input.events) {
    if (Number.isNaN(new Date(event.occurredAt).getTime())) throw new Error(`Invalid event time: ${event.id}`);
    const previous = uniqueEvents.get(event.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) {
      throw new Error(`Conflicting knowledge event ID: ${event.id}`);
    }
    uniqueEvents.set(event.id, event);
  }
  const events = [...uniqueEvents.values()]
    .filter((event) => new Date(event.occurredAt) <= reference)
    .sort(
      (left, right) =>
        new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime() || left.id.localeCompare(right.id),
    );
  for (const event of events) {
    const eventTypes = [event.eventType, ...(aliases.get(event.eventType) ?? [])];
    for (const invalidation of input.invalidations) {
      if (eventTypes.includes(invalidation.event_type)) {
        for (const fact of invalidation.facts) delete currentFacts[fact];
      }
    }
    for (const [fact, value] of Object.entries(event.facts)) {
      if (value === null || value === undefined || value === 'unknown') delete currentFacts[fact];
      else currentFacts[fact] = value;
    }
    snapshots.push({ id: event.id, eventTypes, facts: { ...currentFacts } });
  }
  const includedCandidates: string[] = [];
  const pendingCandidates: string[] = [];
  const excludedCandidates: string[] = [];
  for (const step of input.steps) {
    if (step.universityCode !== null && step.universityCode !== universityCode) continue;
    let contexts: Readonly<Record<string, KnowledgeFactValue>>[];
    if (step.trigger.kind === 'profile') {
      contexts = [{ ...currentFacts }];
    } else {
      const matching = snapshots.filter((snapshot) => snapshot.eventTypes.includes(step.trigger.event_type ?? ''));
      const selected =
        step.trigger.occurrence === 'first'
          ? matching.slice(0, 1)
          : step.trigger.occurrence === 'latest'
            ? matching.slice(-1)
            : matching;
      contexts = selected.map((snapshot) => snapshot.facts);
    }
    const decisions = contexts.map((facts) =>
      evaluateKnowledgeCondition(
        { op: 'all', args: [step.applicability, step.trigger.where ?? { op: 'always' }] },
        facts,
      ),
    );
    if (decisions.includes(true)) includedCandidates.push(step.id);
    else if (decisions.includes('unknown')) pendingCandidates.push(step.id);
    else excludedCandidates.push(step.id);
  }
  return {
    includedCandidates: includedCandidates.sort(),
    pendingCandidates: pendingCandidates.sort(),
    excludedCandidates: excludedCandidates.sort(),
    executableSteps: [],
  };
}
