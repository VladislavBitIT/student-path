export type Language = 'ru' | 'en' | 'kk' | 'uz' | 'tk' | 'zh-CN' | 'hi';
export const languageOptions: readonly { code: Language; label: string }[] = [
  { code: 'ru', label: '🇷🇺 Русский' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'kk', label: '🇰🇿 Қазақша' },
  { code: 'uz', label: '🇺🇿 O‘zbekcha' },
  { code: 'tk', label: '🇹🇲 Türkmençe' },
  { code: 'zh-CN', label: '🇨🇳 简体中文' },
  { code: 'hi', label: '🇮🇳 हिन्दी' },
];
export type ArrivalStatus = 'preparing' | 'arrived';
export type AccommodationType = 'dormitory' | 'private' | 'relatives' | 'unknown';
export type StepStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type VerificationStatus = 'verified' | 'demo' | 'needs_confirmation';

export interface User {
  id: string;
  preferredLanguage: Language;
  maxUserId?: string;
}

export interface Profile {
  universityCode: string;
  countryOrRegion?: string | null;
  arrivalStatus: ArrivalStatus;
  arrivalDate: string | null;
  accommodationType: AccommodationType;
  remindersEnabled: boolean;
  attributes?: Record<string, string | number | boolean | null>;
}

export interface DirectoryUniversity {
  code: string;
  nameRu: string;
  nameEn: string;
  cityRu: string;
  campuses: Array<{ code: string; nameRu: string; nameEn: string }>;
  partnerStatus: 'directory_public';
}

export interface Source {
  title: string;
  url: string;
  authority: string;
  languages?: Language[];
  metadata?: {
    sourceCheckedAt?: string;
    sourcePublishedAt?: string | null;
    admissionYear?: number | null;
    appliesTo?: string;
    appliesToEn?: string;
    deadlineStatus?: string;
    partnerStatus?: 'directory_public';
  };
}

export interface RouteStep {
  id: string;
  code: string;
  title: string;
  description: string;
  whyImportant: string;
  preparation: string[];
  contact: string | null;
  source: Source | null;
  status: StepStatus;
  isActive: boolean;
  deadlineSchedule?: {
    timezone?: string;
    dueOn: string | null;
    dueAt: string | null;
    opensOn: string | null;
    reminderOn: string | null;
    kind: string;
    reason: string | null;
  };
  deadline: string | null;
  deadlineNote: string | null;
  stage: string;
  verificationStatus: VerificationStatus;
  validAsOf: string | null;
  scope?: 'general' | 'university';
  knowledge?: KnowledgeRouteCard;
  knowledgeApplicability?: true | false | 'unknown';
}

export interface RouteProgress {
  completed: number;
  total: number;
  percent: number;
}

export interface Route {
  id: string;
  version: number;
  stage: string;
  progress: RouteProgress;
  nextAction: RouteStep | null;
  steps: RouteStep[];
  possibleSteps?: RouteStep[];
  university?: string;
  partnerStatus?: 'directory_public';
}

export interface KnowledgeRouteSource {
  id: string;
  title: string;
  publisher: string;
  url: string;
  status: string;
}

export interface KnowledgeRouteDocument {
  title: string;
  requirement: string;
  instructions: string | null;
  form: string | null;
  applicability: true | false | 'unknown';
}

export interface KnowledgeRouteDestination {
  name: string;
  url?: string;
  information_url?: string;
  address?: string;
  notes?: string;
  contacts?: { kind: string; value: string; label?: string }[];
}

export interface KnowledgeRouteCard {
  releaseVerified?: boolean;
  verificationStatus?: string;
  dateScope?: string;
  doNotExtrapolate?: boolean;
  federalRules?: { id: string; action: string; deadline?: string }[];
  inputs?: {
    key: string;
    label: string;
    kind: 'fact' | 'date';
    options: (string | number | boolean)[];
    value: string | number | boolean | null;
    timestamp?: boolean;
    number?: boolean;
    readOnly?: boolean;
  }[];
  id: string;
  scope: 'federal' | 'university';
  title: string;
  summary: string;
  instructions: string[];
  documents: KnowledgeRouteDocument[];
  destination: KnowledgeRouteDestination | null;
  warnings: string[];
  exceptions: string[];
  unresolvedIds: string[];
  deadlineKind: string;
  deadlineNotes: string[];
  reportedDeadlineText: string | null;
  result: { title: string; instructions?: string } | null;
  triggerEvent: string | null;
  applicability: true | false | 'unknown';
  selection: 'included' | 'pending' | 'awaiting_event' | 'excluded';
  sources: KnowledgeRouteSource[];
  overlays: {
    id: string;
    applicability: true | false | 'unknown';
    instructions: string[];
    documents: KnowledgeRouteDocument[];
    destination: KnowledgeRouteDestination | null;
    warnings: string[];
    localDeadlines: { title: string; reportedText: string | null; state: string; calculationAllowed: boolean }[];
    unresolvedIds: string[];
    sources: KnowledgeRouteSource[];
  }[];
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ProfileResponse {
  user: User;
  profile: Profile | null;
}

export interface Candidate {
  id: string;
  type: 'ACCOMMODATION_CHANGED' | 'ARRIVAL_CONFIRMED';
  accommodationType?: AccommodationType;
  arrivalDate?: string;
  payload?: { accommodationType?: AccommodationType; arrivalDate?: string };
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'CONFLICTED';
  expiresAt?: string;
}

export interface RouteDiff {
  added?: Array<string | Pick<RouteStep, 'code' | 'title'>>;
  deactivated?: Array<string | Pick<RouteStep, 'code' | 'title'>>;
  removed?: Array<string | Pick<RouteStep, 'code' | 'title'>>;
  changedDeadlines?: Array<string | Pick<RouteStep, 'code' | 'title'>>;
  preservedCompleted?: Array<string | Pick<RouteStep, 'code' | 'title'>>;
  [key: string]: unknown;
}

export interface KnowledgeSource {
  title: string;
  url: string;
  authority?: string;
}

export interface GroundedAnswer {
  id?: string;
  queryId?: string;
  text?: string;
  answer?: string | null;
  nextAction?: string;
  status?: 'answered' | 'not_found' | 'fallback' | string;
  confidence?: number | string;
  validAsOf?: string | null;
  sources?: KnowledgeSource[];
  contact?: string | null;
}

export interface ApiErrorBody {
  code?: string;
  message?: string;
  requestId?: string;
  error?: { code?: string; message?: string; requestId?: string };
}

export interface OnboardingInput {
  preferredLanguage: Language;
  universityCode: string;
  universityName?: string | null;
  campusCode?: string;
  facultyCode?: 'msu_econ' | 'msu_soil' | 'tsu_law' | 'other' | 'unknown' | null;
  citizenshipType?: 'rf' | 'foreign' | 'unknown';
  citizenshipCountry?: string | null;
  entryMode?: 'visa' | 'visa_free' | 'already_in_russia' | 'unknown';
  russiaPresence?: 'yes' | 'no' | 'unknown';
  studyArrival?: 'yes' | 'no' | 'unknown';
  russiaEntryDate?: string | null;
  programLevel?: 'bachelor_specialist' | 'masters' | 'postgraduate' | 'unknown';
  mobilityStatus?: 'local' | 'moving' | 'moved' | 'unknown';
  housingStatus?: 'confirmed' | 'applied' | 'private' | 'relatives' | 'unknown';
  enrollmentState?: 'admitted' | 'awaiting_order' | 'arrived';
  militaryStatus?: 'yes' | 'no' | 'unknown' | 'decline';
  admissionYear?: number | null;
  arrivalStatus: ArrivalStatus;
  arrivalDate: string | null;
  accommodationType: AccommodationType;
  confirmRestart?: boolean;
}
