export const supportedLanguages = ['ru', 'en', 'kk', 'uz', 'tk', 'zh-CN', 'hi'] as const;
export type Language = (typeof supportedLanguages)[number];

export const languageChoices: Readonly<Record<Language, { flag: string; name: string }>> = {
  ru: { flag: '🇷🇺', name: 'Русский' },
  en: { flag: '🇬🇧', name: 'English' },
  kk: { flag: '🇰🇿', name: 'Қазақша' },
  uz: { flag: '🇺🇿', name: 'O‘zbekcha' },
  tk: { flag: '🇹🇲', name: 'Türkmençe' },
  'zh-CN': { flag: '🇨🇳', name: '简体中文' },
  hi: { flag: '🇮🇳', name: 'हिन्दी' },
};

export function isSupportedLanguage(value: unknown): value is Language {
  return typeof value === 'string' && supportedLanguages.some((language) => language === value);
}

export type ArrivalStatus = 'preparing' | 'arrived';
export type AccommodationType = 'dormitory' | 'private' | 'relatives' | 'unknown';
export type KnownAccommodationType = Exclude<AccommodationType, 'unknown'>;
export type CitizenshipType = 'rf' | 'foreign' | 'unknown';
export type EntryMode = 'visa' | 'visa_free' | 'already_in_russia' | 'unknown';
export type RussiaPresence = 'yes' | 'no' | 'unknown';
export type ProgramLevel = 'bachelor_specialist' | 'masters' | 'postgraduate' | 'unknown';
export type MobilityStatus = 'local' | 'moving' | 'moved' | 'unknown';
export type HousingStatus = 'confirmed' | 'applied' | 'private' | 'relatives' | 'unknown';
export type EnrollmentState = 'admitted' | 'awaiting_order' | 'arrived';
export type MilitaryStatus = 'yes' | 'no' | 'unknown' | 'decline';
export type AgeGroup = 'under_18' | 'adult' | 'unknown';

export type RouteStage = 'pre_arrival' | 'first_three_days' | 'first_week' | 'first_30_days';

export type StepStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type VerificationStatus = 'verified' | 'demo' | 'needs_confirmation';
export type Urgency = 'urgent' | 'soon' | 'normal';

/** Calendar date, always serialized as YYYY-MM-DD. */
export type IsoDate = string;
/** UTC timestamp, always serialized as ISO 8601. */
export type IsoTimestamp = string;

export interface UserProfile {
  userId?: string;
  universityCode: string;
  arrivalStatus: ArrivalStatus;
  arrivalDate: IsoDate | null;
  accommodationType: AccommodationType;
  countryOrRegion?: string | null;
  ageGroup?: AgeGroup | null;
  remindersEnabled: boolean;
  attributes?: Readonly<Record<string, string | number | boolean | null>>;
  knowledgeFacts?: Readonly<Record<string, KnowledgeFactValue>>;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  authority: string;
  languages: readonly Language[];
  validAsOf: IsoDate;
  verificationStatus: VerificationStatus;
  metadata?: {
    sourceCheckedAt: IsoDate;
    sourcePublishedAt: IsoDate | null;
    admissionYear: number | null;
    appliesTo: string;
    appliesToEn?: string;
    deadlineStatus: 'needs_confirmation' | 'not_applicable' | 'verified';
    partnerStatus: 'directory_public';
  };
}

export interface OfficialContact {
  labelKey: string;
  instructionKey: string;
  url: string | null;
  email: string | null;
  phone: string | null;
}

export interface UniversityConfig {
  code: string;
  name: string;
  timezone: string;
  supportedLanguages: readonly Language[];
  disclaimerKey: string;
  officialContact: OfficialContact;
}

export interface ApplicabilityRule {
  /** Explicitly reviewed equivalent actions, retained as historical rows. */
  supersedesCodes?: readonly string[];
  readonly [key: string]: unknown;
  accommodationTypes?: readonly AccommodationType[];
  arrivalStatuses?: readonly ArrivalStatus[];
  citizenshipTypes?: readonly CitizenshipType[];
  entryModes?: readonly EntryMode[];
  russiaPresences?: readonly RussiaPresence[];
  programLevels?: readonly ProgramLevel[];
  mobilityStatuses?: readonly MobilityStatus[];
  housingStatuses?: readonly HousingStatus[];
  enrollmentStates?: readonly EnrollmentState[];
  militaryStatuses?: readonly MilitaryStatus[];
  campusCodes?: readonly string[];
  facultyCodes?: readonly string[];
  universityCodes?: readonly string[];
  admissionYears?: readonly number[];
}

export interface DeadlineRule {
  readonly [key: string]: unknown;
  basis: 'arrival_date';
  offsetDays: number;
  /** A date is calculated only for a rule explicitly marked verified. */
  verificationStatus: VerificationStatus;
}

export interface StepDefinition {
  knowledgeCard?: import('./release-knowledge.js').ReleaseCard | null;
  code: string;
  universityCode: string | null;
  stage: RouteStage;
  titleKey: string;
  descriptionKey: string;
  whyImportantKey: string;
  preparationKeys: readonly string[];
  contactKey: string | null;
  sourceId: string | null;
  validAsOf: IsoDate;
  verificationStatus: VerificationStatus;
  sortOrder: number;
  prerequisites: readonly string[];
  applicability: ApplicabilityRule;
  deadlineRule: DeadlineRule | null;
  deadlineNoteKey: string;
  attention: 'normal' | 'high';
}

export interface ConfirmedAccommodationEvent {
  id: string;
  idempotencyKey: string;
  type: 'ACCOMMODATION_CHANGED';
  payload: {
    accommodationType: KnownAccommodationType;
  };
  confirmedAt: IsoTimestamp;
}

export interface ConfirmedArrivalEvent {
  id: string;
  idempotencyKey: string;
  type: 'ARRIVAL_CONFIRMED';
  payload: {
    arrivalDate: IsoDate;
  };
  confirmedAt: IsoTimestamp;
}

export type ConfirmedEvent = ConfirmedAccommodationEvent | ConfirmedArrivalEvent;

export interface PreviousRouteStep {
  code: string;
  status: StepStatus;
  isActive: boolean;
  completedAt: IsoTimestamp | null;
  deadline: IsoDate | null;
}

export interface RouteStep extends PreviousRouteStep {
  stage: RouteStage;
  sortOrder: number;
  prerequisites: readonly string[];
  deadlineNoteKey: string;
  urgency: Urgency;
  definition: StepDefinition;
}

export interface RouteProgress {
  completed: number;
  total: number;
  percent: number;
}

export interface NextAction {
  code: string;
  deadline: IsoDate | null;
  deadlineNoteKey: string;
  urgency: Urgency;
  prerequisites: readonly string[];
  order: number;
}

export interface DeadlineChange {
  code: string;
  before: IsoDate | null;
  after: IsoDate | null;
}

export interface RouteDiff {
  added: readonly string[];
  deactivated: readonly string[];
  reactivated: readonly string[];
  deadlineChanged: readonly DeadlineChange[];
  preservedCompleted: readonly string[];
  hasMeaningfulChanges: boolean;
}

export interface RouteResult {
  stage: RouteStage;
  activeStepCodes: readonly string[];
  steps: readonly RouteStep[];
  progress: RouteProgress;
  nextAction: NextAction | null;
  diff: RouteDiff;
  suggestedVersion: number;
  knowledgeAudit?: KnowledgeAuditResult;
}

export type KnowledgeFactValue = string | number | boolean;

export interface KnowledgeCondition {
  op: 'always' | 'exists' | 'eq' | 'ne' | 'in' | 'not_in' | 'gt' | 'gte' | 'lt' | 'lte' | 'not' | 'all' | 'any';
  fact?: string;
  value?: KnowledgeFactValue;
  values?: readonly KnowledgeFactValue[];
  arg?: KnowledgeCondition;
  args?: readonly KnowledgeCondition[];
}

export interface KnowledgeAuditStep {
  id: string;
  universityCode: string | null;
  applicability: KnowledgeCondition;
  trigger: {
    kind: 'event' | 'profile';
    event_type?: string;
    occurrence?: 'first' | 'latest' | 'each';
    where?: KnowledgeCondition;
  };
}

export interface KnowledgeAuditEvent {
  id: string;
  eventType: string;
  occurredAt: IsoTimestamp;
  facts: Readonly<Record<string, KnowledgeFactValue>>;
}

export interface KnowledgeAuditInput {
  facts: Readonly<Record<string, KnowledgeFactValue>>;
  events: readonly KnowledgeAuditEvent[];
  steps: readonly KnowledgeAuditStep[];
  aliases: readonly { event_type: string; also_triggers: string }[];
  invalidations: readonly { event_type: string; facts: readonly string[] }[];
}

export interface KnowledgeAuditResult {
  includedCandidates: readonly string[];
  pendingCandidates: readonly string[];
  excludedCandidates: readonly string[];
  /** Draft content is never executable in this mode. */
  executableSteps: readonly never[];
}

export interface RouteEngineInput {
  profile: UserProfile;
  events?: readonly ConfirmedEvent[];
  university: UniversityConfig;
  stepDefinitions: readonly StepDefinition[];
  previousSteps?: readonly PreviousRouteStep[];
  previousVersion?: number;
  now: Date | IsoTimestamp;
  knowledgeAudit?: KnowledgeAuditInput;
}

export interface ActiveStepCodeDiff {
  added: readonly string[];
  deactivated: readonly string[];
  unchanged: readonly string[];
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  sourceId: string;
  language: Language;
  tags: readonly string[];
  validAsOf: IsoDate;
}

export interface KnowledgeHit {
  document: KnowledgeDocument;
  score: number;
  matchedTerms: readonly string[];
  excerpt: string;
}

export interface KnowledgeRetrievalResult {
  status: 'found' | 'not_found';
  hits: readonly KnowledgeHit[];
  normalizedQuery: string;
}

export interface GroundedAnswer {
  status: 'grounded' | 'general' | 'off_topic' | 'not_found' | 'product_help';
  answer: string | null;
  nextAction: string;
  sources: readonly Source[];
  validAsOf: IsoDate | null;
  confidence: 'high' | 'medium' | 'insufficient';
  contact: OfficialContact | null;
}

export type OnboardingQuestionType = 'single_choice' | 'date' | 'text';

export interface OnboardingOption {
  labelKey: string;
  value: string;
}

export interface OnboardingCondition {
  field: string;
  op: 'eq' | 'neq';
  value: string | boolean | null;
}

export interface OnboardingQuestion {
  id: string;
  textKey: string;
  type: OnboardingQuestionType;
  options?: readonly OnboardingOption[];
  targetField: string;
  required: boolean;
  next: string | null;
  conditions: readonly OnboardingCondition[];
}

export interface OnboardingFlow {
  id: string;
  firstQuestionId: string;
  questions: readonly OnboardingQuestion[];
}

export interface OnboardingState {
  flowId: string;
  questionId: string;
  collectedAnswers: Readonly<Record<string, string | boolean | null>>;
  history: readonly string[];
  updatedAt: IsoTimestamp;
  completed: boolean;
}

export interface OnboardingTransition {
  accepted: boolean;
  error: 'question_not_found' | 'invalid_answer' | null;
  state: OnboardingState;
  question: OnboardingQuestion | null;
}

export type EventCandidateStatus = 'supported' | 'unsupported';

export interface AccommodationEventCandidate {
  status: 'supported';
  type: 'ACCOMMODATION_CHANGED';
  payload: {
    accommodationType: KnownAccommodationType;
  };
  confidence: 'high' | 'medium';
  requiresConfirmation: true;
}

export interface UnsupportedEventCandidate {
  status: 'unsupported';
  type: null;
  payload: null;
  confidence: 'insufficient';
  requiresConfirmation: false;
}

export type EventCandidate = AccommodationEventCandidate | UnsupportedEventCandidate;

export interface GroundedContextItem {
  documentId: string;
  sourceId: string;
  title: string;
  content: string;
  validAsOf: IsoDate;
}

export interface GroundedAnswerInput {
  question: string;
  language: Language;
  context: readonly GroundedContextItem[];
  previousAnswer?: string;
  profile?: Readonly<{
    university: string;
    city: string;
    campus?: string;
    citizenship: CitizenshipType;
    citizenshipCountry?: string;
    specialStatus?: string;
    arrivalStatus: ArrivalStatus;
    accommodation: AccommodationType;
    programLevel?: ProgramLevel;
    enrollmentState?: EnrollmentState;
    mobilityStatus?: MobilityStatus;
    housingStatus?: HousingStatus;
  }>;
}

export interface GroundedAnswerResult {
  status: 'grounded' | 'general' | 'off_topic' | 'insufficient';
  answer: string | null;
  nextAction: string | null;
  usedSourceIds: readonly string[];
  validAsOf: IsoDate | null;
}

export interface EventExtractionInput {
  text: string;
  language: Language;
}

export interface LlmAdapter {
  answerFromContext(input: GroundedAnswerInput): Promise<GroundedAnswerResult>;
  extractEventCandidate(input: EventExtractionInput): Promise<EventCandidate>;
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}
