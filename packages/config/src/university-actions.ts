import type {
  ApplicabilityRule,
  KnowledgeDocument,
  RouteStage,
  Source,
  StepDefinition,
} from '../../domain/src/index.js';
import { verifiedUniversityActions } from './verified-actions.js';

/** Actions extracted from the 23.09.2026 research packet. No unconfirmed date becomes a deadline. */
export interface UniversityAction {
  university: string;
  code: string;
  stage: RouteStage;
  sourceUrl: string;
  sourceTitle: string;
  titleRu: string;
  titleEn: string;
  actionRu: string;
  actionEn: string;
  audienceRu: string;
  audienceEn: string;
  applicability: ApplicabilityRule;
  admissionYear?: number;
  sortOrder: number;
  checkedAt?: string;
}

const legacyUniversityActions: readonly UniversityAction[] = [
  {
    university: 'MSU',
    code: 'MSU_FACULTY_BEFORE',
    stage: 'pre_arrival',
    sortOrder: 100,
    sourceUrl: 'https://international.msu.ru/before',
    sourceTitle: 'МГУ: до приезда',
    titleRu: 'Свяжитесь с международным отделом своего факультета',
    titleEn: 'Contact your faculty international office',
    actionRu:
      'До поездки уточните в своём факультете, нужна ли визовая поддержка, как сообщить о приезде и кто помогает с жильём. Порядок зависит от факультета.',
    actionEn:
      'Before travelling, ask your faculty about visa support, arrival notification and housing help. The process depends on your faculty.',
    audienceRu: 'Иностранные студенты МГУ до приезда; факультет уточняется',
    audienceEn: 'MSU international students before arrival; faculty to confirm',
    applicability: { citizenshipTypes: ['foreign'], arrivalStatuses: ['preparing'] },
  },
  {
    university: 'MSU',
    code: 'MSU_FACULTY_AFTER',
    stage: 'first_three_days',
    sortOrder: 110,
    sourceUrl: 'https://international.msu.ru/after',
    sourceTitle: 'МГУ: после приезда',
    titleRu: 'Обратитесь в иностранный отдел факультета после приезда',
    titleEn: 'Visit your faculty international office after arrival',
    actionRu:
      'Сообщите о приезде и фактическом адресе в иностранный отдел своего факультета. Уточните порядок миграционного учёта для вашего жилья; сроки из памятки МГУ не заменяют проверку действующих правил.',
    actionEn:
      'Tell your faculty international office when you arrived and where you actually stay. Confirm the migration-registration process for your housing; check current rules before relying on university dates.',
    audienceRu: 'Иностранные студенты МГУ после приезда',
    audienceEn: 'MSU international students after arrival',
    applicability: { citizenshipTypes: ['foreign'], arrivalStatuses: ['arrived'] },
  },
  {
    university: 'MSU',
    code: 'MSU_PRIVATE_HOST',
    stage: 'first_three_days',
    sortOrder: 120,
    sourceUrl: 'https://international.msu.ru/after',
    sourceTitle: 'МГУ: проживание вне общежития',
    titleRu: 'Согласуйте миграционный учёт с принимающей стороной',
    titleEn: 'Coordinate registration with your host',
    actionRu:
      'Если вы живёте вне общежития МГУ, заранее обсудите с собственником или другой принимающей стороной учёт по фактическому адресу и передачу подтверждения факультету.',
    actionEn:
      'If you stay outside an MSU dormitory, ask your landlord or other host about registration at your actual address and how to pass confirmation to your faculty.',
    audienceRu: 'Иностранные студенты МГУ в частном жилье или у родственников',
    audienceEn: 'MSU international students in private or family housing',
    applicability: {
      citizenshipTypes: ['foreign'],
      arrivalStatuses: ['arrived'],
      accommodationTypes: ['private', 'relatives'],
    },
  },
  {
    university: 'MEPHI',
    code: 'MEPHI_VISA_SUPPORT',
    stage: 'pre_arrival',
    sortOrder: 100,
    sourceUrl: 'https://mephi.ru/foreign-nationals/visa/visa-entr',
    sourceTitle: 'МИФИ: визовая поддержка',
    titleRu: 'Уточните визовую поддержку МИФИ',
    titleEn: 'Confirm MEPhI visa support',
    actionRu:
      'Если для въезда нужна виза, проверьте у МИФИ порядок приглашения и свои документы до покупки билетов. Для филиала уточните местное подразделение.',
    actionEn:
      'If you need a visa, confirm the invitation process and your documents with MEPhI before buying tickets. Ask your branch for its local office.',
    audienceRu: 'Иностранные студенты МИФИ с визовым въездом; московский кампус',
    audienceEn: 'MEPhI international students needing a visa; Moscow campus',
    applicability: {
      citizenshipTypes: ['foreign'],
      entryModes: ['visa'],
      arrivalStatuses: ['preparing'],
      campusCodes: ['main'],
    },
  },
  {
    university: 'MEPHI',
    code: 'MEPHI_MIGRATION_OFFICE',
    stage: 'first_three_days',
    sortOrder: 110,
    sourceUrl: 'https://mephi.ru/foreign-nationals/migration-reg/migr-entr',
    sourceTitle: 'МИФИ: миграционный учёт',
    titleRu: 'Уточните миграционные действия в МИФИ',
    titleEn: 'Confirm migration steps with MEPhI',
    actionRu:
      'После приезда покажите ответственному подразделению МИФИ сведения о въезде и фактическом жилье. Уточните, кто подаёт документы по вашему адресу.',
    actionEn:
      'After arrival, give the responsible MEPhI office your entry and actual housing details. Confirm who submits documents for your address.',
    audienceRu: 'Иностранные студенты московского кампуса МИФИ после приезда',
    audienceEn: 'MEPhI Moscow international students after arrival',
    applicability: { citizenshipTypes: ['foreign'], arrivalStatuses: ['arrived'], campusCodes: ['main'] },
  },
  {
    university: 'MEPHI',
    code: 'MEPHI_DORM_MOVE',
    stage: 'pre_arrival',
    sortOrder: 120,
    sourceUrl: 'https://mephi.ru/node/19028',
    sourceTitle: 'МИФИ: общежитие',
    titleRu: 'Проверьте порядок заселения МИФИ',
    titleEn: 'Check MEPhI dormitory move-in',
    actionRu:
      'После подтверждения зачисления проверьте своё направление и документы для общежития. Заявка не равна назначенному месту; расписание и адрес зависят от института.',
    actionEn:
      'After admission is confirmed, check your individual dormitory referral and required documents. Applying is not an assigned place; timing and address depend on your institute.',
    audienceRu: 'Зачисленные иностранные студенты московского кампуса МИФИ с планом проживания в общежитии',
    audienceEn: 'Admitted international MEPhI Moscow students planning a dormitory stay',
    applicability: {
      citizenshipTypes: ['foreign'],
      campusCodes: ['main'],
      enrollmentStates: ['admitted', 'arrived'],
      accommodationTypes: ['dormitory'],
    },
  },
  {
    university: 'MEPHI',
    code: 'MEPHI_RF_DORM',
    stage: 'pre_arrival',
    sortOrder: 120,
    sourceUrl: 'https://mephi.ru/students/dorms',
    sourceTitle: 'МИФИ: общежития для студентов',
    titleRu: 'Уточните место и правила общежития МИФИ',
    titleEn: 'Confirm your MEPhI dormitory place and rules',
    actionRu:
      'Откройте раздел общежитий МИФИ и уточните у своего института, предоставлено ли место именно вам, где взять направление и какие правила заселения действуют сейчас.',
    actionEn:
      'Open the MEPhI dormitory section and ask your institute whether you have an assigned place, where to obtain a referral and which move-in rules currently apply.',
    audienceRu: 'Граждане РФ, московский кампус МИФИ, общежитие',
    audienceEn: 'Russian citizens, MEPhI Moscow campus, dormitory',
    applicability: { citizenshipTypes: ['rf'], campusCodes: ['main'], accommodationTypes: ['dormitory'] },
  },
  {
    university: 'MIPT',
    code: 'MIPT_VISA_INVITATION',
    stage: 'pre_arrival',
    sortOrder: 100,
    sourceUrl: 'https://pk.mipt.ru/foreign/',
    sourceTitle: 'МФТИ: после зачисления иностранцев',
    titleRu: 'Проверьте приглашение и порядок въезда МФТИ',
    titleEn: 'Check the MIPT invitation and entry process',
    actionRu:
      'Если вам нужна виза, уточните визовую поддержку МФТИ с учётом основания обучения: договор и квота описаны отдельно. Согласуйте приезд после готовности документов.',
    actionEn:
      'If you need a visa, confirm MIPT support for your study basis: contract and quota routes differ. Coordinate arrival once your documents are ready.',
    audienceRu: 'Иностранные студенты МФТИ с визовым въездом',
    audienceEn: 'MIPT international students entering with a visa',
    applicability: { citizenshipTypes: ['foreign'], entryModes: ['visa'], arrivalStatuses: ['preparing'] },
  },
  {
    university: 'MIPT',
    code: 'MIPT_ARRIVAL_OFFICE',
    stage: 'first_three_days',
    sortOrder: 110,
    sourceUrl: 'https://pk.mipt.ru/foreign/',
    sourceTitle: 'МФТИ: действия после приезда',
    titleRu: 'Передайте сведения о приезде профильному отделу МФТИ',
    titleEn: 'Tell the MIPT office about your arrival',
    actionRu:
      'После въезда уточните в отделе по работе с иностранными обучающимися, какие документы передать для вашего визового или безвизового случая и фактического адреса. Не переносите срок с памятки на любой статус.',
    actionEn:
      'After entry, ask the international student office which documents apply to your visa status and actual address. Do not treat a page date as a universal legal deadline.',
    audienceRu: 'Иностранные студенты МФТИ после въезда',
    audienceEn: 'MIPT international students after entry',
    applicability: { citizenshipTypes: ['foreign'], arrivalStatuses: ['arrived'] },
  },
  {
    university: 'HSE',
    code: 'HSE_MOSCOW_SUPPORT',
    stage: 'pre_arrival',
    sortOrder: 100,
    sourceUrl: 'https://istudents.hse.ru/en/entering',
    sourceTitle: 'ВШЭ: первые шаги иностранных студентов Москвы',
    titleRu: 'Проверьте первые шаги в московском кампусе ВШЭ',
    titleEn: 'Check first steps at HSE Moscow',
    actionRu:
      'Откройте памятку для зачисленных иностранных студентов московского кампуса и уточните свой визит, учётные документы и связь с центром поддержки. Для другого кампуса нужна его инструкция.',
    actionEn:
      'Read the guide for newly enrolled international students at HSE Moscow and confirm your visit, student documents and support contact. Other campuses have separate instructions.',
    audienceRu: 'Иностранные студенты московского кампуса ВШЭ',
    audienceEn: 'HSE Moscow international students',
    applicability: { citizenshipTypes: ['foreign'], campusCodes: ['main'] },
  },
  {
    university: 'HSE',
    code: 'HSE_2026_RF_DORM',
    stage: 'pre_arrival',
    sortOrder: 110,
    admissionYear: 2026,
    sourceUrl: 'https://www.hse.ru/dormoffice/zaseleniebak2026',
    sourceTitle: 'ВШЭ: заселение бакалавриата 2026',
    titleRu: 'Проверьте направление на заселение ВШЭ',
    titleEn: 'Check your HSE move-in referral',
    actionRu:
      'Если вы поступили в 2026 году на бакалавриат или специалитет в Москве и указали потребность в общежитии, после приказа проверьте личный кабинет: направление содержит индивидуальные адрес и дату. Не приезжайте по общей дате без направления.',
    actionEn:
      'If you entered a Moscow bachelor/specialist programme in 2026 and requested housing, check your account after the enrollment order. Your referral gives your own address and date; do not assume a general move-in date.',
    audienceRu: 'Граждане РФ, бакалавриат/специалитет ВШЭ Москва, набор 2026, общежитие',
    audienceEn: 'Russian citizens, HSE Moscow bachelor/specialist intake 2026, dormitory',
    applicability: {
      citizenshipTypes: ['rf'],
      campusCodes: ['main'],
      programLevels: ['bachelor_specialist'],
      admissionYears: [2026],
      accommodationTypes: ['dormitory'],
    },
  },
  {
    university: 'NSU',
    code: 'NSU_ACCOUNT_PASS',
    stage: 'first_week',
    sortOrder: 100,
    sourceUrl: 'https://education.nsu.ru/freshmen',
    sourceTitle: 'НГУ: памятка первокурсника',
    titleRu: 'Получите доступ к учёбе в НГУ',
    titleEn: 'Set up your NSU study access',
    actionRu:
      'Проверьте в памятке первокурсника порядок получения университетской учётной записи и электронного пропуска. График выдачи пропусков уточняйте на странице своего факультета.',
    actionEn:
      'Use the first-year guide to check how to get a university account and electronic pass. Confirm the pass collection schedule with your faculty.',
    audienceRu: 'Первокурсники НГУ; расписание факультета уточняется',
    audienceEn: 'NSU first-year students; faculty schedule to confirm',
    applicability: {},
  },
  {
    university: 'NSU',
    code: 'NSU_DORM_2026',
    stage: 'pre_arrival',
    sortOrder: 110,
    admissionYear: 2026,
    sourceUrl: 'https://education.nsu.ru/freshmen',
    sourceTitle: 'НГУ: общежитие первокурсника 2026',
    titleRu: 'Уточните заселение и документы для общежития НГУ',
    titleEn: 'Confirm NSU dormitory move-in and documents',
    actionRu:
      'Проверьте у деканата назначение места и актуальный перечень документов. Памятка НГУ перечисляет документы и дату начала заселения для 2026 года; не переносите её на другой набор.',
    actionEn:
      'Confirm your assigned place and current document list with your faculty. The NSU guide lists documents and a 2026 move-in date; do not reuse it for another intake.',
    audienceRu: 'Первокурсники НГУ 2026 года с общежитием',
    audienceEn: 'NSU first-year students in the 2026 intake needing a dormitory',
    applicability: { admissionYears: [2026], accommodationTypes: ['dormitory'] },
  },
  {
    university: 'NSU',
    code: 'NSU_MILITARY_OFFICE',
    stage: 'first_week',
    sortOrder: 120,
    sourceUrl: 'https://education.nsu.ru/freshmen',
    sourceTitle: 'НГУ: отдел воинского учёта',
    titleRu: 'Уточните воинский учёт в НГУ',
    titleEn: 'Clarify military registration at NSU',
    actionRu:
      'Если воинский учёт может относиться к вам, обратитесь в отдел воинского учёта НГУ. Применимость зависит от статуса, а не только от пола; юридический срок здесь не установлен.',
    actionEn:
      'If military registration may apply, ask the NSU military registration office. Applicability depends on your status, not sex alone; this route sets no legal deadline.',
    audienceRu: 'Граждане РФ, которым воинский учёт может относиться или статус неизвестен',
    audienceEn: 'Russian citizens whose military-registration status may apply or is unknown',
    applicability: { citizenshipTypes: ['rf'], militaryStatuses: ['yes', 'unknown'] },
  },
  {
    university: 'SPBU',
    code: 'SPBU_FOREIGN_ARRIVAL',
    stage: 'first_three_days',
    sortOrder: 100,
    sourceUrl: 'https://guide.spbu.ru/foreigner',
    sourceTitle: 'СПбГУ: справочник иностранного студента',
    titleRu: 'Сообщите СПбГУ о въезде и месте проживания',
    titleEn: 'Notify SPbU about entry and housing',
    actionRu:
      'После въезда свяжитесь с миграционным подразделением и учебным отделом СПбГУ. Дальнейшие действия различаются для общежития и частного адреса.',
    actionEn:
      'After entry, contact the SPbU migration and academic offices. Next steps differ for a dormitory and private address.',
    audienceRu: 'Иностранные студенты СПбГУ после въезда',
    audienceEn: 'SPbU international students after entry',
    applicability: { citizenshipTypes: ['foreign'], arrivalStatuses: ['arrived'] },
  },
  {
    university: 'SPBU',
    code: 'SPBU_DORM_ASSIGNMENT',
    stage: 'pre_arrival',
    sortOrder: 110,
    sourceUrl: 'https://guide.spbu.ru/dormitory',
    sourceTitle: 'СПбГУ: общежития',
    titleRu: 'Проверьте распределение по общежитиям СПбГУ',
    titleEn: 'Check SPbU dormitory assignment',
    actionRu:
      'За несколько дней до заселения проверьте университетские списки и узнайте именно свой корпус, адрес и день. Студенту младше 18 лет понадобится согласие родителей. Если вложенный список не открывается, напишите 911@spbu.ru или office@campus.spbu.ru и спросите своё назначение и полный действующий пакет. Не приезжайте в случайное общежитие по карте.',
    actionEn:
      'A few days before move-in, check the university lists for your assigned building, address and day. Students under 18 need parental consent. If the linked list is unavailable, ask 911@spbu.ru or office@campus.spbu.ru for your assignment and current full document pack. Do not choose a dormitory from a map.',
    audienceRu: 'Студенты СПбГУ, планирующие жить в общежитии',
    audienceEn: 'SPbU students planning to live in a dormitory',
    applicability: { accommodationTypes: ['dormitory'], housingStatuses: ['unknown', 'applied'] },
  },
  {
    university: 'SPBU',
    code: 'SPBU_PRIVATE_HOST',
    stage: 'first_three_days',
    sortOrder: 120,
    sourceUrl: 'https://guide.spbu.ru/foreigner',
    sourceTitle: 'СПбГУ: частное жильё иностранного студента',
    titleRu: 'Проверьте действия принимающей стороны',
    titleEn: 'Check what your host must do',
    actionRu:
      'Если вы живёте вне общежития, уточните у собственника или другой принимающей стороны порядок миграционного учёта по фактическому адресу и сообщите адрес СПбГУ.',
    actionEn:
      'If you stay outside a dormitory, confirm migration-registration actions at your actual address with the landlord or host and tell SPbU your address.',
    audienceRu: 'Иностранные студенты СПбГУ в частном жилье после приезда',
    audienceEn: 'SPbU international students in private housing after arrival',
    applicability: {
      citizenshipTypes: ['foreign'],
      arrivalStatuses: ['arrived'],
      accommodationTypes: ['private', 'relatives'],
    },
  },
  {
    university: 'TSU',
    code: 'TSU_FACULTY_HOUSING',
    stage: 'pre_arrival',
    sortOrder: 100,
    sourceUrl: 'https://info.abiturient.tsu.ru/ru/content/%D0%BE%D0%B1%D1%89%D0%B5%D0%B6%D0%B8%D1%82%D0%B8%D1%8F',
    sourceTitle: 'ТГУ: общежития',
    titleRu: 'Уточните заселение на своём факультете ТГУ',
    titleEn: 'Confirm dormitory move-in with your TSU faculty',
    actionRu:
      'Проверьте в деканате, есть ли для вашей категории место, где получить направление и какой список документов действует. Факультеты ТГУ публикуют разные порядки; общая страница не подтверждает личное место.',
    actionEn:
      'Ask your faculty whether your category has a place, where to get a referral and which documents apply. TSU faculties publish different procedures; the general page does not confirm your place.',
    audienceRu: 'Студенты ТГУ, которым нужно общежитие; факультет и категория уточняются',
    audienceEn: 'TSU students needing a dormitory; faculty and category to confirm',
    applicability: { accommodationTypes: ['dormitory'] },
  },
  {
    university: 'TSU',
    code: 'TSU_FOREIGN_SUPPORT',
    stage: 'pre_arrival',
    sortOrder: 110,
    sourceUrl:
      'https://info.abiturient.tsu.ru/content/%D0%BF%D1%80%D0%B8%D1%91%D0%BC-%D0%B8%D0%BD%D0%BE%D1%81%D1%82%D1%80%D0%B0%D0%BD%D0%BD%D1%8B%D1%85-%D0%B3%D1%80%D0%B0%D0%B6%D0%B4%D0%B0%D0%BD',
    sourceTitle: 'ТГУ: поддержка иностранных студентов',
    titleRu: 'Запросите инструкцию после зачисления в ТГУ',
    titleEn: 'Ask TSU for your post-enrollment instructions',
    actionRu:
      'Свяжитесь с международным подразделением ТГУ и сообщите программу, гражданство и план приезда. Единой проверенной инструкции для всех иностранных первокурсников в пакете нет.',
    actionEn:
      'Contact the TSU international office with your programme, citizenship and arrival plan. The research packet has no verified single guide for all international first-year students.',
    audienceRu: 'Иностранные студенты ТГУ; программа уточняется',
    audienceEn: 'TSU international students; programme to confirm',
    applicability: { citizenshipTypes: ['foreign'] },
  },
  {
    university: 'KFU',
    code: 'KFU_2026_HOUSING',
    stage: 'pre_arrival',
    sortOrder: 100,
    admissionYear: 2026,
    sourceUrl: 'https://admissions.kpfu.ru/prozhivanie/zaselenie-inostrannyx-grazhdan/',
    sourceTitle: 'КФУ: заселение иностранных студентов 2026',
    titleRu: 'Проверьте заявку и списки общежития КФУ',
    titleEn: 'Check your KFU housing application and list',
    actionRu:
      'Для набора 2026 проверьте подачу заявления в личном кабинете и опубликованные после зачисления списки. Только личное подтверждение показывает, что место предоставлено; даты кампании не действуют для 2027 года.',
    actionEn:
      'For the 2026 intake, check your account application and the lists published after admission. Only individual confirmation shows that you have a place; 2026 dates do not apply to 2027.',
    audienceRu: 'Иностранные первокурсники Казанского кампуса КФУ, набор 2026, общежитие',
    audienceEn: 'KFU Kazan international first-years, 2026 intake, dormitory',
    applicability: {
      citizenshipTypes: ['foreign'],
      campusCodes: ['main'],
      admissionYears: [2026],
      accommodationTypes: ['dormitory'],
    },
  },
  {
    university: 'KFU',
    code: 'KFU_MIGRATION_HELP',
    stage: 'first_three_days',
    sortOrder: 110,
    sourceUrl: 'https://admissions.kpfu.ru/adaptacziya-inostrannyh-grazhdan/viza-i-migraczionnyj-uchyot/',
    sourceTitle: 'КФУ: виза и миграционный учёт',
    titleRu: 'Уточните сопровождение после въезда в КФУ',
    titleEn: 'Confirm KFU support after entry',
    actionRu:
      'После приезда откройте раздел КФУ о визе и миграционном учёте и сообщите фактический адрес ответственному подразделению. Срок зависит от вашего статуса и жилья.',
    actionEn:
      'After arrival, use KFU visa and migration guidance and tell the responsible office your actual address. Timing depends on your status and housing.',
    audienceRu: 'Иностранные студенты Казанского кампуса КФУ после приезда',
    audienceEn: 'KFU Kazan international students after arrival',
    applicability: { citizenshipTypes: ['foreign'], campusCodes: ['main'], arrivalStatuses: ['arrived'] },
  },
  {
    university: 'RUDN',
    code: 'RUDN_DORM_ADAPTATION',
    stage: 'first_three_days',
    sortOrder: 100,
    sourceUrl: 'https://international.rudn.ru/undergraduate/obshchezhitie/',
    sourceTitle: 'РУДН: общежитие иностранного студента',
    titleRu: 'Начните оформление проживания в РУДН',
    titleEn: 'Start your RUDN housing process',
    actionRu:
      'После приказа о зачислении и приезда обратитесь в Центр адаптации иностранных граждан за временным размещением, затем уточните постоянное место в подразделении по размещению. Не считайте комнату назначенной без подтверждения.',
    actionEn:
      'After the enrollment order and arrival, ask the Center for Adaptation of Foreign Citizens about temporary housing, then confirm a permanent place with the accommodation office. Do not assume a room is assigned.',
    audienceRu: 'Зачисленные иностранные студенты РУДН с общежитием после приезда',
    audienceEn: 'Admitted RUDN international students needing dormitory housing after arrival',
    applicability: {
      citizenshipTypes: ['foreign'],
      arrivalStatuses: ['arrived'],
      enrollmentStates: ['admitted', 'arrived'],
      accommodationTypes: ['dormitory'],
      housingStatuses: ['unknown', 'applied'],
    },
  },
  {
    university: 'RUDN',
    code: 'RUDN_MIGRATION_STATUS',
    stage: 'first_three_days',
    sortOrder: 110,
    sourceUrl: 'https://international.rudn.ru/migration_registration/',
    sourceTitle: 'РУДН: миграционная регистрация',
    titleRu: 'Проверьте миграционные действия для своего случая',
    titleEn: 'Check migration actions for your case',
    actionRu:
      'Уточните в РУДН порядок для вашего гражданства, даты въезда и фактического жилья. Московскую процедуру через «Амину» нельзя назначать всем иностранным студентам автоматически.',
    actionEn:
      'Ask RUDN which process applies to your citizenship, entry date and actual housing. The Moscow Amina procedure must not be assigned to every international student automatically.',
    audienceRu: 'Иностранные студенты РУДН после приезда',
    audienceEn: 'RUDN international students after arrival',
    applicability: { citizenshipTypes: ['foreign'], arrivalStatuses: ['arrived'] },
  },
  {
    university: 'RUDN',
    code: 'RUDN_RF_HOUSING',
    stage: 'pre_arrival',
    sortOrder: 120,
    sourceUrl: 'https://www.rudn.ru/life/accomodation',
    sourceTitle: 'РУДН: проживание студентов',
    titleRu: 'Проверьте статус общежития РУДН',
    titleEn: 'Check your RUDN housing status',
    actionRu:
      'Если вы гражданин РФ, уточните в подразделении РУДН по размещению, подана ли заявка и предоставлено ли место именно вам. Общая страница о проживании не гарантирует заселение.',
    actionEn:
      'If you are a Russian citizen, ask the RUDN accommodation office whether your application exists and a place is assigned to you. The general housing page does not guarantee a room.',
    audienceRu: 'Граждане РФ, которым нужно общежитие РУДН',
    audienceEn: 'Russian citizens needing a RUDN dormitory',
    applicability: {
      citizenshipTypes: ['rf'],
      accommodationTypes: ['dormitory'],
      housingStatuses: ['unknown', 'applied'],
    },
  },
] as const;

const supersededCodes = new Set([
  'MEPHI_DORM_MOVE',
  'MEPHI_RF_DORM',
  'HSE_MOSCOW_SUPPORT',
  'NSU_ACCOUNT_PASS',
  'NSU_DORM_2026',
  'SPBU_FOREIGN_ARRIVAL',
  'SPBU_PRIVATE_HOST',
  'KFU_2026_HOUSING',
  'KFU_MIGRATION_HELP',
  'RUDN_MIGRATION_STATUS',
]);

export const universityActions: readonly UniversityAction[] = [
  ...legacyUniversityActions.filter((action) => !supersededCodes.has(action.code)),
  ...verifiedUniversityActions,
];

/** Document lists copied from the corresponding verified action, kept separate for the step detail view. */
const actionPreparation: Readonly<Record<string, { ru: string; en: string }>> = {
  MSU_VISA_PACKAGE: {
    ru: 'Анкета, согласие на обработку данных, скан первых страниц паспорта; после получения визы — её скан для факультета.',
    en: 'Application form, data-processing consent and scan of the first passport pages; after receiving the visa, send its scan to your faculty.',
  },
  MSU_ECON_DORM_2026: {
    ru: 'Паспорт с копиями, ордер и выписки, две фотографии 3×4; договор — при платном обучении, воинский документ — только если относится к вам.',
    en: 'Passport and copies, housing order and extracts, two 3×4 photos; fee-paying contract and military document only if applicable.',
  },
  MSU_SOIL_DORM_2026: {
    ru: 'Паспорт, копия страницы с данными и регистрацией на одном листе, две матовые фотографии 3×4; воинский документ — если относится к вам.',
    en: 'Passport, data and registration copy on one sheet, two matte 3×4 photos; military document if applicable.',
  },
  MSU_DORM_MIGRATION: {
    ru: 'Паспорт и миграционная карта с копиями; справка общежития с адресом и комнатой либо договор найма.',
    en: 'Passport and migration card with copies; dormitory address and room certificate or housing contract.',
  },
  MEPHI_DORM_PACKAGE_2026: {
    ru: 'Для первичного заселения — сканы паспорта и фото на белом фоне. Для договора — паспорт с копией, фото 3×4, справка 086/у с отметкой дерматолога и прививочный сертификат; несовершеннолетнему — согласие родителей.',
    en: 'For initial move-in: passport scans and white-background photo. For the contract: passport and copy, 3×4 photo, certificate 086/u with dermatologist note, vaccination record; parental consent for minors.',
  },
  MEPHI_G106_REGISTRATION: {
    ru: 'Паспорт, миграционная карта со штампом, учебная виза — если нужна; прежняя регистрация — если после вступительных испытаний вы не выезжали из России.',
    en: 'Passport, stamped migration card, study visa if required; previous registration if you stayed in Russia after entrance exams.',
  },
  MEPHI_VISA_RENEWAL: {
    ru: 'Паспорт, миграционная карта, матовое фото 3×4 и квитанция, которую выдают в кабинете Г-106.',
    en: 'Passport, migration card, matte 3×4 photo and the payment receipt issued in room G-106.',
  },
  MIPT_DORM_DOCUMENTS: {
    ru: 'Паспорт, медицинский полис, флюорография не старше 12 месяцев; несовершеннолетнему — согласие представителя, льготнику — подтверждение льготы.',
    en: 'Passport, health insurance, fluorography within 12 months; guardian consent for minors and priority evidence if applicable.',
  },
  MIPT_MASTER_DORM_DOCUMENTS: {
    ru: 'Паспорт, медицинский полис, флюорография не старше 12 месяцев; подтверждение льготы — если она есть.',
    en: 'Passport, health insurance and fluorography within 12 months; priority evidence if applicable.',
  },
  MIPT_VISA_ARRIVAL: {
    ru: 'Чёткие фотографии миграционной карты и всех страниц паспорта, включая пустые.',
    en: 'Clear photos of the migration card and every passport page, including blank pages.',
  },
  HSE_MOSCOW_FOREIGN_INTAKE: {
    ru: 'Сверьте с поданной заявкой: паспорт с переводом, документы об образовании, миграционная карта и фотографии могут понадобиться не всем.',
    en: 'Check your submitted application: translated passport, education documents, migration card and photos may be needed depending on your case.',
  },
  HSE_MOSCOW_RF_DOCUMENTS: {
    ru: 'Паспорт и копия с регистрацией на одном листе, справка 086/у или распечатанная СЭМД-196, прививочный сертификат с копией, медицинский полис с копией.',
    en: 'Passport and registration-page copy on one sheet, 086/u certificate or printed SEMD-196, vaccination record and copy, insurance policy and copy.',
  },
  HSE_MOSCOW_FOREIGN_DORM: {
    ru: 'Личное направление; уточните у кампуса паспорт, миграционную карту, страховые и медицинские документы. Виза нужна только при визовом въезде.',
    en: 'Personal referral; confirm passport, migration card, insurance and medical documents with the campus. A visa applies only to visa-based entry.',
  },
  HSE_MOSCOW_MIGRATION: {
    ru: 'Паспорт, виза или миграционная карта по вашему способу въезда, сведения о фактическом жилье.',
    en: 'Passport, visa or migration card according to your entry route, and actual housing details.',
  },
  HSE_SPB_MIGRATION_DORM: {
    ru: 'Паспорт и копии заполненных страниц, миграционная карта с копией, прежний миграционный учёт — при наличии.',
    en: 'Passport and copies of filled pages, migration card and copy, previous registration if any.',
  },
  HSE_NN_DORM_APPLICATION: {
    ru: 'Копии первой страницы паспорта и страницы с регистрацией для вузовской заявки; проверьте применимость к своему статусу.',
    en: 'Copies of the first passport page and registration page for the university housing form; confirm applicability to your status.',
  },
  HSE_NN_DORM_DOCUMENTS: {
    ru: 'Паспорт и копия, полис и копия, копия 086/у с отметкой о флюорографии. Несовершеннолетнему — представитель либо согласие; иностранцу — отдельный миграционный пакет по указанию кампуса.',
    en: 'Passport and copy, insurance and copy, 086/u copy with fluorography. Minors need a representative or consent; international students should request their migration pack.',
  },
  HSE_PERM_DORM: {
    ru: 'Паспорт, оригинал справки 086/у и подтверждение прививок; несовершеннолетнему — согласие представителя, если его требует кампус.',
    en: 'Passport, original 086/u certificate and vaccination record; guardian consent for minors if required by the campus.',
  },
  HSE_PERM_FOREIGN_PACK: {
    ru: 'Паспорт с переводом, миграционная карта и имеющиеся медицинские документы. Полный комплект запросите у кампуса: опубликованные страницы расходятся.',
    en: 'Translated passport, migration card and available medical documents. Ask the campus for the complete pack: published pages differ.',
  },
  NSU_DORM_PACKAGE: {
    ru: 'Паспорт, медицинский полис, сведения о прививках, СНИЛС, флюорография не старше года, справка 086/у или СЭМД-196, четыре фото 3×4; воинский документ — если относится к вам. Иностранному студенту нужно уточнить применимость списка.',
    en: 'Passport, insurance, vaccination record, SNILS, fluorography within a year, 086/u or SEMD-196, four 3×4 photos; military document if applicable. International students should confirm which items apply.',
  },
  NSU_CAMPUS_PASS: {
    ru: 'Паспорт; график выдачи пропуска уточните для своего факультета.',
    en: 'Passport; check the pass-collection schedule for your faculty.',
  },
  SPBU_DORM_REGISTRATION: {
    ru: 'Договор найма, паспорт с копиями страниц с отметками, миграционная карта с копией — если выдавалась.',
    en: 'Housing contract, passport and copies of marked pages, migration card and copy if issued.',
  },
  SPBU_DORM_ASSIGNMENT: {
    ru: 'Если вам нет 18 лет — согласие родителей. Полный комплект и личное назначение уточните по опубликованному списку или у отдела общежитий.',
    en: 'If you are under 18, parental consent. Confirm your full pack and personal assignment through the published list or housing office.',
  },
  SPBU_NOTIFY_ENTRY: {
    ru: 'Копия миграционной карты, если она выдавалась при въезде.',
    en: 'Migration card copy if one was issued on entry.',
  },
  TSU_LAW_DORM_EXTRA: {
    ru: 'Справка о зачислении или выписка из приказа; справка из поликлиники №1 либо Межвузовской поликлиники по указанию факультета.',
    en: 'Admission certificate or enrolment-order extract; certificate from Polyclinic No. 1 or the Interuniversity Polyclinic as directed by the faculty.',
  },
  TSU_DORM_RF_PACKAGE: {
    ru: 'Паспорт и три копии нужных страниц, флюорография не старше года с копией, справка об отсутствии чесотки и педикулёза сроком действия три дня, три фото 3×4; несовершеннолетнему — нотариальная доверенность родителей.',
    en: 'Passport and three copies of relevant pages, fluorography within a year and copy, three-day-valid scabies/lice certificate, three 3×4 photos; notarised parental authorisation for minors.',
  },
  ITMO_DORM_APPLICATION: {
    ru: 'Флюорография не старше 12 месяцев, сделанная в России, прививочная карта, СЭМД-196 либо 086/у; подтверждение льготы — если есть.',
    en: 'Fluorography within 12 months performed in Russia, vaccination record, SEMD-196 or 086/u; priority evidence if applicable.',
  },
  ITMO_DORM_APPOINTMENT: {
    ru: 'Письмо о назначении и точный тип общежития. Если назначен МСГ — справка медпункта ИТМО; полный очный пакет уточните в персональном письме или у отдела общежитий.',
    en: 'Assignment email and exact dormitory type. If assigned to MSG, obtain the ITMO medical-point certificate; confirm the full move-in pack in your personal email or with the housing office.',
  },
  ITMO_DORM_MIGRATION: {
    ru: 'Документ въезда, миграционная карта — если выдавалась, договор платного обучения — при наличии.',
    en: 'Entry document, migration card if issued, fee-paying study contract if applicable.',
  },
  KFU_DORM_RF_PACKAGE_2026: {
    ru: 'Паспорт с копиями, ИНН, СНИЛС, полис, флюорография, RW-анализ, справки дерматовенеролога и терапевта, три фото 3×4; несовершеннолетнему — согласие родителей.',
    en: 'Passport and copies, tax and pension identifiers, insurance, fluorography, RW test, dermatologist and therapist certificates, three 3×4 photos; parental consent for minors.',
  },
  KFU_DORM_FOREIGN_PACKAGE_2026: {
    ru: 'Уточните полный пакет в КФУ. Памятка 2026 называет паспорт с копиями, ДМС, миграционную карту, RW-анализ, справку дерматовенеролога с переводом, флюорографию, заключение терапевта и три фото.',
    en: 'Confirm the complete pack with KFU. The 2026 guide lists passport and copies, voluntary insurance, migration card, RW test, translated dermatologist certificate, fluorography, therapist report and three photos.',
  },
  KFU_DORM_MIGRATION: {
    ru: 'Паспорт, миграционная карта, договор найма и справка об обучении не старше 14 дней; при визовом въезде — виза и прежняя регистрация, если есть.',
    en: 'Passport, migration card, housing contract and study certificate issued within 14 days; for visa-based entry, visa and previous registration if any.',
  },
  KFU_PRIVATE_HOST: {
    ru: 'Паспорт и подписанный договор найма по фактическому адресу.',
    en: 'Passport and signed housing contract for your actual address.',
  },
  RUDN_DORM_PACKAGE: {
    ru: 'Паспорт, две цветные фотографии 3×4, заключение Клиническо-диагностического центра о проживании, студенческий билет либо временное удостоверение с номером; иностранцу — также временное удостоверение международного департамента.',
    en: 'Passport, two colour 3×4 photos, Clinical Diagnostic Centre housing conclusion, student card or temporary numbered ID; international students also need temporary international-department ID.',
  },
  RUDN_FOREIGN_DORM_REGISTRATION: {
    ru: 'Паспорт, миграционная карта и виза — только при визовом въезде; другие документы уточните для своего статуса.',
    en: 'Passport, migration card and visa only for visa-based entry; confirm any additional documents for your status.',
  },
  RUDN_RF_TEMP_REGISTRATION: {
    ru: 'Паспорт и копия, договор проживания и копия.',
    en: 'Passport and copy, housing contract and copy.',
  },
  RUDN_PRIVATE_HODATAYSTVO: {
    ru: 'Паспорт, миграционная карта и прежняя регистрация при наличии; комплект для первого въезда уточните у МФЦ университета.',
    en: 'Passport, migration card and previous registration if any; ask the university service centre what applies to a first arrival.',
  },
};

const actionSourceId = (action: UniversityAction) =>
  `uni_${action.university.toLowerCase()}_${action.code.toLowerCase()}`;
const actionKey = (action: UniversityAction, part: 'title' | 'description') =>
  `steps.research.${action.code.toLowerCase()}.${part}`;
const preparationKey = (action: UniversityAction) => `steps.research.${action.code.toLowerCase()}.prepare`;

export const universityActionSources: readonly Source[] = universityActions.map((action) => ({
  id: actionSourceId(action),
  title: action.sourceTitle,
  url: action.sourceUrl,
  authority: action.university,
  languages: action.sourceUrl.includes('/en/') ? ['en'] : ['ru'],
  validAsOf: action.checkedAt ?? '2026-09-23',
  verificationStatus: action.checkedAt ? 'verified' : 'needs_confirmation',
  metadata: {
    sourceCheckedAt: action.checkedAt ?? '2026-09-23',
    sourcePublishedAt: null,
    admissionYear: action.admissionYear ?? null,
    appliesTo: action.audienceRu,
    appliesToEn: action.audienceEn,
    deadlineStatus: 'needs_confirmation',
    partnerStatus: 'directory_public',
  },
}));

export const universityActionSteps: readonly StepDefinition[] = universityActions.map((action) => ({
  code: action.code,
  universityCode: action.university,
  stage: action.stage,
  titleKey: actionKey(action, 'title'),
  descriptionKey: actionKey(action, 'description'),
  whyImportantKey: 'steps.directory.why',
  preparationKeys: actionPreparation[action.code] ? [preparationKey(action)] : [],
  contactKey: 'contact.university.instruction',
  sourceId: actionSourceId(action),
  validAsOf: action.checkedAt ?? '2026-09-23',
  verificationStatus: action.checkedAt ? 'verified' : 'needs_confirmation',
  sortOrder: action.sortOrder,
  prerequisites: [],
  applicability: action.applicability,
  deadlineRule: null,
  deadlineNoteKey: 'deadline.to_be_confirmed',
  attention: 'normal',
}));

export const universityActionKnowledgeDocuments: readonly KnowledgeDocument[] = universityActions.flatMap((action) =>
  (['ru', 'en'] as const).map((language) => ({
    id: `kb-${action.code.toLowerCase()}-${language}`,
    title: language === 'ru' ? action.titleRu : action.titleEn,
    content: language === 'ru' ? action.actionRu : action.actionEn,
    sourceId: actionSourceId(action),
    language,
    tags:
      language === 'ru' ? ['университет', 'после зачисления', 'приезд'] : ['university', 'after admission', 'arrival'],
    validAsOf: action.checkedAt ?? '2026-09-23',
  })),
);

export const universityActionTranslations: Readonly<Record<'ru' | 'en', Readonly<Record<string, string>>>> = {
  ru: Object.fromEntries(
    universityActions.flatMap((action) => [
      [actionKey(action, 'title'), action.titleRu],
      [actionKey(action, 'description'), action.actionRu],
      ...(actionPreparation[action.code] ? [[preparationKey(action), actionPreparation[action.code]!.ru]] : []),
    ]),
  ),
  en: Object.fromEntries(
    universityActions.flatMap((action) => [
      [actionKey(action, 'title'), action.titleEn],
      [actionKey(action, 'description'), action.actionEn],
      ...(actionPreparation[action.code] ? [[preparationKey(action), actionPreparation[action.code]!.en]] : []),
    ]),
  ),
};
