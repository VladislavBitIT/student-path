import type { KnowledgeDocument, Source, StepDefinition, UniversityConfig } from '../../domain/src/index.js';
import {
  universityActionKnowledgeDocuments,
  universityActionSources,
  universityActionSteps,
} from './university-actions.js';

export const DIRECTORY_CHECKED_AT = '2026-09-24';

export interface DirectoryUniversity {
  code: string;
  nameRu: string;
  nameEn: string;
  cityRu: string;
  timezone: string;
  campuses: readonly { code: string; nameRu: string; nameEn: string }[];
  generalUrl: string;
  guidanceUrl: string;
  guidanceCitizenship: 'foreign' | 'all';
  housingUrl: string | null;
  housingCitizenship: 'foreign' | 'rf' | 'all';
  housingYear: number | null;
  /** The housing page applies only to this campus. Other campuses get a neutral instruction. */
  housingCampus: string | null;
  guidanceRu: string;
  guidanceEn: string;
  partnerStatus: 'directory_public';
}

/** Open-source directory, not a list of university partners or admission guarantees. */
export const universityDirectory: readonly DirectoryUniversity[] = [
  {
    code: 'MSU',
    nameRu: 'МГУ имени М. В. Ломоносова',
    nameEn: 'Lomonosov Moscow State University',
    cityRu: 'Москва',
    timezone: 'Europe/Moscow',
    campuses: [{ code: 'main', nameRu: 'Москва', nameEn: 'Moscow' }],
    generalUrl: 'https://msu.ru/',
    guidanceUrl: 'https://international.msu.ru/after',
    guidanceCitizenship: 'foreign',
    housingUrl: 'https://international.msu.ru/arrival-en',
    housingCitizenship: 'foreign',
    housingYear: null,
    housingCampus: 'main',
    guidanceRu:
      'Для иностранного студента МГУ порядок после приезда зависит от факультета и фактического адреса проживания. Свяжитесь с международным отделом своего факультета.',
    guidanceEn:
      'At MSU, post-arrival instructions for an international student depend on their faculty and actual address. Contact the international office of your faculty.',
    partnerStatus: 'directory_public',
  },
  {
    code: 'MEPHI',
    nameRu: 'НИЯУ МИФИ',
    nameEn: 'National Research Nuclear University MEPhI',
    cityRu: 'Москва и филиалы',
    timezone: 'Europe/Moscow',
    campuses: [
      { code: 'main', nameRu: 'Москва', nameEn: 'Moscow' },
      { code: 'other', nameRu: 'Филиал — уточню', nameEn: 'Another branch — to confirm' },
    ],
    generalUrl: 'https://mephi.ru/',
    guidanceUrl: 'https://mephi.ru/foreign-nationals/migration-reg/migr-entr',
    guidanceCitizenship: 'foreign',
    housingUrl: 'https://mephi.ru/node/19028',
    housingCitizenship: 'all',
    housingYear: null,
    housingCampus: 'main',
    guidanceRu:
      'МИФИ публикует отдельные сведения о миграционном учёте и общежитиях. Для филиала уточните местный порядок у университета.',
    guidanceEn:
      'MEPhI publishes separate migration and housing guidance. For a branch campus, confirm local instructions with the university.',
    partnerStatus: 'directory_public',
  },
  {
    code: 'MIPT',
    nameRu: 'МФТИ',
    nameEn: 'Moscow Institute of Physics and Technology',
    cityRu: 'Долгопрудный',
    timezone: 'Europe/Moscow',
    campuses: [{ code: 'main', nameRu: 'Долгопрудный', nameEn: 'Dolgoprudny' }],
    generalUrl: 'https://mipt.ru/',
    guidanceUrl: 'https://pk.mipt.ru/foreign/',
    guidanceCitizenship: 'foreign',
    housingUrl: null,
    housingCitizenship: 'all',
    housingYear: null,
    housingCampus: null,
    guidanceRu:
      'МФТИ описывает действия после зачисления для разных групп иностранных студентов. Применимость зависит от основания обучения и порядка въезда.',
    guidanceEn:
      'MIPT describes post-enrollment actions for different international student groups. Check which entry and study conditions apply to you.',
    partnerStatus: 'directory_public',
  },
  {
    code: 'HSE',
    nameRu: 'НИУ ВШЭ',
    nameEn: 'HSE University',
    cityRu: 'Москва и другие кампусы',
    timezone: 'Europe/Moscow',
    campuses: [
      { code: 'main', nameRu: 'Москва', nameEn: 'Moscow' },
      { code: 'spb', nameRu: 'Санкт-Петербург', nameEn: 'Saint Petersburg' },
      { code: 'nnov', nameRu: 'Нижний Новгород', nameEn: 'Nizhny Novgorod' },
      { code: 'perm', nameRu: 'Пермь', nameEn: 'Perm' },
    ],
    generalUrl: 'https://www.hse.ru/',
    guidanceUrl: 'https://istudents.hse.ru/',
    guidanceCitizenship: 'foreign',
    housingUrl: 'https://www.hse.ru/dormoffice/zaseleniebak2026',
    housingCitizenship: 'rf',
    housingYear: 2026,
    housingCampus: 'main',
    guidanceRu:
      'В ВШЭ инструкции различаются по кампусам и условиям обучения. Сверьте первые действия с поддержкой своего кампуса; порядок заселения Москвы 2026 года не действует автоматически для других случаев.',
    guidanceEn:
      'HSE instructions differ by campus and enrollment conditions. Check first steps with your campus; the 2026 Moscow housing guide does not automatically apply elsewhere.',
    partnerStatus: 'directory_public',
  },
  {
    code: 'NSU',
    nameRu: 'НГУ',
    nameEn: 'Novosibirsk State University',
    cityRu: 'Новосибирск',
    timezone: 'Asia/Novosibirsk',
    campuses: [{ code: 'main', nameRu: 'Новосибирск', nameEn: 'Novosibirsk' }],
    generalUrl: 'https://www.nsu.ru/',
    guidanceUrl: 'https://education.nsu.ru/freshmen',
    guidanceCitizenship: 'all',
    housingUrl: 'https://education.nsu.ru/freshmen',
    housingCitizenship: 'all',
    housingYear: 2026,
    housingCampus: 'main',
    guidanceRu:
      'НГУ публикует памятку первокурсника с разделами о пропуске, личном кабинете и общежитии. Даты заселения на странице относятся к 2026 году; своё место и порядок уточните в деканате.',
    guidanceEn:
      'NSU publishes a first-year guide covering campus access, the student account and housing. Its 2026 move-in dates must not be reused for another year; confirm your place with your faculty.',
    partnerStatus: 'directory_public',
  },
  {
    code: 'SPBU',
    nameRu: 'СПбГУ',
    nameEn: 'Saint Petersburg State University',
    cityRu: 'Санкт-Петербург и Петергоф',
    timezone: 'Europe/Moscow',
    campuses: [
      { code: 'main', nameRu: 'Санкт-Петербург', nameEn: 'Saint Petersburg' },
      { code: 'peterhof', nameRu: 'Петергоф', nameEn: 'Peterhof' },
    ],
    generalUrl: 'https://spbu.ru/',
    guidanceUrl: 'https://guide.spbu.ru/foreigner',
    guidanceCitizenship: 'foreign',
    housingUrl: 'https://guide.spbu.ru/dormitory',
    housingCitizenship: 'all',
    housingYear: null,
    housingCampus: null,
    guidanceRu:
      'СПбГУ разделяет порядок после приезда по типу жилья; распределение по общежитиям публикуется отдельно. Проверьте свою программу и фактический адрес.',
    guidanceEn:
      'SPbU separates post-arrival procedures by housing type; dormitory assignments are published separately. Check your programme and actual address.',
    partnerStatus: 'directory_public',
  },
  {
    code: 'TSU',
    nameRu: 'ТГУ',
    nameEn: 'Tomsk State University',
    cityRu: 'Томск',
    timezone: 'Asia/Tomsk',
    campuses: [{ code: 'main', nameRu: 'Томск', nameEn: 'Tomsk' }],
    generalUrl: 'https://www.tsu.ru/',
    guidanceUrl: 'https://info.abiturient.tsu.ru/ru/content/%D0%BE%D0%B1%D1%89%D0%B5%D0%B6%D0%B8%D1%82%D0%B8%D1%8F',
    guidanceCitizenship: 'all',
    housingUrl: 'https://info.abiturient.tsu.ru/ru/content/%D0%BE%D0%B1%D1%89%D0%B5%D0%B6%D0%B8%D1%82%D0%B8%D1%8F',
    housingCitizenship: 'all',
    housingYear: null,
    housingCampus: 'main',
    guidanceRu:
      'В ТГУ условия заселения различаются по факультету и категории студента. Университетская страница общежитий не подтверждает для вас конкретное место.',
    guidanceEn:
      'TSU housing procedures differ by faculty and student category. The university housing page does not confirm an individual place.',
    partnerStatus: 'directory_public',
  },
  {
    code: 'ITMO',
    nameRu: 'Университет ИТМО',
    nameEn: 'ITMO University',
    cityRu: 'Санкт-Петербург',
    timezone: 'Europe/Moscow',
    campuses: [{ code: 'main', nameRu: 'Санкт-Петербург', nameEn: 'Saint Petersburg' }],
    generalUrl: 'https://itmo.ru/',
    guidanceUrl: 'https://int.itmo.ru/ru/important_documents',
    guidanceCitizenship: 'foreign',
    housingUrl: 'https://student.itmo.ru/en/campus/dorms_and_aparts/booking',
    housingCitizenship: 'foreign',
    housingYear: null,
    housingCampus: 'main',
    guidanceRu:
      'ИТМО публикует памятки о документах и проживании. Уточните, какие инструкции относятся к вашему гражданству, основанию обучения и адресу.',
    guidanceEn:
      'ITMO publishes document and housing guidance. Check which instructions apply to your citizenship, study conditions and address.',
    partnerStatus: 'directory_public',
  },
  {
    code: 'KFU',
    nameRu: 'КФУ',
    nameEn: 'Kazan Federal University',
    cityRu: 'Казань и филиалы',
    timezone: 'Europe/Moscow',
    campuses: [
      { code: 'main', nameRu: 'Казань', nameEn: 'Kazan' },
      { code: 'other', nameRu: 'Филиал — уточню', nameEn: 'Another branch — to confirm' },
    ],
    generalUrl: 'https://kpfu.ru/',
    guidanceUrl: 'https://admissions.kpfu.ru/adaptacziya-inostrannyh-grazhdan/viza-i-migraczionnyj-uchyot/',
    guidanceCitizenship: 'foreign',
    housingUrl: 'https://admissions.kpfu.ru/prozhivanie/zaselenie-inostrannyx-grazhdan/',
    housingCitizenship: 'foreign',
    housingYear: 2026,
    housingCampus: 'main',
    guidanceRu:
      'КФУ публикует отдельные сведения о визе, миграционном учёте и жилье. Списки на общежитие и даты страницы относятся к кампании 2026 года; подтвердите место в личном кабинете или университете.',
    guidanceEn:
      'KFU publishes separate visa, migration and housing information. Housing lists and dates on the cited page belong to 2026; confirm your place through the university.',
    partnerStatus: 'directory_public',
  },
  {
    code: 'RUDN',
    nameRu: 'РУДН',
    nameEn: 'RUDN University',
    cityRu: 'Москва',
    timezone: 'Europe/Moscow',
    campuses: [{ code: 'main', nameRu: 'Москва', nameEn: 'Moscow' }],
    generalUrl: 'https://www.rudn.ru/',
    guidanceUrl: 'https://international.rudn.ru/migration_registration/',
    guidanceCitizenship: 'foreign',
    housingUrl: 'https://international.rudn.ru/undergraduate/obshchezhitie/',
    housingCitizenship: 'foreign',
    housingYear: null,
    housingCampus: 'main',
    guidanceRu:
      'РУДН описывает миграционное сопровождение и отдельную процедуру заселения. Применимость новых московских правил зависит от гражданства, даты въезда и жилья; подтвердите её в университете.',
    guidanceEn:
      'RUDN publishes migration and housing procedures. The applicability of newer Moscow rules depends on citizenship, entry date and housing; confirm with the university.',
    partnerStatus: 'directory_public',
  },
] as const;

export const directoryByCode: Readonly<Record<string, DirectoryUniversity>> = Object.fromEntries(
  universityDirectory.map((entry) => [entry.code, entry]),
);

export const directoryUniversityConfigs: Readonly<Record<string, UniversityConfig>> = Object.fromEntries(
  universityDirectory.map((entry) => [
    entry.code,
    {
      code: entry.code,
      name: entry.nameRu,
      timezone: entry.timezone,
      supportedLanguages: ['ru', 'en'] as const,
      disclaimerKey: 'app.disclaimer',
      officialContact: {
        labelKey: 'contact.university.label',
        instructionKey: 'contact.university.instruction',
        url: entry.generalUrl,
        email: null,
        phone: null,
      },
    },
  ]),
);

const directoryBaseSources: readonly Source[] = universityDirectory.flatMap((entry) => [
  {
    id: `uni_${entry.code.toLowerCase()}_general`,
    title: `${entry.nameRu}: официальный сайт`,
    url: entry.generalUrl,
    authority: entry.nameRu,
    languages: ['ru'] as const,
    validAsOf: DIRECTORY_CHECKED_AT,
    verificationStatus: 'needs_confirmation' as const,
    metadata: {
      sourceCheckedAt: DIRECTORY_CHECKED_AT,
      sourcePublishedAt: null,
      admissionYear: null,
      appliesTo: 'Уточнение порядка после зачисления для своего кампуса; конкретная инструкция не подтверждена',
      appliesToEn: 'Confirm post-enrollment instructions for your campus; detailed guidance is not verified',
      deadlineStatus: 'needs_confirmation' as const,
      partnerStatus: 'directory_public' as const,
    },
  },
  {
    id: `uni_${entry.code.toLowerCase()}_guide`,
    title: `${entry.nameRu}: официальная информация`,
    url: entry.guidanceUrl,
    authority: entry.nameRu,
    languages: entry.guidanceUrl.includes('/en/') ? (['en'] as const) : (['ru'] as const),
    validAsOf: DIRECTORY_CHECKED_AT,
    verificationStatus: 'needs_confirmation' as const,
    metadata: {
      sourceCheckedAt: DIRECTORY_CHECKED_AT,
      sourcePublishedAt: null,
      admissionYear: null,
      appliesTo:
        entry.guidanceCitizenship === 'foreign'
          ? 'Иностранные студенты; остальные случаи требуют отдельной проверки'
          : 'Применимость зависит от программы и кампуса',
      appliesToEn:
        entry.guidanceCitizenship === 'foreign'
          ? 'International students; other cases need separate confirmation'
          : 'Applicability depends on programme and campus',
      deadlineStatus: 'needs_confirmation' as const,
      partnerStatus: 'directory_public' as const,
    },
  },
  ...(entry.housingUrl
    ? [
        {
          id: `uni_${entry.code.toLowerCase()}_housing`,
          title: `${entry.nameRu}: проживание`,
          url: entry.housingUrl,
          authority: entry.nameRu,
          languages: entry.housingUrl.includes('/en/') ? (['en'] as const) : (['ru'] as const),
          validAsOf: DIRECTORY_CHECKED_AT,
          verificationStatus: 'needs_confirmation' as const,
          metadata: {
            sourceCheckedAt: DIRECTORY_CHECKED_AT,
            sourcePublishedAt: null,
            admissionYear: entry.housingYear,
            appliesTo: `Общежитие; ${entry.housingCitizenship === 'all' ? 'гражданство уточняется' : entry.housingCitizenship === 'rf' ? 'граждане России' : 'иностранные студенты'}; кампус ${entry.housingCampus ? (entry.campuses.find((campus) => campus.code === entry.housingCampus)?.nameRu ?? 'уточняется') : 'уточняется'}`,
            appliesToEn: `Dormitory housing; ${entry.housingCitizenship === 'all' ? 'citizenship to confirm' : entry.housingCitizenship === 'rf' ? 'Russian citizens' : 'international students'}; campus ${entry.housingCampus ? (entry.campuses.find((campus) => campus.code === entry.housingCampus)?.nameEn ?? 'to confirm') : 'to confirm'}`,
            deadlineStatus: 'needs_confirmation' as const,
            partnerStatus: 'directory_public' as const,
          },
        },
      ]
    : []),
]);

const commonDefinition = {
  stage: 'first_week' as const,
  whyImportantKey: 'steps.directory.why',
  preparationKeys: [],
  contactKey: 'contact.university.instruction',
  validAsOf: DIRECTORY_CHECKED_AT,
  verificationStatus: 'needs_confirmation' as const,
  prerequisites: [],
  deadlineRule: null,
  deadlineNoteKey: 'deadline.to_be_confirmed',
  attention: 'normal' as const,
};

export const directorySources: readonly Source[] = [...directoryBaseSources, ...universityActionSources];
export const directoryStepDefinitions: readonly StepDefinition[] = [
  ...universityActionSteps,
  ...universityDirectory.map(({ code: universityCode }) => ({
    ...commonDefinition,
    code: 'CHECK_UNIVERSITY_FIRST_STEPS',
    universityCode,
    titleKey: 'steps.directory.first.title',
    descriptionKey: 'steps.directory.first.description',
    sourceId: `uni_${universityCode.toLowerCase()}_general`,
    sortOrder: 900,
    applicability: {},
  })),
  {
    ...commonDefinition,
    code: 'CHECK_UNIVERSITY_FIRST_STEPS',
    universityCode: 'OTHER',
    titleKey: 'steps.directory.first.title',
    descriptionKey: 'steps.directory.first.description',
    sourceId: null,
    sortOrder: 900,
    applicability: {},
  },
];

const directoryBaseKnowledgeDocuments: readonly KnowledgeDocument[] = universityDirectory.flatMap((entry) => [
  {
    id: `kb-${entry.code.toLowerCase()}-general-ru`,
    title: `${entry.nameRu}: уточнение первых действий`,
    content:
      'Проверьте свой статус зачисления, кампус и порядок первых действий на официальном сайте университета. Этот вуз не проверял маршрут «Пути студента»; точные сроки нужно уточнить лично.',
    sourceId: `uni_${entry.code.toLowerCase()}_general`,
    language: 'ru' as const,
    tags: ['университет', 'зачисление', 'кампус'],
    validAsOf: DIRECTORY_CHECKED_AT,
  },
  {
    id: `kb-${entry.code.toLowerCase()}-general-en`,
    title: `${entry.nameEn}: confirm your next steps`,
    content:
      'Check your enrollment status, campus and first steps on the official university site. The university has not reviewed this «Путь студента» route; confirm any dates personally.',
    sourceId: `uni_${entry.code.toLowerCase()}_general`,
    language: 'en' as const,
    tags: ['university', 'enrollment', 'campus'],
    validAsOf: DIRECTORY_CHECKED_AT,
  },
  {
    id: `kb-${entry.code.toLowerCase()}-ru`,
    title: `${entry.nameRu}: первые шаги после зачисления`,
    content: entry.guidanceRu,
    sourceId: `uni_${entry.code.toLowerCase()}_guide`,
    language: 'ru' as const,
    tags: ['зачисление', 'приезд', 'университет', 'общежитие'],
    validAsOf: DIRECTORY_CHECKED_AT,
  },
  {
    id: `kb-${entry.code.toLowerCase()}-en`,
    title: `${entry.nameEn}: first steps after enrollment`,
    content: entry.guidanceEn,
    sourceId: `uni_${entry.code.toLowerCase()}_guide`,
    language: 'en' as const,
    tags: ['enrollment', 'arrival', 'university', 'housing'],
    validAsOf: DIRECTORY_CHECKED_AT,
  },
  ...(entry.housingUrl
    ? [
        {
          id: `kb-${entry.code.toLowerCase()}-housing-ru`,
          title: `${entry.nameRu}: проживание после зачисления`,
          content: `Проверьте статус заявления или назначение места в общежитии на официальной странице ${entry.nameRu}. Подача заявления не гарантирует место. ${entry.housingYear ? `Опубликованная кампания относится к ${entry.housingYear} году; для другого года уточните новые правила.` : 'Применимость для вашего кампуса и года нужно уточнить.'}`,
          sourceId: `uni_${entry.code.toLowerCase()}_housing`,
          language: 'ru' as const,
          tags: ['общежитие', 'проживание', 'заселение'],
          validAsOf: DIRECTORY_CHECKED_AT,
        },
        {
          id: `kb-${entry.code.toLowerCase()}-housing-en`,
          title: `${entry.nameEn}: housing after enrollment`,
          content: `Check your housing application or individual place assignment on the official ${entry.nameEn} page. An application does not guarantee a place. ${entry.housingYear ? `The published campaign belongs to ${entry.housingYear}; confirm new rules for another year.` : 'Confirm applicability for your campus and year.'}`,
          sourceId: `uni_${entry.code.toLowerCase()}_housing`,
          language: 'en' as const,
          tags: ['dormitory', 'housing', 'move-in'],
          validAsOf: DIRECTORY_CHECKED_AT,
        },
      ]
    : []),
]);

export const directoryKnowledgeDocuments: readonly KnowledgeDocument[] = [
  ...directoryBaseKnowledgeDocuments,
  ...universityActionKnowledgeDocuments,
];
