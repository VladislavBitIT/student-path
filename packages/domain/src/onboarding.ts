import type { OnboardingFlow, OnboardingQuestion, OnboardingState, OnboardingTransition } from './types.js';
import { isValidIsoDate } from './route-engine.js';

function questionById(flow: OnboardingFlow, id: string): OnboardingQuestion | undefined {
  return flow.questions.find((question) => question.id === id);
}

function conditionsMatch(
  question: OnboardingQuestion,
  answers: Readonly<Record<string, string | boolean | null>>,
): boolean {
  return question.conditions.every((condition) => {
    const value = answers[condition.field];
    return condition.op === 'eq' ? value === condition.value : value !== condition.value;
  });
}

function nextApplicableQuestion(
  flow: OnboardingFlow,
  nextId: string | null,
  answers: Readonly<Record<string, string | boolean | null>>,
): OnboardingQuestion | null {
  const seen = new Set<string>();
  let candidateId = nextId;
  while (candidateId) {
    if (seen.has(candidateId)) throw new Error(`Onboarding cycle at ${candidateId}`);
    seen.add(candidateId);
    const candidate = questionById(flow, candidateId);
    if (!candidate) return null;
    if (conditionsMatch(candidate, answers)) return candidate;
    candidateId = candidate.next;
  }
  return null;
}

export function createOnboardingState(flow: OnboardingFlow, updatedAt: string): OnboardingState {
  if (!questionById(flow, flow.firstQuestionId)) {
    throw new Error(`Unknown first onboarding question: ${flow.firstQuestionId}`);
  }
  return {
    flowId: flow.id,
    questionId: flow.firstQuestionId,
    collectedAnswers: {},
    history: [],
    updatedAt,
    completed: false,
  };
}

export function getOnboardingQuestion(flow: OnboardingFlow, state: OnboardingState): OnboardingQuestion | null {
  if (state.completed || state.flowId !== flow.id) return null;
  return questionById(flow, state.questionId) ?? null;
}

export function isValidOnboardingAnswer(question: OnboardingQuestion, answer: string | boolean | null): boolean {
  if (answer === null || answer === '') return !question.required;
  if (question.type === 'single_choice') {
    return typeof answer === 'string' && (question.options ?? []).some((option) => option.value === answer);
  }
  if (question.type === 'date') {
    return typeof answer === 'string' && isValidIsoDate(answer);
  }
  return typeof answer === 'string' && answer.trim().length > 0 && answer.length <= 500;
}

export function answerOnboardingQuestion(
  flow: OnboardingFlow,
  state: OnboardingState,
  answer: string | boolean | null,
  updatedAt: string,
): OnboardingTransition {
  const question = getOnboardingQuestion(flow, state);
  if (!question) {
    return { accepted: false, error: 'question_not_found', state, question: null };
  }
  if (!isValidOnboardingAnswer(question, answer)) {
    return { accepted: false, error: 'invalid_answer', state, question };
  }

  const collectedAnswers = { ...state.collectedAnswers, [question.targetField]: answer };
  if (question.targetField === 'citizenshipCountry' && typeof answer === 'string') {
    collectedAnswers.citizenshipType = /^(RU|россия|рф|российская федерация|russia|russian federation)$/iu.test(
      answer.trim(),
    )
      ? 'rf'
      : 'foreign';
  }
  const next = nextApplicableQuestion(flow, question.next, collectedAnswers);
  const nextState: OnboardingState = {
    ...state,
    questionId: next?.id ?? question.id,
    collectedAnswers,
    history: [...state.history, question.id],
    updatedAt,
    completed: next === null,
  };
  return { accepted: true, error: null, state: nextState, question: next };
}

export function goBackOnboarding(flow: OnboardingFlow, state: OnboardingState, updatedAt: string): OnboardingState {
  const previousId = state.history.at(-1);
  if (!previousId) return state;
  const previous = questionById(flow, previousId);
  if (!previous) return state;
  const answers = { ...state.collectedAnswers };
  delete answers[previous.targetField];
  if (previous.targetField === 'citizenshipCountry') delete answers.citizenshipType;
  return {
    ...state,
    questionId: previous.id,
    collectedAnswers: answers,
    history: state.history.slice(0, -1),
    updatedAt,
    completed: false,
  };
}
