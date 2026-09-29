import { type FormEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftIcon,
  ArrowSquareOutIcon,
  BellIcon,
  BuildingsIcon,
  CalendarBlankIcon,
  CaretRightIcon,
  ChatCircleDotsIcon,
  CheckIcon,
  ClockCountdownIcon,
  CompassIcon,
  GearSixIcon,
  HouseIcon,
  InfoIcon,
  ListChecksIcon,
  MapPinIcon,
  PaperPlaneTiltIcon,
  PathIcon,
  ShareNetworkIcon,
  SlidersHorizontalIcon,
  StudentIcon,
  SuitcaseIcon,
  TranslateIcon,
  UserCircleIcon,
  WarningCircleIcon,
  XIcon,
  type Icon as PhosphorIcon,
} from '@phosphor-icons/react';
import { api, ApiError, authenticate, clearSession } from './api';
import { baseOverlays } from '../../../packages/i18n/src/base-overlays';
import { getMaxLaunchUrl, getStartPayload, openMaxExternalLink } from './bridge';
import { countryCodeFromInput, countryName, countryOptions } from './countries';
import { accommodationLabel, stageLabel, translate, type TranslationKey } from './i18n';
import { routeKnowledgeText } from './route-knowledge-i18n';
import { languageOptions } from './types';
import type {
  AccommodationType,
  Candidate,
  DirectoryUniversity,
  GroundedAnswer,
  KnowledgeRouteCard,
  KnowledgeRouteDestination,
  Language,
  OnboardingInput,
  Profile,
  Route,
  RouteDiff,
  RouteStep,
  StepStatus,
  User,
} from './types';

type View = 'today' | 'route' | 'ask' | 'profile';
type BootState = 'loading' | 'error' | 'onboarding' | 'ready';
const MAX_LAUNCH_URL = getMaxLaunchUrl(import.meta.env.VITE_MAX_BOT_USERNAME);

interface ErrorInfo {
  kind: 'auth' | 'load';
  code?: string;
}

function errorInfo(error: unknown, kind: ErrorInfo['kind'] = 'load'): ErrorInfo {
  if (error instanceof ApiError) {
    return {
      kind,
      code: error.code,
    };
  }
  return { kind, code: 'UNKNOWN_ERROR' };
}

function isLanguage(value: unknown): value is Language {
  return languageOptions.some((option) => option.code === value);
}

function sharedTranslate(language: Language, key: string): string {
  if (language === 'ru' || language === 'en') throw new Error('Use the existing onboarding copy for this language');
  const value = baseOverlays[language][key];
  if (!value) throw new Error(`Missing onboarding translation: ${language}.${key}`);
  return value;
}

function formatDate(value: string | null | undefined, language: Language): string | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function datetimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function statusLabel(language: Language, status: StepStatus): string {
  if (status === 'COMPLETED') return translate(language, 'completed');
  if (status === 'IN_PROGRESS') return translate(language, 'inProgress');
  return translate(language, 'notStarted');
}

function stepStageLabel(language: Language, step: RouteStep): string {
  return step.code.startsWith('CHECK_UNIVERSITY_')
    ? language === 'ru'
      ? 'После зачисления'
      : 'After admission'
    : stageLabel(language, step.stage);
}

const stageOrder: Readonly<Record<string, number>> = {
  pre_arrival: 0,
  first_three_days: 1,
  first_week: 2,
  first_30_days: 3,
};

function orderedRouteSteps(route: Route): RouteStep[] {
  return route.steps
    .filter((step) => step.isActive)
    .sort(
      (left, right) =>
        Number(left.scope !== 'general') - Number(right.scope !== 'general') ||
        (stageOrder[left.stage] ?? 4) - (stageOrder[right.stage] ?? 4),
    );
}

function profileHousingLabel(language: Language, profile: Profile): string {
  if (profile.accommodationType === 'unknown' && profile.attributes?.housingChoice === 'hotel') {
    return translate(language, 'housingHotel');
  }
  if (profile.accommodationType === 'unknown' && profile.attributes?.housingChoice === 'other') {
    return translate(language, 'housingOther');
  }
  return accommodationLabel(language, profile.accommodationType);
}

function verificationLabel(language: Language, status: RouteStep['verificationStatus']): string {
  if (status === 'verified') return translate(language, 'verified');
  if (status === 'demo') return translate(language, 'demo');
  return translate(language, 'needsConfirmation');
}

type IconName =
  | 'today'
  | 'route'
  | 'ask'
  | 'profile'
  | 'settings'
  | 'arrow'
  | 'back'
  | 'external'
  | 'check'
  | 'calendar'
  | 'bell'
  | 'info'
  | 'close'
  | 'university'
  | 'location'
  | 'luggage'
  | 'warning'
  | 'send'
  | 'list'
  | 'deadline'
  | 'language'
  | 'share'
  | 'situation';

const iconMap: Record<IconName, PhosphorIcon> = {
  today: HouseIcon,
  route: PathIcon,
  ask: ChatCircleDotsIcon,
  profile: UserCircleIcon,
  settings: GearSixIcon,
  arrow: CaretRightIcon,
  back: ArrowLeftIcon,
  external: ArrowSquareOutIcon,
  check: CheckIcon,
  calendar: CalendarBlankIcon,
  bell: BellIcon,
  info: InfoIcon,
  close: XIcon,
  university: BuildingsIcon,
  location: MapPinIcon,
  luggage: SuitcaseIcon,
  warning: WarningCircleIcon,
  send: PaperPlaneTiltIcon,
  list: ListChecksIcon,
  deadline: ClockCountdownIcon,
  language: TranslateIcon,
  share: ShareNetworkIcon,
  situation: SlidersHorizontalIcon,
};

function Icon({ name, weight = 'regular' }: { name: IconName; weight?: 'regular' | 'bold' | 'fill' | 'duotone' }) {
  const Glyph = iconMap[name];
  return <Glyph aria-hidden="true" className="icon" weight={weight} />;
}

function Brand({ language, compact = false }: { language: Language; compact?: boolean }) {
  return (
    <div className={`brand-lockup ${compact ? 'compact' : ''}`}>
      <span className="brand-symbol" aria-hidden="true">
        <StudentIcon weight="duotone" />
      </span>
      <span>{translate(language, 'appName')}</span>
    </div>
  );
}

function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

function LoadingScreen({ language }: { language: Language }) {
  return (
    <main className="center-screen" aria-busy="true" aria-live="polite">
      <Brand language={language} />
      <Spinner />
      <h1>{translate(language, 'loading')}</h1>
      <p>{translate(language, 'loadingHint')}</p>
    </main>
  );
}

function ErrorScreen({ language, error, onRetry }: { language: Language; error: ErrorInfo; onRetry: () => void }) {
  const needsMaxContext = error.code === 'MAX_CONTEXT_REQUIRED';
  return (
    <main className="center-screen">
      <div className="error-illustration" aria-hidden="true">
        <WarningCircleIcon weight="duotone" />
      </div>
      <h1>{translate(language, error.kind === 'auth' ? 'authErrorTitle' : 'loadErrorTitle')}</h1>
      <p>
        {needsMaxContext
          ? translate(language, 'maxContextRequired')
          : error.code?.startsWith('MAX_INIT_DATA')
            ? translate(language, 'maxLaunchInvalid')
            : translate(language, 'networkError')}
      </p>
      {needsMaxContext && MAX_LAUNCH_URL ? (
        <a className="primary-button" href={MAX_LAUNCH_URL}>
          {translate(language, 'openInMax')}
        </a>
      ) : (
        <button className="primary-button" type="button" onClick={onRetry}>
          {translate(language, 'retry')}
        </button>
      )}
    </main>
  );
}

function InlineError({ language, retry }: { language: Language; retry?: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <span>{translate(language, 'updateError')}</span>
      {retry && (
        <button className="text-button" type="button" onClick={retry}>
          {translate(language, 'retry')}
        </button>
      )}
    </div>
  );
}

function Onboarding({
  initialLanguage,
  onComplete,
  existingProfile,
  onCancel,
}: {
  initialLanguage: Language;
  onComplete: (input: OnboardingInput, route: Route) => void;
  existingProfile?: Profile;
  onCancel?: () => void;
}) {
  const [language, setLanguage] = useState(initialLanguage);
  const [arrivalStatus, setArrivalStatus] = useState<OnboardingInput['arrivalStatus'] | null>(
    existingProfile?.arrivalStatus ?? null,
  );
  const [arrivalDate, setArrivalDate] = useState(existingProfile?.arrivalDate ?? '');
  const [russiaPresence, setRussiaPresence] = useState<NonNullable<OnboardingInput['russiaPresence']>>(
    (existingProfile?.attributes?.russiaPresence as NonNullable<OnboardingInput['russiaPresence']>) ?? 'unknown',
  );
  const [studyArrival, setStudyArrival] = useState<'yes' | 'no' | 'unknown'>(
    (existingProfile?.attributes?.studyArrival as 'yes' | 'no' | 'unknown') ?? 'unknown',
  );
  const [russiaEntryDate, setRussiaEntryDate] = useState(
    existingProfile?.attributes?.journeyVersion === 'city_v1'
      ? String(existingProfile.attributes.russiaEntryDate ?? '')
      : '',
  );
  const [accommodationType, setAccommodationType] = useState<AccommodationType | null>(
    existingProfile?.accommodationType ?? null,
  );
  const [universities, setUniversities] = useState<DirectoryUniversity[]>([]);
  const [universityCode, setUniversityCode] = useState(existingProfile?.universityCode ?? '');
  const [universityName, setUniversityName] = useState(String(existingProfile?.attributes?.universityName ?? ''));
  const [campusCode, setCampusCode] = useState(String(existingProfile?.attributes?.campusCode ?? ''));
  const [facultyCode, setFacultyCode] = useState<NonNullable<OnboardingInput['facultyCode']>>(
    (existingProfile?.attributes?.facultyCode as NonNullable<OnboardingInput['facultyCode']>) ?? 'unknown',
  );
  const [citizenshipType, setCitizenshipType] = useState<'rf' | 'foreign' | ''>(
    existingProfile?.attributes?.citizenshipType === 'rf' || existingProfile?.attributes?.citizenshipType === 'foreign'
      ? existingProfile.attributes.citizenshipType
      : '',
  );
  const lastSelectedCitizenshipType = useRef(citizenshipType);
  const [citizenshipCountry, setCitizenshipCountry] = useState(() => {
    const previous = existingProfile?.countryOrRegion;
    const code = previous
      ? countryCodeFromInput(previous)
      : existingProfile?.attributes?.citizenshipType === 'rf'
        ? 'RU'
        : null;
    return code ? countryName(code, language) : (previous ?? '');
  });
  const countries = useMemo(() => countryOptions(language), [language]);
  const selectedCountryCode = countryCodeFromInput(citizenshipCountry);
  const [entryMode, setEntryMode] = useState<NonNullable<OnboardingInput['entryMode']>>(
    existingProfile?.attributes?.entryMode === 'already_in_russia'
      ? 'unknown'
      : ((existingProfile?.attributes?.entryMode as NonNullable<OnboardingInput['entryMode']>) ?? 'unknown'),
  );
  const [programLevel, setProgramLevel] = useState<NonNullable<OnboardingInput['programLevel']>>(
    (existingProfile?.attributes?.programLevel as NonNullable<OnboardingInput['programLevel']>) ?? 'unknown',
  );
  const [mobilityStatus, setMobilityStatus] = useState<NonNullable<OnboardingInput['mobilityStatus']>>(
    (existingProfile?.attributes?.mobilityStatus as NonNullable<OnboardingInput['mobilityStatus']>) ?? 'unknown',
  );
  const [housingStatus, setHousingStatus] = useState<NonNullable<OnboardingInput['housingStatus']>>(
    (existingProfile?.attributes?.housingStatus as NonNullable<OnboardingInput['housingStatus']>) ?? 'unknown',
  );
  const [militaryStatus, setMilitaryStatus] = useState<NonNullable<OnboardingInput['militaryStatus']>>(
    (existingProfile?.attributes?.militaryStatus as NonNullable<OnboardingInput['militaryStatus']>) ?? 'unknown',
  );
  const [enrollmentState, setEnrollmentState] = useState<NonNullable<OnboardingInput['enrollmentState']>>(
    (existingProfile?.attributes?.enrollmentState as NonNullable<OnboardingInput['enrollmentState']>) ?? 'admitted',
  );
  const [admissionYear, setAdmissionYear] = useState<number | null>(
    existingProfile?.attributes?.admissionYear == null ? null : Number(existingProfile.attributes.admissionYear),
  );
  const [directoryError, setDirectoryError] = useState(false);
  const [phase, setPhase] = useState<0 | 1>(0);
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = translate(language, 'appName');
  }, [language]);

  useEffect(() => {
    let active = true;
    void api
      .universities()
      .then((result) => {
        if (active) setUniversities(result.universities);
      })
      .catch(() => {
        if (active) setDirectoryError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const needsAdmissionYear = ['MSU', 'MEPHI', 'HSE', 'NSU', 'KFU'].includes(universityCode);
  const needsProgramLevel = ['MIPT', 'HSE'].includes(universityCode);
  const copy =
    language === 'ru'
      ? {
          university: 'В каком университете вы учитесь?',
          otherUniversity: 'Моего университета нет в списке',
          universityName: 'Название университета',
          campus: 'Кампус или филиал',
          faculty: 'Факультет',
          msuEcon: 'Экономический факультет',
          msuSoil: 'Факультет почвоведения',
          tsuLaw: 'Юридический институт',
          otherFaculty: 'Другой факультет',
          visa: 'По визе',
          visaFree: 'Без визы',
          choose: 'Выберите из списка',
          citizenship: 'Гражданство',
          rf: 'Гражданство РФ',
          foreign: 'Гражданство другой страны',
          unknown: translate(language, 'unknown'),
          enrollment: 'Зачисление',
          admitted: 'Зачислен(а)',
          awaiting: 'Жду приказ о зачислении',
          year: 'Год поступления',
          yearUnknown: 'Можно оставить пустым и ответить позже',
          program: 'Ступень обучения',
          bachelor: 'Бакалавриат или специалитет',
          masters: 'Магистратура',
          postgraduate: 'Аспирантура',
          mobility: 'Переезжаете в город учёбы?',
          local: 'Уже живу здесь',
          moving: 'Планирую переезд',
          moved: 'Уже переехал(а)',
          housingStatus: 'Что с жильём?',
          confirmed: 'Место подтверждено',
          applied: 'Подал(а) заявку',
          military: 'Нужно ли учитывать воинский учёт?',
          yes: 'Возможно, да',
          no: 'Нет',
          decline: 'Не хочу отвечать',
          publicData:
            'План составлен по опубликованной информации вузов. Вузы не проверяли его для «Пути студента». Уточняйте личные условия и сроки в своём вузе.',
          directoryError: 'Не удалось загрузить список университетов. Проверьте соединение и обновите страницу.',
          next: 'Продолжить',
          step: 'Часть {current} из 2',
        }
      : language === 'en'
        ? {
            university: 'Which university will you attend?',
            otherUniversity: 'My university is not listed',
            universityName: 'University name',
            campus: 'Campus or branch',
            faculty: 'Faculty',
            msuEcon: 'Faculty of Economics',
            msuSoil: 'Faculty of Soil Science',
            tsuLaw: 'Law Institute',
            otherFaculty: 'Another faculty',
            choose: 'Select from the list',
            visa: 'With a visa',
            visaFree: 'Without a visa',
            citizenship: 'Citizenship',
            rf: 'Russian citizen',
            foreign: 'Citizen of another country',
            unknown: translate(language, 'unknown'),
            enrollment: 'Enrollment',
            admitted: 'Admitted',
            awaiting: 'Awaiting enrollment order',
            year: 'Admission year',
            yearUnknown: 'Leave blank if you do not know the year yet',
            program: 'Level of study',
            bachelor: 'Bachelor’s or specialist degree',
            masters: 'Master’s degree',
            postgraduate: 'Postgraduate study',
            mobility: 'Are you moving to your study city?',
            local: 'I already live here',
            moving: 'Planning to move',
            moved: 'Already moved',
            housingStatus: 'What is your housing status?',
            confirmed: 'Place confirmed',
            applied: 'Applied',
            military: 'Could military registration apply to you?',
            yes: 'Possibly',
            no: 'No',
            decline: 'Prefer not to say',
            publicData:
              'This plan is based on public university information. Universities have not reviewed it for «Путь студента». Confirm your own conditions and dates with your university.',
            directoryError: 'Could not load the university list. Check your connection and reload the page.',
            next: 'Continue',
            step: 'Part {current} of 2',
          }
        : {
            university: sharedTranslate(language, 'onboarding.university.question'),
            otherUniversity: sharedTranslate(language, 'university.other'),
            universityName: sharedTranslate(language, 'onboarding.ui.university_name'),
            campus: sharedTranslate(language, 'onboarding.campus.question'),
            faculty: sharedTranslate(language, 'onboarding.ui.faculty'),
            msuEcon: sharedTranslate(language, 'faculty.msu_econ'),
            msuSoil: sharedTranslate(language, 'faculty.msu_soil'),
            tsuLaw: sharedTranslate(language, 'faculty.tsu_law'),
            otherFaculty: sharedTranslate(language, 'faculty.other'),
            visa: sharedTranslate(language, 'entry.visa'),
            visaFree: sharedTranslate(language, 'entry.visa_free'),
            choose: sharedTranslate(language, 'onboarding.ui.choose'),
            citizenship: translate(language, 'citizenshipCountry'),
            rf: sharedTranslate(language, 'country.russia'),
            foreign: sharedTranslate(language, 'citizenship.foreign'),
            unknown: translate(language, 'unknown'),
            enrollment: sharedTranslate(language, 'onboarding.ui.enrollment'),
            admitted: sharedTranslate(language, 'enrollment.admitted'),
            awaiting: sharedTranslate(language, 'enrollment.awaiting_order'),
            year: sharedTranslate(language, 'onboarding.ui.year'),
            yearUnknown: sharedTranslate(language, 'onboarding.ui.year_hint'),
            program: sharedTranslate(language, 'onboarding.program_level.question'),
            bachelor: sharedTranslate(language, 'program.bachelor_specialist'),
            masters: sharedTranslate(language, 'program.masters'),
            postgraduate: sharedTranslate(language, 'program.postgraduate'),
            mobility: sharedTranslate(language, 'onboarding.mobility.question'),
            local: sharedTranslate(language, 'mobility.local'),
            moving: sharedTranslate(language, 'mobility.moving'),
            moved: sharedTranslate(language, 'mobility.moved'),
            housingStatus: sharedTranslate(language, 'onboarding.ui.housing_status'),
            confirmed: sharedTranslate(language, 'housing.confirmed'),
            applied: sharedTranslate(language, 'housing.applied'),
            military: sharedTranslate(language, 'onboarding.military.question'),
            yes: sharedTranslate(language, 'military.yes'),
            no: sharedTranslate(language, 'military.no'),
            decline: sharedTranslate(language, 'military.decline'),
            publicData: translate(language, 'directoryDisclaimer'),
            directoryError: sharedTranslate(language, 'onboarding.ui.directory_error'),
            next: sharedTranslate(language, 'common.continue'),
            step: sharedTranslate(language, 'onboarding.ui.part').replace('{{current}}', '{current}'),
          };
  const selectedUniversity =
    universities.find((item) => item.code === universityCode) ??
    (universityCode === 'OTHER'
      ? { code: 'OTHER', campuses: [{ code: 'main', nameRu: 'Основной', nameEn: 'Main' }] }
      : undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !arrivalStatus ||
      !citizenshipType ||
      !selectedCountryCode ||
      !accommodationType ||
      !selectedUniversity ||
      !campusCode ||
      (universityCode === 'OTHER' && universityName.trim().length < 2)
    )
      return;
    setSubmitting(true);
    setFailed(false);
    const input: OnboardingInput = {
      preferredLanguage: language,
      universityCode,
      universityName: universityCode === 'OTHER' ? universityName.trim() : null,
      campusCode,
      facultyCode: universityCode === 'MSU' || universityCode === 'TSU' ? facultyCode : null,
      citizenshipType,
      citizenshipCountry: selectedCountryCode,
      entryMode: citizenshipType === 'foreign' ? entryMode : 'unknown',
      programLevel,
      mobilityStatus,
      housingStatus,
      enrollmentState,
      militaryStatus: citizenshipType === 'rf' ? militaryStatus : 'unknown',
      admissionYear,
      confirmRestart: Boolean(existingProfile),
      arrivalStatus,
      arrivalDate: mobilityStatus === 'local' ? null : arrivalDate || null,
      russiaPresence: citizenshipType === 'rf' ? 'yes' : citizenshipType === 'foreign' ? russiaPresence : 'unknown',
      russiaEntryDate: citizenshipType === 'foreign' ? russiaEntryDate || null : null,
      studyArrival: citizenshipType === 'foreign' ? studyArrival : 'unknown',
      accommodationType,
    };
    try {
      const result = await api.onboarding(input);
      onComplete(input, result.route);
    } catch {
      setFailed(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <Brand language={language} compact />
        <select
          className="language-select"
          aria-label={translate(language, 'language')}
          value={language}
          onChange={(event) => {
            if (isLanguage(event.target.value)) setLanguage(event.target.value);
          }}
        >
          {languageOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </header>
      <form className="onboarding-card" onSubmit={submit}>
        {(phase === 1 || existingProfile) && (
          <button className="back-link" type="button" onClick={() => (phase === 1 ? setPhase(0) : onCancel?.())}>
            <Icon name="back" />
            {translate(language, 'back')}
          </button>
        )}
        <h1>{translate(language, existingProfile ? 'editProfile' : 'onboardingTitle')}</h1>
        <p className="lead">{translate(language, 'onboardingHint')}</p>
        {existingProfile &&
          existingProfile.attributes?.journeyVersion !== 'city_v1' &&
          typeof existingProfile.attributes?.legacyArrivalDate === 'string' && (
            <div className="microcopy" role="note">
              <p>{translate(language, 'legacyDateHint')}</p>
              <p>
                {translate(language, 'legacyDateLabel')}:{' '}
                {formatDate(existingProfile.attributes.legacyArrivalDate, language)}
              </p>
            </div>
          )}
        <p className="section-kicker">{copy.step.replace('{current}', String(phase + 1))}</p>

        {phase === 0 ? (
          <>
            <label className="field-label" htmlFor="university-code">
              {copy.university}
            </label>
            <select
              id="university-code"
              value={universityCode}
              required
              onChange={(event) => {
                const code = event.target.value;
                setUniversityCode(code);
                setFacultyCode('unknown');
                const found = universities.find((item) => item.code === code);
                setCampusCode(code === 'OTHER' ? 'main' : found?.campuses.length === 1 ? found.campuses[0]!.code : '');
              }}
            >
              <option value="">{copy.choose}</option>
              {universities.map((item) => (
                <option key={item.code} value={item.code}>
                  {language === 'ru' ? item.nameRu : item.nameEn}
                </option>
              ))}
              <option value="OTHER">{copy.otherUniversity}</option>
            </select>
            {universityCode === 'OTHER' && (
              <>
                <label className="field-label" htmlFor="university-name">
                  {copy.universityName}
                </label>
                <input
                  id="university-name"
                  value={universityName}
                  minLength={2}
                  maxLength={120}
                  required
                  onChange={(event) => setUniversityName(event.target.value)}
                />
              </>
            )}
            {selectedUniversity && selectedUniversity.campuses.length > 1 && (
              <>
                <label className="field-label" htmlFor="campus-code">
                  {copy.campus}
                </label>
                <select
                  id="campus-code"
                  value={campusCode}
                  required
                  onChange={(event) => setCampusCode(event.target.value)}
                >
                  <option value="">{copy.choose}</option>
                  {selectedUniversity.campuses.map((item) => (
                    <option key={item.code} value={item.code}>
                      {language === 'ru' ? item.nameRu : item.nameEn}
                    </option>
                  ))}
                </select>
              </>
            )}
            {needsProgramLevel && (
              <>
                <label className="field-label" htmlFor="program-level">
                  {copy.program}
                </label>
                <select
                  id="program-level"
                  value={programLevel}
                  onChange={(event) => setProgramLevel(event.target.value as typeof programLevel)}
                >
                  <option value="unknown">{copy.unknown}</option>
                  <option value="bachelor_specialist">{copy.bachelor}</option>
                  <option value="masters">{copy.masters}</option>
                  <option value="postgraduate">{copy.postgraduate}</option>
                </select>
              </>
            )}
            {(universityCode === 'MSU' || universityCode === 'TSU') && (
              <>
                <label className="field-label" htmlFor="faculty-code">
                  {copy.faculty}
                </label>
                <select
                  id="faculty-code"
                  value={facultyCode}
                  onChange={(event) => setFacultyCode(event.target.value as typeof facultyCode)}
                >
                  <option value="unknown">{copy.unknown}</option>
                  {universityCode === 'MSU' ? (
                    <>
                      <option value="msu_econ">{copy.msuEcon}</option>
                      <option value="msu_soil">{copy.msuSoil}</option>
                    </>
                  ) : (
                    <option value="tsu_law">{copy.tsuLaw}</option>
                  )}
                  <option value="other">{copy.otherFaculty}</option>
                </select>
              </>
            )}
            {directoryError && <p role="alert">{copy.directoryError}</p>}
            <label className="field-label" htmlFor="citizenship-country">
              {translate(language, 'citizenshipCountry')}
            </label>
            <input
              id="citizenship-country"
              list="citizenship-countries"
              value={citizenshipCountry}
              required
              autoComplete="country-name"
              placeholder={copy.choose}
              onChange={(event) => {
                const value = event.target.value;
                const code = countryCodeFromInput(value);
                const nextType = code ? (code === 'RU' ? 'rf' : 'foreign') : '';
                setCitizenshipCountry(value);
                setCitizenshipType(nextType);
                if (code === 'RU') setRussiaPresence('yes');
                if (nextType === 'foreign' && lastSelectedCitizenshipType.current === 'rf')
                  setRussiaPresence('unknown');
                if (nextType) lastSelectedCitizenshipType.current = nextType;
              }}
            />
            <datalist id="citizenship-countries">
              {countries.map(({ code, label }) => (
                <option key={code} value={label} />
              ))}
            </datalist>
            {citizenshipType === 'foreign' && (
              <>
                <label className="field-label" htmlFor="entry-mode">
                  {translate(language, 'entryModeQuestion')}
                </label>
                <select
                  id="entry-mode"
                  value={entryMode}
                  onChange={(event) => setEntryMode(event.target.value as typeof entryMode)}
                >
                  <option value="unknown">{copy.unknown}</option>
                  <option value="visa">{copy.visa}</option>
                  <option value="visa_free">{copy.visaFree}</option>
                </select>
              </>
            )}
            <label className="field-label" htmlFor="enrollment-state">
              {copy.enrollment}
            </label>
            <select
              id="enrollment-state"
              value={enrollmentState}
              onChange={(event) => setEnrollmentState(event.target.value as typeof enrollmentState)}
            >
              <option value="admitted">{copy.admitted}</option>
              <option value="awaiting_order">{copy.awaiting}</option>
            </select>
            {needsAdmissionYear && (
              <>
                <label className="field-label" htmlFor="admission-year">
                  {copy.year}
                </label>
                <input
                  id="admission-year"
                  type="number"
                  min="2020"
                  max="2100"
                  value={admissionYear ?? ''}
                  placeholder={copy.unknown}
                  aria-describedby="admission-year-hint"
                  onChange={(event) => setAdmissionYear(event.target.value ? Number(event.target.value) : null)}
                />
                <p id="admission-year-hint" className="microcopy">
                  {copy.yearUnknown}
                </p>
              </>
            )}
            <button
              className="primary-button wide"
              type="button"
              disabled={
                !selectedUniversity ||
                !citizenshipType ||
                !selectedCountryCode ||
                !campusCode ||
                (needsAdmissionYear &&
                  admissionYear !== null &&
                  (!Number.isInteger(admissionYear) || admissionYear < 2020 || admissionYear > 2100))
              }
              onClick={() => {
                setPhase(1);
                window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
              }}
            >
              {copy.next}
            </button>
            <p className="microcopy form-disclaimer">{copy.publicData}</p>
          </>
        ) : (
          <>
            {citizenshipType === 'foreign' && (
              <>
                <label className="field-label" htmlFor="study-arrival">
                  {translate(language, 'studyArrival')}
                </label>
                <select
                  id="study-arrival"
                  value={studyArrival}
                  aria-describedby="study-arrival-hint"
                  onChange={(event) => {
                    const next = event.target.value as typeof studyArrival;
                    setStudyArrival(next);
                    if (next === 'no') {
                      setArrivalStatus('preparing');
                      if (mobilityStatus === 'local' || mobilityStatus === 'moved') setMobilityStatus('moving');
                    }
                  }}
                >
                  <option value="unknown">{copy.unknown}</option>
                  <option value="yes">{translate(language, 'studyArrivalYes')}</option>
                  <option value="no">{translate(language, 'studyArrivalNo')}</option>
                </select>
                <p id="study-arrival-hint" className="microcopy">
                  {translate(language, 'studyArrivalHint')}
                </p>
                <label className="field-label" htmlFor="russia-presence">
                  {translate(language, 'russiaPresence')}
                </label>
                <select
                  id="russia-presence"
                  value={russiaPresence}
                  onChange={(event) => {
                    const next = event.target.value as typeof russiaPresence;
                    setRussiaPresence(next);
                  }}
                >
                  <option value="unknown">{copy.unknown}</option>
                  <option value="no">{translate(language, 'russiaNo')}</option>
                  <option value="yes">{translate(language, 'russiaYes')}</option>
                </select>
                {(russiaPresence === 'yes' || studyArrival === 'yes') && (
                  <>
                    <label className="field-label" htmlFor="russia-entry-date">
                      {translate(language, 'russiaEntryDate')}
                    </label>
                    <input
                      id="russia-entry-date"
                      type="date"
                      value={russiaEntryDate}
                      onChange={(event) => setRussiaEntryDate(event.target.value)}
                    />
                  </>
                )}
              </>
            )}
            <label className="field-label" htmlFor="mobility-status">
              {copy.mobility}
            </label>
            <select
              id="mobility-status"
              value={mobilityStatus}
              onChange={(event) => {
                const next = event.target.value as typeof mobilityStatus;
                setMobilityStatus(next);
                if (next === 'moving') setArrivalStatus('preparing');
                if (next === 'local' || next === 'moved') {
                  setArrivalStatus('arrived');
                  if (citizenshipType === 'foreign') setStudyArrival('yes');
                }
              }}
            >
              <option value="unknown">{copy.unknown}</option>
              <option value="local">{translate(language, 'mobilityLocal')}</option>
              <option value="moving">{translate(language, 'mobilityMoving')}</option>
              <option value="moved">{translate(language, 'mobilityMoved')}</option>
            </select>
            {citizenshipType === 'rf' && (
              <>
                <label className="field-label" htmlFor="military-status">
                  {copy.military}
                </label>
                <select
                  id="military-status"
                  value={militaryStatus}
                  onChange={(event) => setMilitaryStatus(event.target.value as typeof militaryStatus)}
                >
                  <option value="unknown">{copy.unknown}</option>
                  <option value="yes">{copy.yes}</option>
                  <option value="no">{copy.no}</option>
                  <option value="decline">{copy.decline}</option>
                </select>
              </>
            )}

            <fieldset>
              <legend>{translate(language, 'arrivalStatus')}</legend>
              <div className="option-grid two">
                <Choice
                  checked={arrivalStatus === 'preparing'}
                  label={translate(language, 'preparing')}
                  name="arrival"
                  value="preparing"
                  onChange={() => {
                    setArrivalStatus('preparing');
                    if (mobilityStatus === 'local' || mobilityStatus === 'moved') setMobilityStatus('moving');
                  }}
                />
                <Choice
                  checked={arrivalStatus === 'arrived'}
                  label={translate(language, 'arrived')}
                  name="arrival"
                  value="arrived"
                  onChange={() => {
                    setArrivalStatus('arrived');
                    if (mobilityStatus === 'moving') setMobilityStatus('moved');
                    if (citizenshipType === 'foreign') setStudyArrival('yes');
                  }}
                />
              </div>
            </fieldset>

            {mobilityStatus !== 'local' && (
              <>
                <label className="field-label" htmlFor="arrival-date">
                  {translate(language, 'arrivalDate')}
                </label>
                <input
                  id="arrival-date"
                  type="date"
                  value={arrivalDate}
                  onChange={(event) => setArrivalDate(event.target.value)}
                />
              </>
            )}

            <fieldset>
              <legend>{translate(language, 'housing')}</legend>
              <div className="option-grid three">
                {(['dormitory', 'private', 'relatives', 'unknown'] as const).map((type) => (
                  <Choice
                    key={type}
                    checked={accommodationType === type}
                    label={accommodationLabel(language, type)}
                    name="housing"
                    value={type}
                    onChange={() => setAccommodationType(type)}
                  />
                ))}
              </div>
            </fieldset>
            {accommodationType === 'dormitory' && (
              <>
                <label className="field-label" htmlFor="housing-status">
                  {copy.housingStatus}
                </label>
                <select
                  id="housing-status"
                  value={housingStatus}
                  onChange={(event) => setHousingStatus(event.target.value as typeof housingStatus)}
                >
                  <option value="unknown">{copy.unknown}</option>
                  <option value="confirmed">{copy.confirmed}</option>
                  <option value="applied">{copy.applied}</option>
                </select>
              </>
            )}

            {failed && <InlineError language={language} />}
            <button
              className="primary-button wide"
              type="submit"
              disabled={
                submitting ||
                !arrivalStatus ||
                !accommodationType ||
                !selectedUniversity ||
                !campusCode ||
                (universityCode === 'OTHER' && universityName.trim().length < 2)
              }
            >
              {submitting ? (
                <>
                  <Spinner />
                  {translate(language, 'creatingRoute')}
                </>
              ) : (
                translate(language, existingProfile ? 'editProfile' : 'createRoute')
              )}
            </button>
            <p className="microcopy">{translate(language, 'disclaimer')}</p>
          </>
        )}
      </form>
    </main>
  );
}

function Choice({
  checked,
  label,
  name,
  value,
  onChange,
}: {
  checked: boolean;
  label: string;
  name: string;
  value: string;
  onChange: () => void;
}) {
  return (
    <label className={`choice ${checked ? 'selected' : ''}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} />
      <span className="option-dot" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

function Header({ language, onLanguage }: { language: Language; onLanguage: (language: Language) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  async function changeLanguage(next: Language) {
    setSaving(true);
    setFailed(false);
    try {
      await onLanguage(next);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <header className="app-header">
      <Brand language={language} compact />
      <div className="header-tools">
        <select
          className="language-select"
          aria-label={translate(language, 'language')}
          value={language}
          disabled={saving}
          onChange={(event) => {
            if (isLanguage(event.target.value)) void changeLanguage(event.target.value);
          }}
        >
          {languageOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
        {failed && <InlineError language={language} />}
      </div>
    </header>
  );
}

const navItems: Array<{ id: View; icon: 'today' | 'route' | 'ask' | 'profile'; label: TranslationKey }> = [
  { id: 'today', icon: 'today', label: 'today' },
  { id: 'route', icon: 'route', label: 'route' },
  { id: 'ask', icon: 'ask', label: 'ask' },
  { id: 'profile', icon: 'profile', label: 'profile' },
];

function Navigation({ language, view, onChange }: { language: Language; view: View; onChange: (view: View) => void }) {
  return (
    <nav className="app-navigation" aria-label={translate(language, 'mainNavigation')}>
      <span className="nav-brand">{translate(language, 'appName')}</span>
      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={view === item.id ? 'active' : ''}
          aria-current={view === item.id ? 'page' : undefined}
          onClick={() => onChange(item.id)}
        >
          <Icon name={item.icon} weight={view === item.id ? 'fill' : 'regular'} />
          <span>{translate(language, item.label)}</span>
        </button>
      ))}
    </nav>
  );
}

function ProgressCard({ language, route }: { language: Language; route: Route }) {
  const percent = Math.max(0, Math.min(100, Math.round(route.progress.percent)));
  return (
    <section className="progress-card" aria-labelledby="progress-title">
      <div className="progress-copy">
        <p className="section-kicker" id="progress-title">
          {translate(language, 'overallProgress')}
        </p>
        <p className="progress-caption">
          {translate(language, 'completedOf', { completed: route.progress.completed, total: route.progress.total })}
          <span className="remaining-count">
            {translate(language, 'remainingSteps', { count: route.progress.total - route.progress.completed })}
          </span>
        </p>
      </div>
      <strong className="progress-number">{percent}%</strong>
      <div
        className="linear-progress"
        role="progressbar"
        aria-label={translate(language, 'overallProgress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}

function Deadline({ language, step }: { language: Language; step: RouteStep }) {
  const dueOn = step.deadlineSchedule?.dueOn ?? step.deadline;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: step.deadlineSchedule?.timezone ?? 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const overdue =
    step.status !== 'COMPLETED' &&
    (step.deadlineSchedule?.dueAt
      ? new Date(step.deadlineSchedule.dueAt) < new Date()
      : Boolean(dueOn && dueOn < today));
  const formatted = step.deadlineSchedule?.dueAt
    ? `${new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short', timeZone: step.deadlineSchedule.timezone ?? 'UTC' }).format(new Date(step.deadlineSchedule.dueAt))} (${step.deadlineSchedule.timezone ?? 'UTC'})`
    : formatDate(dueOn, language);
  return (
    <span className={`deadline ${overdue ? 'overdue' : ''}`}>
      <Icon name="calendar" />
      {formatted ?? (step.deadlineNote || translate(language, 'noDeadline'))}
      {overdue && <strong>{translate(language, 'overdue')}</strong>}
    </span>
  );
}

function StepStatusBadge({ language, status }: { language: Language; status: StepStatus }) {
  return (
    <span className={`status-badge ${status.toLowerCase()}`}>
      {status === 'COMPLETED' && <Icon name="check" />}
      {statusLabel(language, status)}
    </span>
  );
}

function NextActionCard({
  language,
  step,
  onOpen,
}: {
  language: Language;
  step: RouteStep | null;
  onOpen: (step: RouteStep) => void;
}) {
  return (
    <section className={`next-card ${step ? '' : 'complete'}`} aria-labelledby="next-title">
      <p className="section-kicker" id="next-title">
        {translate(language, 'nextAction')}
      </p>
      {step ? (
        <>
          <div className="card-topline">
            <span className="stage-chip">{stepStageLabel(language, step)}</span>
            <StepStatusBadge language={language} status={step.status} />
          </div>
          <h2>{step.title}</h2>
          <p>{step.description}</p>
          <Deadline language={language} step={step} />
          <button className="primary-button wide" type="button" onClick={() => onOpen(step)}>
            {translate(language, 'openStep')} <Icon name="arrow" />
          </button>
        </>
      ) : (
        <>
          <span className="success-icon">
            <Icon name="check" />
          </span>
          <h2>{translate(language, 'noNextAction')}</h2>
          <p>{translate(language, 'noNextActionHint')}</p>
        </>
      )}
    </section>
  );
}

function EmptyRoute({ language, onRefresh, onAsk }: { language: Language; onRefresh: () => void; onAsk: () => void }) {
  return (
    <section className="empty-state">
      <div className="empty-symbol" aria-hidden="true">
        <CompassIcon weight="duotone" />
      </div>
      <h1>{translate(language, 'emptyRoute')}</h1>
      <p>{translate(language, 'emptyRouteHint')}</p>
      <div className="button-row center">
        <button type="button" className="primary-button" onClick={onRefresh}>
          {translate(language, 'refresh')}
        </button>
        <button type="button" className="secondary-button" onClick={onAsk}>
          {translate(language, 'contactHuman')}
        </button>
      </div>
    </section>
  );
}

function TodayView({
  language,
  route,
  onOpenStep,
  onOpenRoute,
  onSituation,
  onArrival,
  canConfirmArrival,
  onRefresh,
  onAsk,
  showReminderOffer,
  onReminderOffer,
}: {
  language: Language;
  route: Route | null;
  onOpenStep: (step: RouteStep) => void;
  onOpenRoute: () => void;
  onSituation: () => void;
  onArrival: () => void;
  canConfirmArrival: boolean;
  onRefresh: () => void;
  onAsk: () => void;
  showReminderOffer: boolean;
  onReminderOffer: () => void;
}) {
  if (!route || route.steps.filter((step) => step.isActive).length === 0) {
    return <EmptyRoute language={language} onRefresh={onRefresh} onAsk={onAsk} />;
  }

  return (
    <>
      <section className="hero-section">
        <span className="eyebrow">{route.university ?? translate(language, 'pilot')}</span>
        <h1>{translate(language, 'greeting')}</h1>
        <p className="lead">{translate(language, 'subtitle')}</p>
        <span className="pilot-badge">{translate(language, 'pilot')}</span>
      </section>
      <div className="dashboard-grid">
        <ProgressCard language={language} route={route} />
        <NextActionCard language={language} step={route.nextAction} onOpen={onOpenStep} />
      </div>
      {showReminderOffer && route.nextAction && (
        <div className="reminder-offer">
          <p>{translate(language, 'reminderAfterPlan')}</p>
          <button type="button" className="text-button" onClick={onReminderOffer}>
            {translate(language, 'reminders')}
          </button>
        </div>
      )}
      <button className="secondary-button wide" type="button" onClick={onOpenRoute}>
        {translate(language, 'fullRoute')} <Icon name="arrow" />
      </button>
      <section className="situation-card">
        <div>
          <h2>{translate(language, 'situationChanged')}</h2>
          <p>{translate(language, 'situationHint')}</p>
        </div>
        <div className="button-row">
          {canConfirmArrival && (
            <button className="secondary-button" type="button" onClick={onArrival}>
              {translate(language, 'confirmArrival')}
            </button>
          )}
          <button className="text-button" type="button" onClick={onSituation}>
            {translate(language, 'changeHousing')}
          </button>
        </div>
      </section>
      <aside className="disclaimer">
        <Icon name="info" />
        <p>{translate(language, 'disclaimer')}</p>
      </aside>
    </>
  );
}

function RouteView({
  language,
  route,
  highlightedCode,
  onOpenStep,
  onRefresh,
  onAsk,
}: {
  language: Language;
  route: Route | null;
  highlightedCode: string | null;
  onOpenStep: (step: RouteStep) => void;
  onRefresh: () => void;
  onAsk: () => void;
}) {
  if (!route) {
    return <EmptyRoute language={language} onRefresh={onRefresh} onAsk={onAsk} />;
  }
  if (route.steps.every((step) => !step.isActive)) {
    return (
      <section className="route-view">
        <EmptyRoute language={language} onRefresh={onRefresh} onAsk={onAsk} />
      </section>
    );
  }
  const groups = new Map<string, RouteStep[]>();
  for (const step of orderedRouteSteps(route)) {
    const group = `${step.scope === 'general' ? 'general' : 'university'}:${step.stage}`;
    const current = groups.get(group) ?? [];
    current.push(step);
    groups.set(group, current);
  }

  return (
    <section className="route-view">
      {(route.possibleSteps ?? []).some((step) => step.knowledge?.releaseVerified) && (
        <label className="field">
          <span>{routeKnowledgeText(language, 'additional')}</span>
          <select
            value=""
            onChange={(e) => {
              const step = route.possibleSteps?.find((s) => s.code === e.target.value);
              if (step) onOpenStep(step);
            }}
          >
            <option value="">{translate(language, 'unknown')}</option>
            {route.possibleSteps
              ?.filter((step) => step.knowledge?.releaseVerified)
              .map((step) => (
                <option key={step.code} value={step.code}>
                  {step.title}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="page-heading">
        <div>
          <span className="eyebrow">{route.university ?? translate(language, 'pilot')}</span>
          <h1>{translate(language, 'fullRoute')}</h1>
        </div>
        <span className="route-version">{translate(language, 'routeVersion', { version: route.version })}</span>
      </div>
      <ProgressCard language={language} route={route} />
      <p className="microcopy">{translate(language, 'directoryDisclaimer')}</p>
      {route.steps.some((step) => step.knowledge) && (
        <p className="microcopy">{routeKnowledgeText(language, 'notice')}</p>
      )}
      <p className="microcopy">{translate(language, 'stageHint')}</p>
      <div className="timeline">
        {[...groups.entries()]
          .sort(([left], [right]) => (left.startsWith('general') ? 0 : 1) - (right.startsWith('general') ? 0 : 1))
          .map(([group, steps], stageIndex) => (
            <section className="timeline-stage" key={group}>
              <header>
                <span className="stage-index">{stageIndex + 1}</span>
                <h2>
                  {translate(language, group.startsWith('general') ? 'generalRules' : 'universityInformation')} ·{' '}
                  {steps[0] && steps.every((step) => step.code.startsWith('CHECK_UNIVERSITY_'))
                    ? stepStageLabel(language, steps[0])
                    : stageLabel(language, group.split(':')[1] ?? '')}
                </h2>
              </header>
              <div className="timeline-steps">
                {steps.map((step) => (
                  <button
                    type="button"
                    id={`step-${step.code}`}
                    key={step.id || step.code}
                    className={`step-row ${step.status === 'COMPLETED' ? 'done' : ''} ${!step.isActive ? 'inactive' : ''} ${highlightedCode === step.code ? 'highlighted' : ''}`}
                    onClick={() => onOpenStep(step)}
                  >
                    <span className="step-marker">{step.status === 'COMPLETED' ? <Icon name="check" /> : null}</span>
                    <span className="step-copy">
                      {highlightedCode === step.code && (
                        <small className="highlight-label">{translate(language, 'stepHighlighted')}</small>
                      )}
                      <strong>{step.title}</strong>
                      <span>{step.description}</span>
                      <Deadline language={language} step={step} />
                    </span>
                    <StepStatusBadge language={language} status={step.status} />
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
            </section>
          ))}
      </div>
    </section>
  );
}

function PreviewDestination({
  destination,
  language,
}: {
  destination: KnowledgeRouteDestination | null;
  language: Language;
}) {
  if (!destination) return null;
  return (
    <div className="preview-block">
      <h4>{translate(language, 'contact')}</h4>
      <p>{destination.name}</p>
      {destination.address && <p>{destination.address}</p>}
      {destination.notes && <p>{destination.notes}</p>}
      {(destination.contacts ?? []).map((contact, index) => (
        <p key={`${contact.kind}-${index}`}>
          {contact.label ? `${contact.label}: ` : ''}
          {contact.value}
        </p>
      ))}
      {[destination.url, destination.information_url]
        .filter((url): url is string => Boolean(url && safeExternalUrl(url)))
        .map((url) => (
          <a key={url} href={safeExternalUrl(url) ?? undefined} target="_blank" rel="noreferrer">
            {url}
          </a>
        ))}
    </div>
  );
}

function KnowledgeDetails({ language, card }: { language: Language; card: KnowledgeRouteCard }) {
  return (
    <div className="route-knowledge-body">
      <h2>{routeKnowledgeText(language, 'title')}</h2>
      <p className="preview-warning">{routeKnowledgeText(language, card.releaseVerified ? 'released' : 'notice')}</p>
      {card.doNotExtrapolate && <p>{routeKnowledgeText(language, 'campaign')}</p>}
      {card.dateScope?.includes('old') && <p>{routeKnowledgeText(language, 'limited')}</p>}
      {language !== 'ru' && <p>{routeKnowledgeText(language, 'original')}</p>}
      <div className="route-knowledge-card-body">
        <p>{card.summary}</p>
        {card.instructions.length > 0 && (
          <ol>
            {card.instructions.map((instruction, index) => (
              <li key={index}>{instruction}</li>
            ))}
          </ol>
        )}
        {card.documents.some((document) => document.applicability !== false) && (
          <div className="preview-block">
            <h4>{translate(language, 'preparation')}</h4>
            <ul>
              {card.documents
                .filter((document) => document.applicability !== false)
                .map((document, index) => (
                  <li key={index}>
                    {document.title}
                    {document.applicability !== true &&
                      ` — ${routeKnowledgeText(language, document.applicability === false ? 'excluded' : 'pending')}`}
                    {document.applicability === true && document.instructions && <p>{document.instructions}</p>}
                  </li>
                ))}
            </ul>
          </div>
        )}
        <PreviewDestination destination={card.destination} language={language} />
        <div className="preview-block">
          <h4>{translate(language, 'deadline')}</h4>
          {!card.releaseVerified && <p>{routeKnowledgeText(language, 'noDate')}</p>}
          {card.deadlineNotes.map((note, index) => (
            <p key={index}>
              {!card.releaseVerified && `${routeKnowledgeText(language, 'reported')}: `}
              {note}
            </p>
          ))}
          {card.reportedDeadlineText && (
            <p>
              {routeKnowledgeText(language, 'reported')}: {card.reportedDeadlineText}
            </p>
          )}
        </div>
        {card.federalRules?.map((rule) => (
          <div className="preview-block" key={rule.id}>
            <h4>{routeKnowledgeText(language, 'federal')}</h4>
            <p>{rule.action}</p>
            <p>{rule.deadline}</p>
          </div>
        ))}
        {card.result && (
          <div className="preview-block">
            <h4>{routeKnowledgeText(language, 'outcome')}</h4>
            <p>{card.result.title}</p>
            {card.result.instructions && <p>{card.result.instructions}</p>}
          </div>
        )}
        {card.overlays
          .filter((overlay) => overlay.applicability === true)
          .map((overlay) => (
            <div className="preview-block preview-addition" key={overlay.id}>
              <h4>
                {routeKnowledgeText(language, 'addition')} ·{' '}
                {routeKnowledgeText(
                  language,
                  overlay.applicability === true
                    ? 'included'
                    : overlay.applicability === false
                      ? 'excluded'
                      : 'pending',
                )}
              </h4>
              {overlay.instructions.length > 0 && (
                <ol>
                  {overlay.instructions.map((instruction, index) => (
                    <li key={index}>{instruction}</li>
                  ))}
                </ol>
              )}
              {overlay.documents.some((document) => document.applicability !== false) && (
                <ul>
                  {overlay.documents
                    .filter((document) => document.applicability !== false)
                    .map((document, index) => (
                      <li key={index}>
                        {document.title}
                        {document.applicability === 'unknown' && ` — ${routeKnowledgeText(language, 'pending')}`}
                        {document.applicability === true && document.instructions && <p>{document.instructions}</p>}
                      </li>
                    ))}
                </ul>
              )}
              <PreviewDestination destination={overlay.destination} language={language} />
              {overlay.localDeadlines.map((deadline, index) => (
                <p key={index}>
                  {routeKnowledgeText(language, 'reported')}: {deadline.title}
                  {deadline.reportedText ? ` — ${deadline.reportedText}` : ''}
                </p>
              ))}
              {overlay.warnings.length > 0 && (
                <div>
                  <h4>{routeKnowledgeText(language, 'limitations')}</h4>
                  <ul>
                    {overlay.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
              {overlay.sources.map((source) => (
                <p key={source.id}>
                  {safeExternalUrl(source.url) ? (
                    <a href={safeExternalUrl(source.url) ?? undefined} target="_blank" rel="noreferrer">
                      {source.title}
                    </a>
                  ) : (
                    source.title
                  )}{' '}
                  · {routeKnowledgeText(language, source.status === 'verified' ? 'checkedSource' : 'unverified')}
                </p>
              ))}
            </div>
          ))}
        {(card.warnings.length > 0 || card.exceptions.length > 0 || card.unresolvedIds.length > 0) && (
          <div className="preview-block">
            <h4>{routeKnowledgeText(language, 'limitations')}</h4>
            <ul>
              {[...card.warnings, ...card.exceptions].map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        )}
        {card.sources.length > 0 && (
          <div className="preview-block">
            <h4>{routeKnowledgeText(language, 'source')}</h4>
            {card.sources.map((source) => (
              <p key={source.id}>
                {safeExternalUrl(source.url) ? (
                  <a href={safeExternalUrl(source.url) ?? undefined} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                ) : (
                  source.title
                )}{' '}
                · {source.publisher} ·{' '}
                {routeKnowledgeText(language, source.status === 'verified' ? 'checkedSource' : 'unverified')}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Modal({
  title,
  closeLabel,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={modalRef}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="modal-header">
          <p id={titleId}>{title}</p>
          <button ref={closeRef} type="button" className="icon-button" aria-label={closeLabel} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function KnowledgeContextForm({
  language,
  step,
  onSaved,
}: {
  language: Language;
  step: RouteStep;
  onSaved: (route: Route) => void;
}) {
  const fields = (step.knowledge?.inputs ?? []).filter((field) => !field.readOnly);
  const [values, setValues] = useState<Record<string, string | number | boolean | null>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  if (!fields.length) return null;
  return (
    <details className="preview-block">
      <summary>{routeKnowledgeText(language, 'inputs')}</summary>
      {language !== 'ru' && <p>{routeKnowledgeText(language, 'original')}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(false);
          const submitted = new FormData(e.currentTarget);
          const facts: Record<string, string | number | boolean | null> = {};
          const dates: Record<string, string | null> = {};
          for (const field of fields) {
            const k = `${field.kind}:${field.key}`;
            const raw = submitted.get(k);
            if (typeof raw !== 'string' || (!raw && !(k in values) && field.value == null)) continue;
            const value = !raw
              ? null
              : field.kind === 'date'
                ? raw
                : field.number
                  ? Number(raw)
                  : field.options.length
                    ? (JSON.parse(raw) as string | number | boolean)
                    : raw;
            if (field.kind === 'date')
              dates[field.key] =
                typeof value === 'string' && value ? (field.timestamp ? new Date(value).toISOString() : value) : null;
            else facts[field.key] = value;
          }
          try {
            const result = await api.updateKnowledgeContext(step.code, { facts, dates });
            onSaved(result.route);
          } catch {
            setError(true);
          } finally {
            setSaving(false);
          }
        }}
      >
        {fields.map((field) => {
          const k = `${field.kind}:${field.key}`;
          const value = k in values ? values[k] : field.value;
          return (
            <label className="field" key={k}>
              <span>{field.label}</span>
              {field.readOnly ? (
                <p>
                  {typeof value === 'boolean'
                    ? routeKnowledgeText(language, value ? 'yes' : 'no')
                    : String(value ?? '')}
                </p>
              ) : field.kind === 'date' ? (
                <input
                  name={k}
                  type={field.timestamp ? 'datetime-local' : 'date'}
                  value={
                    typeof value === 'string'
                      ? field.timestamp && value.includes('T')
                        ? datetimeLocalValue(new Date(value))
                        : value
                      : ''
                  }
                  onChange={(e) => {
                    const next = e.target.value || null;
                    setValues((v) => ({ ...v, [k]: next }));
                  }}
                />
              ) : field.number || !field.options.length ? (
                <input
                  name={k}
                  type={field.number ? 'number' : 'text'}
                  value={String(value ?? '')}
                  onChange={(e) => {
                    const next = e.target.value ? (field.number ? Number(e.target.value) : e.target.value) : null;
                    setValues((v) => ({ ...v, [k]: next }));
                  }}
                />
              ) : (
                <select
                  name={k}
                  value={value === null ? '' : JSON.stringify(value)}
                  onChange={(e) => {
                    const next = e.target.value ? (JSON.parse(e.target.value) as string | number | boolean) : null;
                    setValues((v) => ({ ...v, [k]: next }));
                  }}
                >
                  <option value="">{translate(language, 'unknown')}</option>
                  {field.options.map((option) => (
                    <option key={JSON.stringify(option)} value={JSON.stringify(option)}>
                      {typeof option === 'boolean'
                        ? routeKnowledgeText(language, option ? 'yes' : 'no')
                        : String(option)}
                    </option>
                  ))}
                </select>
              )}
            </label>
          );
        })}
        <button className="primary-button" disabled={saving} type="submit">
          {saving ? translate(language, 'saving') : routeKnowledgeText(language, 'save')}
        </button>
        {error && <p role="alert">{translate(language, 'updateError')}</p>}
      </form>
    </details>
  );
}

type ScheduledReminder = { stepCode: string; scheduledFor: string };

function useScheduledReminders(enabled: boolean) {
  const [items, setItems] = useState<ScheduledReminder[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setFailed(false);
    setLoading(true);
    try {
      setItems((await api.reminders()).reminders);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [enabled, reload]);
  return { items, failed, loading, reload };
}

function ReminderEditor({
  language,
  step,
  enabled,
  reminders,
  onSaved,
  disabled = false,
}: {
  language: Language;
  step: RouteStep;
  enabled: boolean;
  reminders: ScheduledReminder[];
  onSaved: () => Promise<void>;
  disabled?: boolean;
}) {
  const scheduled = reminders
    .filter((item) => item.stepCode === step.code)
    .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
  const savedAt = scheduled[0]?.scheduledFor;
  const [value, setValue] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'invalid'>('idle');
  useEffect(() => {
    setValue(savedAt ? datetimeLocalValue(new Date(savedAt)) : '');
    setState('idle');
  }, [savedAt, step.code]);
  const active = enabled && Boolean(savedAt);
  const locked = disabled || !enabled || state === 'saving';
  async function save(mode: 'manual' | 'off' | 'automatic', dateValue = value) {
    const date = new Date(dateValue);
    if (mode === 'manual' && (!Number.isFinite(date.valueOf()) || date <= new Date())) {
      setState('invalid');
      return;
    }
    setState('saving');
    try {
      if (mode === 'manual') await api.createReminder(step.code, date.toISOString());
      else await api.configureReminder(step.code, mode);
      await onSaved();
      setState('saved');
    } catch {
      if (!dateValue && savedAt) setValue(datetimeLocalValue(new Date(savedAt)));
      setState('error');
    }
  }
  return (
    <section className="inline-reminder" aria-label={step.title}>
      <div className="reminder-controls">
        <button
          type="button"
          role="switch"
          className={`toggle-button ${active ? 'on' : ''}`}
          aria-label={`${translate(language, 'reminders')}: ${step.title}`}
          aria-checked={active}
          disabled={locked || (!active && !value)}
          onClick={() => void save(active ? 'off' : 'manual')}
        >
          <span />
        </button>
        <label className="reminder-picker">
          <span>{translate(language, 'reminderDateTime')}</span>
          <input
            type="datetime-local"
            value={value}
            min={datetimeLocalValue(new Date(Date.now() + 60_000))}
            disabled={locked}
            onChange={(event) => {
              setValue(event.target.value);
              setState('idle');
              if (!event.target.value && active) void save('off', '');
            }}
          />
        </label>
        <button
          className="secondary-button"
          type="button"
          disabled={locked || !value}
          onClick={() => void save('manual')}
        >
          {state === 'saving' ? <Spinner /> : translate(language, 'saveReminder')}
        </button>
        {step.deadlineSchedule?.reminderOn && (
          <button className="text-button" type="button" disabled={locked} onClick={() => void save('automatic')}>
            {translate(language, 'automaticReminder')}
          </button>
        )}
      </div>
      {scheduled.map((item) => (
        <p className="microcopy" key={item.scheduledFor}>
          {translate(language, 'reminderSavedTime', {
            time: new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(
              new Date(item.scheduledFor),
            ),
          })}
        </p>
      ))}
      {!enabled && <p className="microcopy">{translate(language, 'remindersNeedOptIn')}</p>}
      {state === 'invalid' && <p className="form-error">{translate(language, 'reminderTimeInvalid')}</p>}
      {state === 'error' && <InlineError language={language} />}
      {state === 'saved' && (
        <p role="status" className="microcopy">
          {translate(language, 'reminderUpdated')}
        </p>
      )}
    </section>
  );
}

function StepDetail({
  language,
  step,
  remindersEnabled,
  onClose,
  onComplete,
  onStart,
  onContextSaved,
}: {
  language: Language;
  step: RouteStep;
  remindersEnabled: boolean;
  onClose: () => void;
  onComplete: (code: string) => Promise<void>;
  onStart: (code: string) => Promise<void>;
  onContextSaved: (route: Route) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const scheduled = useScheduledReminders(remindersEnabled);

  async function complete(start = false) {
    setSaving(true);
    setFailed(false);
    try {
      if (start) await onStart(step.code);
      else await onComplete(step.code);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={translate(language, 'stepDetails')} closeLabel={translate(language, 'close')} onClose={onClose} wide>
      <div className="detail-heading">
        <div className="card-topline">
          <span className="stage-chip">{stepStageLabel(language, step)}</span>
          <span className={`verification-badge ${step.verificationStatus}`}>
            {verificationLabel(language, step.verificationStatus)}
          </span>
        </div>
        <p className="microcopy">{translate(language, 'stageHint')}</p>
        <h1>{step.title}</h1>
        <p className="lead">{step.description}</p>
        {step.isActive ? (
          <StepStatusBadge language={language} status={step.status} />
        ) : (
          <span className="verification-badge needs_confirmation">{routeKnowledgeText(language, 'pending')}</span>
        )}
      </div>

      <div className="detail-grid">
        {step.knowledge && (
          <section className="detail-section">
            <KnowledgeDetails language={language} card={step.knowledge} />
            {step.knowledge.releaseVerified && (
              <>
                <Deadline language={language} step={step} />
                {step.deadlineSchedule?.reason &&
                  !['not_eligible', 'manual_rule'].includes(step.deadlineSchedule.reason) && (
                    <p>
                      {routeKnowledgeText(
                        language,
                        step.deadlineSchedule.reason === 'calendar_required' ? 'calendar' : 'missingDate',
                      )}
                    </p>
                  )}
                {step.deadlineSchedule?.kind === 'progress_check' && (
                  <p>
                    {routeKnowledgeText(language, 'progress')} {formatDate(step.deadlineSchedule.reminderOn, language)}
                  </p>
                )}
                <KnowledgeContextForm key={step.code} language={language} step={step} onSaved={onContextSaved} />
              </>
            )}
          </section>
        )}
        {!step.knowledge && (
          <>
            <section className="detail-section prominent">
              <h2>{translate(language, 'whyImportant')}</h2>
              <p>{step.whyImportant}</p>
            </section>
            <section className="detail-section">
              <h2>{translate(language, 'deadline')}</h2>
              <Deadline language={language} step={step} />
              {!step.deadline && <p>{translate(language, 'deadlineHelp')}</p>}
              {step.deadline && step.deadlineNote && <p>{step.deadlineNote}</p>}
            </section>
            <section className="detail-section">
              <h2>{translate(language, 'preparation')}</h2>
              {step.preparation.length > 0 ? (
                <ul className="check-list">
                  {step.preparation.map((item) => (
                    <li key={item}>
                      <Icon name="check" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{translate(language, 'noPreparation')}</p>
              )}
            </section>
            {step.contact && (
              <section className="detail-section">
                <h2>{translate(language, 'contact')}</h2>
                <p className="preserve-lines">{step.contact}</p>
              </section>
            )}
            <section className="detail-section source-section">
              <h2>{translate(language, 'officialSource')}</h2>
              {step.source && safeExternalUrl(step.source.url) ? (
                <a
                  href={safeExternalUrl(step.source.url) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="source-link"
                  onClick={(event) => {
                    if (openMaxExternalLink(step.source!.url)) event.preventDefault();
                  }}
                >
                  <span>
                    <strong>{step.source.title}</strong>
                    <small>{step.source.authority}</small>
                  </span>
                  <Icon name="external" />
                </a>
              ) : (
                <p>{translate(language, 'sourceUnavailable')}</p>
              )}
              {step.source?.languages?.length === 1 && step.source.languages[0] === 'ru' && language !== 'ru' && (
                <p className="valid-date">{translate(language, 'sourceInRussian')}</p>
              )}
              {step.validAsOf && (
                <p className="valid-date">
                  {translate(language, 'checkedOn', { date: formatDate(step.validAsOf, language) ?? step.validAsOf })}
                </p>
              )}
              {step.source?.metadata?.appliesTo && (
                <p className="valid-date">
                  {translate(language, 'appliesTo', {
                    value:
                      language === 'ru'
                        ? step.source.metadata.appliesTo
                        : (step.source.metadata.appliesToEn ?? step.source.metadata.appliesTo),
                  })}
                </p>
              )}
              {step.source?.metadata?.admissionYear && (
                <p className="valid-date">
                  {translate(language, 'admissionYear', { year: step.source.metadata.admissionYear })}
                </p>
              )}
            </section>
          </>
        )}
      </div>

      {failed && <InlineError language={language} retry={() => void complete()} />}
      {step.isActive && step.status !== 'COMPLETED' && (
        <section className="detail-section reminder-section">
          <h2>{translate(language, 'reminders')}</h2>
          <p className="microcopy">{translate(language, 'reminderLocalTime')}</p>
          {scheduled.failed && <InlineError language={language} retry={() => void scheduled.reload()} />}
          <ReminderEditor
            language={language}
            step={step}
            enabled={remindersEnabled}
            reminders={scheduled.items}
            onSaved={scheduled.reload}
            disabled={scheduled.loading || scheduled.failed}
          />
        </section>
      )}
      <div className="sticky-actions">
        {!step.isActive ? (
          <p>{routeKnowledgeText(language, 'pending')}</p>
        ) : step.status !== 'COMPLETED' ? (
          <>
            {step.status === 'NOT_STARTED' && (
              <button className="secondary-button" type="button" disabled={saving} onClick={() => void complete(true)}>
                {translate(language, 'startStep')}
              </button>
            )}
            <button className="primary-button" type="button" disabled={saving} onClick={() => void complete()}>
              {saving ? (
                <>
                  <Spinner />
                  {translate(language, 'marking')}
                </>
              ) : (
                <>
                  <Icon name="check" />
                  {translate(language, 'markCompleted')}
                </>
              )}
            </button>
          </>
        ) : (
          <span className="completed-message">
            <Icon name="check" />
            {translate(language, 'completed')}
          </span>
        )}
      </div>
    </Modal>
  );
}

function candidateAccommodation(candidate: Candidate): AccommodationType | null {
  return candidate.accommodationType ?? candidate.payload?.accommodationType ?? null;
}

function diffList(diff: RouteDiff, keys: string[]): Array<string | Pick<RouteStep, 'code' | 'title'>> {
  for (const key of keys) {
    const value = diff[key];
    if (Array.isArray(value)) return value as Array<string | Pick<RouteStep, 'code' | 'title'>>;
  }
  return [];
}

function diffItemLabel(
  item: string | Pick<RouteStep, 'code' | 'title'>,
  labels: Readonly<Record<string, string>>,
): string {
  if (typeof item !== 'string') return item.title || item.code;
  if (labels[item]) return labels[item];

  const readable = item.replaceAll('_', ' ').toLocaleLowerCase();
  return readable.charAt(0).toLocaleUpperCase() + readable.slice(1);
}

function SituationModal({
  language,
  current,
  route,
  onClose,
  onApplied,
}: {
  language: Language;
  current: AccommodationType;
  route: Route;
  onClose: () => void;
  onApplied: (route: Route, next: AccommodationType) => void;
}) {
  const initial = current === 'dormitory' ? 'private' : 'dormitory';
  const [selected, setSelected] = useState<AccommodationType>(initial);
  const [phase, setPhase] = useState<'select' | 'review' | 'result'>('select');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [diff, setDiff] = useState<RouteDiff | null>(null);
  const [stepLabels, setStepLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(route.steps.map((step) => [step.code, step.title])),
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryAction, setRetryAction] = useState<'create' | 'confirm' | 'cancel-edit' | 'cancel-close'>('create');

  async function createCandidate() {
    setBusy(true);
    setFailed(false);
    setRetryAction('create');
    try {
      const response = await api.createCandidate(selected);
      setCandidate(response.candidate);
      setPhase('review');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function cancelCandidate(close = true) {
    if (!candidate) {
      if (close) onClose();
      return;
    }
    setBusy(true);
    setFailed(false);
    setRetryAction(close ? 'cancel-close' : 'cancel-edit');
    try {
      await api.cancelCandidate(candidate.id);
      setCandidate(null);
      if (close) onClose();
      else setPhase('select');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCandidate() {
    if (!candidate) return;
    setBusy(true);
    setFailed(false);
    setRetryAction('confirm');
    try {
      const response = await api.confirmCandidate(candidate.id);
      const next = candidateAccommodation(candidate) ?? selected;
      setStepLabels((labels) => ({
        ...labels,
        ...Object.fromEntries(response.route.steps.map((step) => [step.code, step.title])),
      }));
      setDiff(response.diff);
      onApplied(response.route, next);
      setPhase('result');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const added = diff ? diffList(diff, ['added', 'addedSteps', 'added_steps']) : [];
  const deactivated = diff ? diffList(diff, ['deactivated', 'deactivatedSteps', 'removed', 'removedSteps']) : [];
  const deadlines = diff
    ? diffList(diff, ['changedDeadlines', 'changed_deadlines', 'deadlineChanges', 'deadlineChanged'])
    : [];
  const preserved = diff
    ? diffList(diff, ['preservedCompleted', 'preserved_completed', 'preservedCompletedSteps'])
    : [];

  function retry() {
    if (retryAction === 'create') void createCandidate();
    else if (retryAction === 'confirm') void confirmCandidate();
    else void cancelCandidate(retryAction === 'cancel-close');
  }

  return (
    <Modal
      title={translate(language, 'situationChanged')}
      closeLabel={translate(language, 'close')}
      onClose={() => {
        if (busy) return;
        if (phase === 'result') onClose();
        else void cancelCandidate(true);
      }}
    >
      {phase === 'select' && (
        <div className="flow-panel">
          <p className="lead">{translate(language, 'situationHint')}</p>
          <div className="change-summary">
            <small>{translate(language, 'currentHousing')}</small>
            <strong>{accommodationLabel(language, current)}</strong>
          </div>
          <fieldset>
            <legend>{translate(language, 'newHousing')}</legend>
            <div className="option-grid one">
              {(['dormitory', 'private', 'relatives'] as const)
                .filter((type) => type !== current)
                .map((type) => (
                  <Choice
                    key={type}
                    checked={selected === type}
                    label={accommodationLabel(language, type)}
                    name="new-housing"
                    value={type}
                    onChange={() => setSelected(type)}
                  />
                ))}
            </div>
          </fieldset>
          {failed && <InlineError language={language} retry={retry} />}
          <div className="button-row">
            <button className="primary-button" type="button" disabled={busy} onClick={() => void createCandidate()}>
              {busy ? <Spinner /> : null}
              {translate(language, 'continue')}
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
              {translate(language, 'cancel')}
            </button>
          </div>
        </div>
      )}
      {phase === 'review' && candidate && (
        <div className="flow-panel">
          <div className="review-symbol" aria-hidden="true">
            <Icon name="warning" />
          </div>
          <h1>{translate(language, 'reviewChange')}</h1>
          <p>{translate(language, 'reviewChangeHint')}</p>
          <div className="candidate-card">
            <span>{accommodationLabel(language, current)}</span>
            <Icon name="arrow" />
            <strong>{accommodationLabel(language, candidateAccommodation(candidate) ?? selected)}</strong>
          </div>
          {failed && <InlineError language={language} retry={retry} />}
          <div className="button-row stacked-mobile">
            <button className="primary-button" type="button" disabled={busy} onClick={() => void confirmCandidate()}>
              {busy ? <Spinner /> : null}
              {translate(language, 'confirm')}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void cancelCandidate(false)}
            >
              {translate(language, 'edit')}
            </button>
            <button
              className="text-button danger"
              type="button"
              disabled={busy}
              onClick={() => void cancelCandidate(true)}
            >
              {translate(language, 'cancel')}
            </button>
          </div>
        </div>
      )}
      {phase === 'result' && diff && (
        <div className="flow-panel result-panel">
          <span className="success-icon">
            <Icon name="check" />
          </span>
          <h1>{translate(language, 'routeUpdated')}</h1>
          <p>{translate(language, 'routeUpdatedHint')}</p>
          <div className="diff-list">
            <DiffGroup label={translate(language, 'added')} items={added} labels={stepLabels} tone="added" />
            <DiffGroup
              label={translate(language, 'deactivated')}
              items={deactivated}
              labels={stepLabels}
              tone="removed"
            />
            <DiffGroup
              label={translate(language, 'changedDeadlines')}
              items={deadlines}
              labels={stepLabels}
              tone="changed"
            />
            <DiffGroup
              label={translate(language, 'preservedCompleted')}
              items={preserved}
              labels={stepLabels}
              tone="saved"
            />
            {added.length + deactivated.length + deadlines.length + preserved.length === 0 && (
              <p>{translate(language, 'noRouteChanges')}</p>
            )}
          </div>
          <button className="primary-button wide" type="button" onClick={onClose}>
            {translate(language, 'done')}
          </button>
        </div>
      )}
    </Modal>
  );
}

function ArrivalModal({
  language,
  route,
  onClose,
  onApplied,
}: {
  language: Language;
  route: Route;
  onClose: () => void;
  onApplied: (route: Route, arrivalDate: string) => void;
}) {
  const today = dateInputValue(new Date());
  const [arrivalDate, setArrivalDate] = useState(today);
  const [phase, setPhase] = useState<'select' | 'review' | 'result'>('select');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [diff, setDiff] = useState<RouteDiff | null>(null);
  const [stepLabels, setStepLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(route.steps.map((step) => [step.code, step.title])),
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryAction, setRetryAction] = useState<'create' | 'confirm' | 'cancel-edit' | 'cancel-close'>('create');

  async function createCandidate() {
    setBusy(true);
    setFailed(false);
    setRetryAction('create');
    try {
      const response = await api.createArrivalCandidate(arrivalDate);
      setCandidate(response.candidate);
      setPhase('review');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function cancelCandidate(close: boolean) {
    if (!candidate) {
      if (close) onClose();
      return;
    }
    setBusy(true);
    setFailed(false);
    setRetryAction(close ? 'cancel-close' : 'cancel-edit');
    try {
      await api.cancelCandidate(candidate.id);
      setCandidate(null);
      if (close) onClose();
      else setPhase('select');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCandidate() {
    if (!candidate) return;
    setBusy(true);
    setFailed(false);
    setRetryAction('confirm');
    try {
      const response = await api.confirmCandidate(candidate.id);
      setStepLabels((labels) => ({
        ...labels,
        ...Object.fromEntries(response.route.steps.map((step) => [step.code, step.title])),
      }));
      setDiff(response.diff);
      onApplied(response.route, arrivalDate);
      setPhase('result');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const added = diff ? diffList(diff, ['added', 'addedSteps', 'added_steps']) : [];
  const deactivated = diff ? diffList(diff, ['deactivated', 'deactivatedSteps', 'removed', 'removedSteps']) : [];
  const deadlines = diff
    ? diffList(diff, ['changedDeadlines', 'deadlineChanged', 'changed_deadlines', 'deadlineChanges'])
    : [];
  const preserved = diff
    ? diffList(diff, ['preservedCompleted', 'preserved_completed', 'preservedCompletedSteps'])
    : [];

  function retry() {
    if (retryAction === 'create') void createCandidate();
    else if (retryAction === 'confirm') void confirmCandidate();
    else void cancelCandidate(retryAction === 'cancel-close');
  }

  return (
    <Modal
      title={translate(language, 'confirmArrival')}
      closeLabel={translate(language, 'close')}
      onClose={() => {
        if (busy) return;
        if (phase === 'result') onClose();
        else void cancelCandidate(true);
      }}
    >
      {phase === 'select' && (
        <div className="flow-panel">
          <p className="lead">{translate(language, 'arrivalChangeHint')}</p>
          <label className="field-label" htmlFor="actual-arrival-date">
            {translate(language, 'actualArrivalDate')}
          </label>
          <input
            id="actual-arrival-date"
            type="date"
            required
            max={today}
            value={arrivalDate}
            onChange={(event) => setArrivalDate(event.target.value)}
          />
          {failed && <InlineError language={language} retry={retry} />}
          <div className="button-row">
            <button
              className="primary-button"
              type="button"
              disabled={busy || !arrivalDate || arrivalDate > today}
              onClick={() => void createCandidate()}
            >
              {busy ? <Spinner /> : null}
              {translate(language, 'continue')}
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>
              {translate(language, 'cancel')}
            </button>
          </div>
        </div>
      )}
      {phase === 'review' && candidate && (
        <div className="flow-panel">
          <div className="review-symbol" aria-hidden="true">
            <Icon name="warning" />
          </div>
          <h1>{translate(language, 'reviewArrival')}</h1>
          <p>{translate(language, 'reviewArrivalHint')}</p>
          <div className="candidate-card">
            <span>{translate(language, 'actualArrivalDate')}</span>
            <strong>{formatDate(arrivalDate, language)}</strong>
          </div>
          {failed && <InlineError language={language} retry={retry} />}
          <div className="button-row stacked-mobile">
            <button className="primary-button" type="button" disabled={busy} onClick={() => void confirmCandidate()}>
              {busy ? <Spinner /> : null}
              {translate(language, 'confirm')}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void cancelCandidate(false)}
            >
              {translate(language, 'edit')}
            </button>
            <button
              className="text-button danger"
              type="button"
              disabled={busy}
              onClick={() => void cancelCandidate(true)}
            >
              {translate(language, 'cancel')}
            </button>
          </div>
        </div>
      )}
      {phase === 'result' && diff && (
        <div className="flow-panel result-panel">
          <span className="success-icon">
            <Icon name="check" />
          </span>
          <h1>{translate(language, 'arrivalRecorded')}</h1>
          <p>{translate(language, 'routeUpdatedHint')}</p>
          <div className="diff-list">
            <DiffGroup label={translate(language, 'added')} items={added} labels={stepLabels} tone="added" />
            <DiffGroup
              label={translate(language, 'deactivated')}
              items={deactivated}
              labels={stepLabels}
              tone="removed"
            />
            <DiffGroup
              label={translate(language, 'changedDeadlines')}
              items={deadlines}
              labels={stepLabels}
              tone="changed"
            />
            <DiffGroup
              label={translate(language, 'preservedCompleted')}
              items={preserved}
              labels={stepLabels}
              tone="saved"
            />
            {added.length + deactivated.length + deadlines.length + preserved.length === 0 && (
              <p>{translate(language, 'noRouteChanges')}</p>
            )}
          </div>
          <button className="primary-button wide" type="button" onClick={onClose}>
            {translate(language, 'done')}
          </button>
        </div>
      )}
    </Modal>
  );
}

function DiffGroup({
  label,
  items,
  labels,
  tone,
}: {
  label: string;
  items: Array<string | Pick<RouteStep, 'code' | 'title'>>;
  labels: Readonly<Record<string, string>>;
  tone: string;
}) {
  if (items.length === 0) return null;
  return (
    <section className={`diff-group ${tone}`}>
      <h2>
        {label} <span>{items.length}</span>
      </h2>
      <ul>
        {items.map((item, index) => (
          <li key={`${diffItemLabel(item, labels)}-${index}`}>{diffItemLabel(item, labels)}</li>
        ))}
      </ul>
    </section>
  );
}

function KnowledgeView({ language, contact }: { language: Language; contact: string | null }) {
  const [question, setQuestion] = useState('');
  const [askedQuestion, setAskedQuestion] = useState('');
  const [answer, setAnswer] = useState<GroundedAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  async function runQuestion(value: string) {
    const prompt = value.trim();
    if (!prompt) return;
    setAskedQuestion(prompt);
    setQuestion('');
    setAnswer(null);
    setLoading(true);
    setFailed(false);
    setFeedbackSent(false);
    try {
      const response = await api.knowledgeQuery(prompt, answer?.answer ?? answer?.text ?? undefined);
      setAnswer(response.answer);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    await runQuestion(question);
  }

  async function feedback(type: 'HELPFUL' | 'NOT_FOUND' | 'OUTDATED') {
    if (!answer || feedbackSent) return;
    try {
      await api.feedback(answer.queryId ?? answer.id, type);
      setFeedbackSent(true);
    } catch {
      setFailed(true);
    }
  }

  const answerText = answer?.text ?? answer?.answer;
  const notFound = answer && (!answerText || answer.status === 'not_found' || answer.status === 'fallback');
  const fallbackContact = answer?.contact ?? contact;

  return (
    <section className="knowledge-view">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{translate(language, 'ask')}</span>
          <h1>{translate(language, 'askTitle')}</h1>
        </div>
        <span className="page-heading-icon" aria-hidden="true">
          <Icon name="ask" weight="duotone" />
        </span>
      </div>
      <p className="assistant-intro">{translate(language, 'assistantWelcome')}</p>
      {askedQuestion && (
        <div className="user-message" aria-label={translate(language, 'questionLabel')}>
          {askedQuestion}
        </div>
      )}
      {failed && <InlineError language={language} retry={() => void runQuestion(askedQuestion)} />}

      {answer && (
        <article className={`answer-card ${notFound ? 'not-found' : ''}`} aria-live="polite">
          <span className="answer-icon" aria-hidden="true">
            <Icon name={notFound ? 'warning' : 'check'} weight="bold" />
          </span>
          <h2>
            {answer.status === 'product_help'
              ? translate(language, 'assistantInfo')
              : answer.status === 'off_topic'
                ? translate(language, 'ask')
                : answer.status === 'general'
                  ? translate(language, 'generalGuidance')
                  : notFound
                    ? translate(language, 'answerNotFound')
                    : translate(language, 'answer')}
          </h2>
          {answerText && <p className="answer-text">{answerText}</p>}
          {answer.nextAction && (
            <div className="answer-next">
              <small>{translate(language, 'nextPracticalStep')}</small>
              <p>{answer.nextAction}</p>
            </div>
          )}
          {answer.sources && answer.sources.length > 0 && (
            <section className="answer-sources">
              <h3>{translate(language, 'sources')}</h3>
              {answer.sources.map((source) =>
                safeExternalUrl(source.url) ? (
                  <a
                    key={source.url}
                    href={safeExternalUrl(source.url) ?? undefined}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                      if (openMaxExternalLink(source.url)) event.preventDefault();
                    }}
                  >
                    <span>
                      <strong>{source.title}</strong>
                      {source.authority && <small>{source.authority}</small>}
                    </span>
                    <Icon name="external" />
                  </a>
                ) : null,
              )}
            </section>
          )}
          {answer.validAsOf && (
            <p className="valid-date">
              {translate(language, 'checkedOn', { date: formatDate(answer.validAsOf, language) ?? answer.validAsOf })}
            </p>
          )}
          {answer.status !== 'product_help' &&
            answer.status !== 'general' &&
            answer.status !== 'off_topic' &&
            (notFound || fallbackContact) && (
              <aside className="contact-fallback">
                <h3>{translate(language, 'contactHuman')}</h3>
                <p>{fallbackContact || translate(language, 'contactHumanHint')}</p>
              </aside>
            )}
          <div className="feedback-box">
            {feedbackSent ? (
              <p className="success-message">
                <Icon name="check" />
                {translate(language, 'feedbackThanks')}
              </p>
            ) : (
              <>
                <p>{translate(language, 'wasHelpful')}</p>
                <div className="feedback-buttons">
                  <button type="button" onClick={() => void feedback('HELPFUL')}>
                    {translate(language, 'helpful')}
                  </button>
                  <button type="button" onClick={() => void feedback('NOT_FOUND')}>
                    {translate(language, 'notFoundFeedback')}
                  </button>
                  <button type="button" onClick={() => void feedback('OUTDATED')}>
                    {translate(language, 'outdated')}
                  </button>
                </div>
              </>
            )}
          </div>
        </article>
      )}

      <div className="quick-actions" aria-label={translate(language, 'quickQuestions')}>
        {(['quickNow', 'quickDocuments', 'quickDeadline'] as const).map((key) => (
          <button key={key} type="button" disabled={loading} onClick={() => void runQuestion(translate(language, key))}>
            {translate(language, key)}
          </button>
        ))}
      </div>
      <form className="question-form" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="knowledge-question">
          {translate(language, 'questionLabel')}
        </label>
        <textarea
          id="knowledge-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={translate(language, 'questionPlaceholder')}
          rows={2}
          maxLength={1000}
        />
        <div className="form-footer">
          <span>{question.length}/1000</span>
          <button className="primary-button" type="submit" disabled={loading || !question.trim()}>
            {loading ? (
              <>
                <Spinner />
                {translate(language, 'searching')}
              </>
            ) : (
              translate(language, 'sendQuestion')
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
  textarea.remove();
  return copied;
}

function ProfileView({
  language,
  profile,
  route,
  onLanguage,
  onReminders,
  onSituation,
  onArrival,
  onOpenStep,
  onEditProfile,
  initialScreen = 'profile',
}: {
  language: Language;
  profile: Profile;
  route: Route | null;
  onLanguage: (language: Language) => Promise<void>;
  onReminders: (enabled: boolean) => Promise<void>;
  onSituation: () => void;
  onArrival: () => void;
  onOpenStep: (step: RouteStep) => void;
  onEditProfile: () => void;
  initialScreen?: 'profile' | 'reminders';
}) {
  const [screen, setScreen] = useState<'profile' | 'reminders' | 'settings'>(initialScreen);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [savingReminder, setSavingReminder] = useState(false);
  const scheduled = useScheduledReminders(profile.remindersEnabled);
  const [failed, setFailed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const shareText = route
    ? `${translate(language, 'appName')}: ${translate(language, 'completedOf', { completed: route.progress.completed, total: route.progress.total })}.${route.nextAction ? ` ${translate(language, 'nextAction')}: ${route.nextAction.title}.` : ''}`
    : translate(language, 'appName');
  const shareUrl = `https://max.ru/:share?text=${encodeURIComponent(shareText)}`;

  async function changeLanguage(next: Language) {
    if (next === language) return;
    setSavingLanguage(true);
    setFailed(false);
    try {
      await onLanguage(next);
    } catch {
      setFailed(true);
    } finally {
      setSavingLanguage(false);
    }
  }

  async function changeReminders() {
    setSavingReminder(true);
    setFailed(false);
    try {
      await onReminders(!profile.remindersEnabled);
    } catch {
      setFailed(true);
    } finally {
      setSavingReminder(false);
    }
  }

  async function copy() {
    setCopyState('idle');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(shareText);
      else if (!fallbackCopy(shareText)) throw new Error('Clipboard is unavailable');
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  const deadlineSteps = (route?.steps ?? [])
    .filter((step) => step.isActive && step.status !== 'COMPLETED')
    .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'));

  if (screen === 'reminders') {
    return (
      <section className="settings-view subpage-view">
        <button className="back-link" type="button" onClick={() => setScreen('profile')}>
          <Icon name="back" />
          {translate(language, 'profile')}
        </button>
        <div className="page-heading">
          <div>
            <span className="eyebrow">{translate(language, 'profile')}</span>
            <h1>{translate(language, 'reminders')}</h1>
          </div>
          <span className="page-heading-icon" aria-hidden="true">
            <Icon name="bell" weight="duotone" />
          </span>
        </div>
        {failed && <InlineError language={language} />}
        <section className="reminder-control-row">
          <div>
            <h2>{translate(language, 'deadlineNotifications')}</h2>
            <p>{translate(language, 'remindersDescription')}</p>
          </div>
          <button
            className={`toggle-button ${profile.remindersEnabled ? 'on' : ''}`}
            type="button"
            role="switch"
            aria-checked={profile.remindersEnabled}
            aria-label={translate(language, 'reminders')}
            disabled={savingReminder}
            onClick={() => void changeReminders()}
          >
            <span />
          </button>
        </section>
        <p className="microcopy">{translate(language, 'reminderLocalTime')}</p>
        {scheduled.failed && <InlineError language={language} retry={() => void scheduled.reload()} />}
        <div className="deadline-list">
          {deadlineSteps.length ? (
            deadlineSteps.map((step) => (
              <article className="reminder-step" key={step.code}>
                <button type="button" className="text-button" onClick={() => onOpenStep(step)}>
                  {step.title} <Icon name="arrow" />
                </button>
                <ReminderEditor
                  language={language}
                  step={step}
                  enabled={profile.remindersEnabled}
                  reminders={scheduled.items}
                  onSaved={scheduled.reload}
                  disabled={scheduled.loading || scheduled.failed || savingReminder}
                />
              </article>
            ))
          ) : (
            <p className="empty-inline">{translate(language, 'noUpcomingDeadlines')}</p>
          )}
        </div>
      </section>
    );
  }

  if (screen === 'settings') {
    return (
      <section className="settings-view subpage-view">
        <button className="back-link" type="button" onClick={() => setScreen('profile')}>
          <Icon name="back" />
          {translate(language, 'profile')}
        </button>
        <div className="page-heading">
          <div>
            <span className="eyebrow">{translate(language, 'appName')}</span>
            <h1>{translate(language, 'settingsTitle')}</h1>
          </div>
          <span className="page-heading-icon" aria-hidden="true">
            <Icon name="settings" weight="duotone" />
          </span>
        </div>
        {failed && <InlineError language={language} />}
        <section className="settings-section">
          <div className="setting-row">
            <span className="setting-icon">
              <Icon name="language" />
            </span>
            <div className="settings-copy">
              <h2>{translate(language, 'language')}</h2>
            </div>
            <select
              className="language-select"
              aria-label={translate(language, 'language')}
              value={language}
              disabled={savingLanguage}
              onChange={(event) => {
                if (isLanguage(event.target.value)) void changeLanguage(event.target.value);
              }}
            >
              {languageOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button className="setting-row setting-link" type="button" onClick={onSituation}>
            <span className="setting-icon">
              <Icon name="situation" />
            </span>
            <span className="settings-copy">
              <strong>{translate(language, 'situationChanged')}</strong>
              <small>{profileHousingLabel(language, profile)}</small>
            </span>
            <Icon name="arrow" />
          </button>
          {profile.arrivalStatus === 'preparing' && (
            <button className="setting-row setting-link" type="button" onClick={onArrival}>
              <span className="setting-icon">
                <Icon name="location" />
              </span>
              <span className="settings-copy">
                <strong>{translate(language, 'confirmArrival')}</strong>
                <small>{translate(language, 'arrivalChangeHint')}</small>
              </span>
              <Icon name="arrow" />
            </button>
          )}
        </section>
        <section className="settings-section share-card">
          <div className="section-heading">
            <h2>{translate(language, 'share')}</h2>
            <Icon name="share" />
          </div>
          <p>{translate(language, 'shareHint')}</p>
          <div className="button-row">
            <a className="primary-button" href={shareUrl} target="_blank" rel="noreferrer">
              {translate(language, 'shareInMax')}
              <Icon name="external" />
            </a>
            <button className="secondary-button" type="button" onClick={() => void copy()}>
              {copyState === 'copied' ? translate(language, 'copied') : translate(language, 'copy')}
            </button>
          </div>
          {copyState === 'failed' && (
            <>
              <p className="copy-error" role="alert">
                {translate(language, 'copyFailed')}
              </p>
              <textarea
                className="share-fallback"
                readOnly
                value={shareText}
                aria-label={translate(language, 'share')}
              />
            </>
          )}
        </section>
      </section>
    );
  }

  return (
    <section className="profile-view">
      <div className="profile-heading">
        <span className="profile-avatar" aria-hidden="true">
          <UserCircleIcon weight="duotone" />
        </span>
        <span className="eyebrow">{translate(language, 'pilot')}</span>
        <h1>{translate(language, 'profileTitle')}</h1>
        <p>{translate(language, 'profileSubtitle')}</p>
      </div>
      {route && <ProgressCard language={language} route={route} />}
      <dl className="profile-facts">
        <div>
          <dt>
            <Icon name="university" />
            {translate(language, 'university')}
          </dt>
          <dd>{route?.university ?? profile.universityCode}</dd>
        </div>
        {profile.countryOrRegion && (
          <div>
            <dt>{translate(language, 'citizenshipCountry')}</dt>
            <dd>
              {countryCodeFromInput(profile.countryOrRegion)
                ? countryName(countryCodeFromInput(profile.countryOrRegion)!, language)
                : profile.countryOrRegion}
            </dd>
          </div>
        )}
        {typeof profile.attributes?.specialStatus === 'string' && (
          <div>
            <dt>{translate(language, 'residenceStatus')}</dt>
            <dd>
              {profile.attributes.specialStatus === 'none'
                ? translate(language, 'residenceNone')
                : profile.attributes.specialStatus === 'unknown'
                  ? translate(language, 'residenceUnknown')
                  : profile.attributes.specialStatus.toUpperCase()}
            </dd>
          </div>
        )}
        <div>
          <dt>
            <Icon name="location" />
            {translate(language, 'arrivalStatus')}
          </dt>
          <dd>{translate(language, profile.arrivalStatus)}</dd>
        </div>
        {profile.attributes?.citizenshipType === 'foreign' && profile.attributes.studyArrival && (
          <div>
            <dt>{translate(language, 'studyArrival')}</dt>
            <dd>
              {translate(
                language,
                profile.attributes.studyArrival === 'yes'
                  ? 'studyArrivalYes'
                  : profile.attributes.studyArrival === 'no'
                    ? 'studyArrivalNo'
                    : 'residenceUnknown',
              )}
            </dd>
          </div>
        )}
        {profile.attributes?.citizenshipType === 'foreign' && (
          <div>
            <dt>
              <Icon name="location" />
              {translate(language, 'russiaPresence')}
            </dt>
            <dd>
              {profile.attributes.russiaPresence === 'yes'
                ? translate(language, 'russiaYes')
                : profile.attributes.russiaPresence === 'no'
                  ? translate(language, 'russiaNo')
                  : translate(language, 'unknown')}
            </dd>
          </div>
        )}
        {profile.arrivalDate && (
          <div>
            <dt>
              <Icon name="calendar" />
              {translate(language, 'arrivalDate')}
            </dt>
            <dd>{formatDate(profile.arrivalDate, language)}</dd>
          </div>
        )}
        {typeof profile.attributes?.russiaEntryDate === 'string' && profile.attributes.russiaEntryDate && (
          <div>
            <dt>
              <Icon name="calendar" />
              {translate(language, 'lastEntryDate')}
            </dt>
            <dd>{formatDate(profile.attributes.russiaEntryDate, language)}</dd>
          </div>
        )}
        <div>
          <dt>
            <Icon name="luggage" />
            {translate(language, 'housing')}
          </dt>
          <dd>{profileHousingLabel(language, profile)}</dd>
        </div>
      </dl>
      {profile.attributes?.journeyVersion !== 'city_v1' &&
        typeof profile.attributes?.legacyArrivalDate === 'string' && (
          <div className="microcopy">
            <p>{translate(language, 'legacyDateHint')}</p>
            <p>
              {translate(language, 'legacyDateLabel')}: {formatDate(profile.attributes.legacyArrivalDate, language)}
            </p>
          </div>
        )}
      <div className="profile-actions">
        <button type="button" onClick={onEditProfile}>
          <span className="setting-icon">
            <Icon name="university" />
          </span>
          <span>
            <strong>{translate(language, 'editProfile')}</strong>
            <small>{translate(language, 'editProfileHint')}</small>
          </span>
          <Icon name="arrow" />
        </button>
        <button type="button" onClick={() => setScreen('reminders')}>
          <span className="setting-icon">
            <Icon name="bell" />
          </span>
          <span>
            <strong>{translate(language, 'reminders')}</strong>
            <small>
              {profile.remindersEnabled ? translate(language, 'remindersOn') : translate(language, 'remindersOff')}
            </small>
          </span>
          <Icon name="arrow" />
        </button>
        <button type="button" onClick={() => setScreen('settings')}>
          <span className="setting-icon">
            <Icon name="settings" />
          </span>
          <span>
            <strong>{translate(language, 'settingsTitle')}</strong>
            <small>{translate(language, 'settingsHint')}</small>
          </span>
          <Icon name="arrow" />
        </button>
      </div>
      <aside className="disclaimer">
        <Icon name="info" />
        <p>{translate(language, 'disclaimer')}</p>
      </aside>
    </section>
  );
}

export function App() {
  const [language, setLanguage] = useState<Language>('ru');
  const [bootState, setBootState] = useState<BootState>('loading');
  const [bootError, setBootError] = useState<ErrorInfo>({ kind: 'load' });
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileEdit, setProfileEdit] = useState(false);
  const [justCreatedPlan, setJustCreatedPlan] = useState(false);
  const [openProfileReminders, setOpenProfileReminders] = useState(false);
  const [route, setRoute] = useState<Route | null>(null);
  const [view, setView] = useState<View>('today');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [highlightedCode] = useState(() => getStartPayload());
  const [situationOpen, setSituationOpen] = useState(false);
  const [arrivalOpen, setArrivalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [routeError, setRouteError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const mounted = useRef(true);

  const bootstrap = useCallback(async () => {
    setBootState('loading');
    clearSession();
    let auth: Awaited<ReturnType<typeof authenticate>>;
    try {
      auth = await authenticate();
    } catch (error) {
      if (!mounted.current) return;
      setBootError(errorInfo(error, 'auth'));
      setBootState('error');
      return;
    }
    if (!mounted.current) return;
    setUser(auth.user);
    const authLanguage = isLanguage(auth.user.preferredLanguage) ? auth.user.preferredLanguage : 'ru';
    setLanguage(authLanguage);

    let profileResponse: Awaited<ReturnType<typeof api.profile>>;
    try {
      profileResponse = await api.profile();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        if (mounted.current) setBootState('onboarding');
        return;
      }
      if (!mounted.current) return;
      setBootError(errorInfo(error));
      setBootState('error');
      return;
    }
    if (!mounted.current) return;
    setUser(profileResponse.user);
    const preferredLanguage = isLanguage(profileResponse.user.preferredLanguage)
      ? profileResponse.user.preferredLanguage
      : authLanguage;
    setLanguage(preferredLanguage);
    if (!profileResponse.profile) {
      setBootState('onboarding');
      return;
    }
    setProfile(profileResponse.profile);

    try {
      const response = await api.route();
      if (mounted.current) setRoute(response.route);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        if (mounted.current) setRoute(null);
      } else {
        if (!mounted.current) return;
        setBootError(errorInfo(error));
        setBootState('error');
        return;
      }
    }
    if (mounted.current) setBootState('ready');
  }, []);

  useEffect(() => {
    mounted.current = true;
    void bootstrap();
    return () => {
      mounted.current = false;
    };
  }, [bootstrap]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = translate(language, 'appName');
  }, [language]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [view, bootState]);

  useEffect(() => {
    if (bootState !== 'ready' || !highlightedCode || !route?.steps.some((step) => step.code === highlightedCode))
      return;
    setView('route');
    const timer = window.setTimeout(() => {
      const element = document.getElementById(`step-${highlightedCode}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element?.focus();
    }, 100);
    return () => window.clearTimeout(timer);
  }, [bootState, highlightedCode, route]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedStep =
    selectedCode && route
      ? ([...route.steps, ...(route.possibleSteps ?? [])].find((step) => step.code === selectedCode) ?? null)
      : null;
  const contact = route?.steps.find((step) => step.contact)?.contact ?? null;

  async function refreshRoute() {
    setRefreshing(true);
    setRouteError(false);
    try {
      const response = await api.route();
      setRoute(response.route);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setRoute(null);
      else setRouteError(true);
    } finally {
      setRefreshing(false);
    }
  }

  async function completeStep(code: string) {
    const response = await api.completeStep(code);
    setRoute(response.route);
    setToast(translate(language, 'completed'));
  }

  async function updateLanguage(next: Language) {
    await api.updateLanguage(next);
    setLanguage(next);
    setUser((current) => (current ? { ...current, preferredLanguage: next } : current));
    try {
      const response = await api.route();
      setRoute(response.route);
      setRouteError(false);
    } catch {
      setRouteError(true);
    }
  }

  async function updateReminders(enabled: boolean) {
    if (enabled) await api.remindersOptIn();
    else await api.remindersOptOut();
    setProfile((current) => (current ? { ...current, remindersEnabled: enabled } : current));
  }

  if (bootState === 'loading') return <LoadingScreen language={language} />;
  if (bootState === 'error')
    return <ErrorScreen language={language} error={bootError} onRetry={() => void bootstrap()} />;
  if (bootState === 'onboarding') {
    return (
      <Onboarding
        initialLanguage={language}
        onComplete={(input, nextRoute) => {
          setLanguage(input.preferredLanguage);
          setUser((current) => (current ? { ...current, preferredLanguage: input.preferredLanguage } : current));
          setProfile({
            universityCode: input.universityCode,
            countryOrRegion: input.citizenshipCountry,
            arrivalStatus: input.arrivalStatus,
            arrivalDate: input.arrivalDate,
            accommodationType: input.accommodationType,
            remindersEnabled: false,
            attributes: {
              universityName: input.universityName ?? null,
              citizenshipType: input.citizenshipType ?? 'unknown',
              entryMode: input.entryMode ?? 'unknown',
              journeyVersion: 'city_v1',
              russiaPresence: input.russiaPresence ?? 'unknown',
              studyArrival: input.studyArrival ?? 'unknown',
              russiaEntryDate: input.russiaEntryDate ?? null,
              programLevel: input.programLevel ?? 'unknown',
              campusCode: input.campusCode ?? null,
              facultyCode: input.facultyCode ?? null,
              mobilityStatus: input.mobilityStatus ?? 'unknown',
              housingStatus: input.housingStatus ?? 'unknown',
              militaryStatus: input.militaryStatus ?? 'unknown',
              enrollmentState: input.enrollmentState ?? 'admitted',
              admissionYear: input.admissionYear ?? null,
            },
          });
          setRoute(nextRoute);
          setJustCreatedPlan(true);
          setBootState('ready');
        }}
      />
    );
  }

  if (profileEdit && profile && user) {
    return (
      <Onboarding
        initialLanguage={language}
        existingProfile={profile}
        onCancel={() => setProfileEdit(false)}
        onComplete={(input, nextRoute) => {
          setLanguage(input.preferredLanguage);
          setUser((current) => (current ? { ...current, preferredLanguage: input.preferredLanguage } : current));
          setProfile({
            ...profile,
            universityCode: input.universityCode,
            countryOrRegion: input.citizenshipCountry,
            arrivalStatus: input.arrivalStatus,
            arrivalDate: input.arrivalDate,
            accommodationType: input.accommodationType,
            attributes: {
              ...profile.attributes,
              universityName: input.universityName ?? null,
              citizenshipType: input.citizenshipType ?? 'unknown',
              entryMode: input.entryMode ?? 'unknown',
              journeyVersion: 'city_v1',
              russiaPresence: input.russiaPresence ?? 'unknown',
              studyArrival: input.studyArrival ?? 'unknown',
              russiaEntryDate: input.russiaEntryDate ?? null,
              programLevel: input.programLevel ?? 'unknown',
              campusCode: input.campusCode ?? null,
              facultyCode: input.facultyCode ?? null,
              mobilityStatus: input.mobilityStatus ?? 'unknown',
              housingStatus: input.housingStatus ?? 'unknown',
              militaryStatus: input.militaryStatus ?? 'unknown',
              enrollmentState: input.enrollmentState ?? 'admitted',
              admissionYear: input.admissionYear ?? null,
            },
          });
          setRoute(nextRoute);
          setProfileEdit(false);
          setView('today');
        }}
      />
    );
  }

  if (!profile || !user)
    return (
      <ErrorScreen
        language={language}
        error={{ kind: 'load', code: 'INVALID_PROFILE' }}
        onRetry={() => void bootstrap()}
      />
    );

  return (
    <div className="app-shell">
      <Header language={language} onLanguage={updateLanguage} />
      <Navigation
        language={language}
        view={view}
        onChange={(next) => {
          setOpenProfileReminders(false);
          setView(next);
        }}
      />
      <main className="app-content" aria-busy={refreshing}>
        {routeError && <InlineError language={language} retry={() => void refreshRoute()} />}
        {view === 'today' && (
          <TodayView
            language={language}
            route={route}
            onOpenStep={(step) => setSelectedCode(step.code)}
            onOpenRoute={() => setView('route')}
            onSituation={() => setSituationOpen(true)}
            onArrival={() => setArrivalOpen(true)}
            canConfirmArrival={profile.arrivalStatus === 'preparing'}
            onRefresh={() => void refreshRoute()}
            onAsk={() => setView('ask')}
            showReminderOffer={justCreatedPlan && !profile.remindersEnabled}
            onReminderOffer={() => {
              setOpenProfileReminders(true);
              setJustCreatedPlan(false);
              setView('profile');
            }}
          />
        )}
        {view === 'route' && (
          <RouteView
            language={language}
            route={route}
            highlightedCode={highlightedCode}
            onOpenStep={(step) => setSelectedCode(step.code)}
            onRefresh={() => void refreshRoute()}
            onAsk={() => setView('ask')}
          />
        )}
        {view === 'ask' && <KnowledgeView language={language} contact={contact} />}
        {view === 'profile' && (
          <ProfileView
            initialScreen={openProfileReminders ? 'reminders' : 'profile'}
            language={language}
            profile={profile}
            route={route}
            onLanguage={updateLanguage}
            onReminders={updateReminders}
            onSituation={() => setSituationOpen(true)}
            onArrival={() => setArrivalOpen(true)}
            onOpenStep={(step) => setSelectedCode(step.code)}
            onEditProfile={() => setProfileEdit(true)}
          />
        )}
      </main>

      {selectedStep && (
        <StepDetail
          language={language}
          step={selectedStep}
          remindersEnabled={profile.remindersEnabled}
          onClose={() => setSelectedCode(null)}
          onComplete={completeStep}
          onStart={async (code) => {
            setRoute((await api.startStep(code)).route);
          }}
          onContextSaved={setRoute}
        />
      )}
      {situationOpen && route && (
        <SituationModal
          language={language}
          current={profile.accommodationType}
          route={route}
          onClose={() => setSituationOpen(false)}
          onApplied={(nextRoute, nextAccommodation) => {
            setRoute(nextRoute);
            setProfile((current) => (current ? { ...current, accommodationType: nextAccommodation } : current));
          }}
        />
      )}
      {arrivalOpen && route && (
        <ArrivalModal
          language={language}
          route={route}
          onClose={() => setArrivalOpen(false)}
          onApplied={(nextRoute, arrivalDate) => {
            setRoute(nextRoute);
            setProfile((current) => (current ? { ...current, arrivalStatus: 'arrived', arrivalDate } : current));
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
