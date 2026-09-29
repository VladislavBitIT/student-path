import { and, desc, eq, like, ne, sql } from 'drizzle-orm';
import type { Database } from '@first30/database';
import { conversationStates, outbox, users, webhookInbox } from '@first30/database';
import { getUniversityConfig, onboardingFlow, universityDirectory } from '@first30/config';
import {
  answerOnboardingQuestion,
  createOnboardingState,
  getOnboardingQuestion,
  goBackOnboarding,
  isValidIsoDate,
  type AccommodationType,
  type Language,
  type OnboardingQuestion,
  type OnboardingState,
  type LlmAdapter,
  isSupportedLanguage,
  languageChoices,
  toDateOnlyInTimezone,
} from '@first30/domain';
import { t } from '@first30/i18n';
import {
  createAppMenuKeyboard,
  createCallbackKeyboard,
  createOpenAppKeyboard,
  isValidCallbackPayload,
  type NormalizedMaxUpdate,
} from '@first30/max-adapter';
import { AppError } from './errors.js';
import { RouteService } from './route-service.js';

interface BotHandlerOptions {
  miniAppUrl: string;
  maxBotUsername?: string;
  introVideoTokens?: { ru?: string; en?: string };
  llmAdapter?: LlmAdapter;
}

const introFlowId = 'intro_video_v1';
const introGreeting =
  '👋 Путь студента / Student Path\n' +
  'Поможем разобраться с первыми шагами после зачисления и приезда в Россию.\n\n' +
  'We’ll help you navigate your first steps after admission and arrival in Russia.\n\n' +
  'Выберите язык / Choose your language';

const introCopy: Record<
  Language,
  { welcome: string; videoIntro: string; caption: string; open: string; fallback: string; shortcut: string }
> = {
  ru: {
    welcome:
      '😊 Добро пожаловать в «Путь студента»\n' +
      'Сервис поможет после зачисления разобраться с переездом, жильём и первыми делами в университете.\n\n' +
      'Ответьте на несколько вопросов — и получите персональный план действий со ссылками на опубликованные источники.',
    videoIntro: 'Ниже — короткое видео о том, как работает сервис.',
    caption: 'Коротко о «Пути студента». Откройте мини-приложение и составьте свой план.',
    open: 'Открыть мини-приложение',
    fallback: 'Видео пока недоступно. Откройте мини-приложение и составьте свой план.',
    shortcut: 'Откройте мини-приложение, чтобы заполнить профиль и увидеть свой план.',
  },
  en: {
    welcome:
      '😊 Welcome to Student Path\n' +
      'After admission, the service will help you navigate moving, housing and your first tasks at university.\n\n' +
      'Answer a few questions to get a personal action plan with links to published sources.',
    videoIntro: 'Below is a short video showing how the service works.',
    caption: 'A quick look at Student Path. Open the mini app to build your plan.',
    open: 'Open mini app',
    fallback: 'The video is temporarily unavailable. Open the mini app to build your plan.',
    shortcut: 'Open the mini app to complete your profile and see your plan.',
  },
  kk: {
    welcome:
      '😊 «Путь студента» сервисіне қош келдіңіз\n' +
      'Сервис оқуға түскеннен кейін көшу, баспана және университеттегі алғашқы істерді реттеуге көмектеседі.\n\n' +
      'Бірнеше сұраққа жауап беріңіз — жарияланған дереккөздерге сілтемелері бар жеке іс-қимыл жоспарын аласыз.',
    videoIntro: 'Төменде сервистің қалай жұмыс істейтіні туралы қысқаша бейне берілген.',
    caption: 'Бейне ағылшын тілінде. Қолданба интерфейсі қазақ тілінде болады. Жеке жоспарыңызды ашыңыз.',
    open: 'Шағын қолданбаны ашу',
    fallback: 'Бейне әзірге қолжетімсіз. Жоспарыңызды шағын қолданбадан ашыңыз.',
    shortcut: 'Профильді толтырып, жоспарыңызды көру үшін шағын қолданбаны ашыңыз.',
  },
  uz: {
    welcome:
      '😊 «Путь студента» xizmatiga xush kelibsiz\n' +
      'Xizmat o‘qishga qabul qilinganingizdan keyin ko‘chib kelish, turar joy va universitetdagi dastlabki ishlarni tartibga solishga yordam beradi.\n\n' +
      'Bir nechta savolga javob bering — e’lon qilingan manbalarga havolalari bor shaxsiy harakatlar rejasini olasiz.',
    videoIntro: 'Quyida xizmat qanday ishlashi haqida qisqa video bor.',
    caption: 'Video ingliz tilida. Ilova interfeysi o‘zbek tilida bo‘ladi. Shaxsiy rejangizni oching.',
    open: 'Mini-ilovani ochish',
    fallback: 'Video hozircha mavjud emas. Rejangizni mini-ilovada oching.',
    shortcut: 'Profilingizni to‘ldirish va rejangizni ko‘rish uchun mini-ilovani oching.',
  },
  tk: {
    welcome:
      '😊 «Путь студента» hyzmatyna hoş geldiňiz\n' +
      'Bu hyzmat okuwa kabul edileniňizden soň göçüp gelmek, ýaşaýyş jaýy we uniwersitetdäki ilkinji işler bilen bagly meseleleri çözmäge kömek eder.\n\n' +
      'Birnäçe soraga jogap beriň — çap edilen çeşmelere salgylanmalary bolan şahsy hereket meýilnamasyny alarsyňyz.',
    videoIntro: 'Aşakda hyzmatyň nähili işleýändigi barada gysga wideo bar.',
    caption: 'Wideo iňlis dilinde. Programmanyň interfeýsi türkmen dilinde bolar. Şahsy meýilnamaňyzy açyň.',
    open: 'Kiçi programmany açmak',
    fallback: 'Wideo häzir elýeterli däl. Meýilnamaňyzy kiçi programmada açyň.',
    shortcut: 'Profiliňizi dolduryp, meýilnamaňyzy görmek üçin kiçi programmany açyň.',
  },
  'zh-CN': {
    welcome:
      '😊 欢迎使用「Путь студента」\n' +
      '本服务帮助您在被录取后了解搬迁、住宿以及入学初期需要办理的事项。\n\n' +
      '回答几个问题，即可获得附有公开来源链接的个人行动计划。',
    videoIntro: '下方的短视频将介绍如何使用本服务。',
    caption: '视频为英语。小程序界面将使用简体中文。打开您的个人计划。',
    open: '打开小程序',
    fallback: '视频暂时无法播放。请打开小程序查看您的计划。',
    shortcut: '打开小程序填写资料并查看您的计划。',
  },
  hi: {
    welcome:
      '😊 «Путь студента» में आपका स्वागत है\n' +
      'यह सेवा दाखिले के बाद स्थानांतरण, आवास और विश्वविद्यालय में शुरुआती कामों को समझने में आपकी मदद करेगी।\n\n' +
      'कुछ सवालों के जवाब दें — आपको प्रकाशित स्रोतों के लिंक के साथ एक व्यक्तिगत कार्ययोजना मिलेगी।',
    videoIntro: 'नीचे एक छोटा वीडियो है, जिसमें बताया गया है कि यह सेवा कैसे काम करती है।',
    caption: 'वीडियो अंग्रेज़ी में है। मिनी ऐप का इंटरफ़ेस हिंदी में होगा। अपनी योजना खोलें।',
    open: 'मिनी ऐप खोलें',
    fallback: 'वीडियो अभी उपलब्ध नहीं है। अपनी योजना मिनी ऐप में खोलें।',
    shortcut: 'प्रोफ़ाइल भरने और अपनी योजना देखने के लिए मिनी ऐप खोलें।',
  },
};

interface ConversationState extends OnboardingState {
  cancelled: boolean;
}

interface LocalizedRouteStep {
  code: string;
  title: string;
  description: string;
  deadline: string | null;
  preparation: string[];
  contact: string | null;
  source: { title: string; url: string } | null;
  scope: 'general' | 'university';
  status?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
  verificationStatus?: 'verified' | 'demo' | 'needs_confirmation';
}

interface BotRoute {
  progress: { completed: number; total: number; percent: number };
  nextAction: LocalizedRouteStep | null;
  steps?: LocalizedRouteStep[];
}

const copy = {
  ru: {
    ready: 'Ваш план первых дел готов.',
    appWelcome:
      '«Путь студента» помогает после зачисления разобраться с переездом, жильём и первыми делами в университете. Откройте приложение и выберите язык: несколько ответов дадут личный план со ссылками на опубликованные источники. Вузы не проверяли этот план.',
    openApp: 'Открыть приложение',
    invalidDate: 'Дата не подошла. Напишите её сообщением в формате ДД.ММ.ГГГГ, например 24.09.2026.',
    enterDate: 'Написать в чат',
    datePrompt: 'Напишите дату приезда отдельным сообщением в поле ввода внизу чата. Например: 24.09.2026.',
    guide: 'Ваш план уже составлен. Откройте его, чтобы продолжить с ближайшего дела.',
    fallback: 'Я могу показать маршрут, ближайший шаг или найти проверенную информацию.',
    stale: 'Эта кнопка уже не актуальна. Продолжим с текущего шага.',
    menu: 'Главное меню',
    openRoute: 'Открыть план',
    today: 'На сегодня',
    next: 'Ближайший шаг',
    situation: 'Изменилась ситуация',
    ask: 'Задать вопрос',
    human: 'Связаться с человеком',
    reminders: 'Напоминания',
    progress: 'Сколько сделано',
    allDone: 'Все активные шаги завершены.',
    deadline: 'Срок',
    noVerifiedDeadline: 'срок нужно уточнить по официальному источнику',
    askPrompt: 'Напишите вопрос одним сообщением. Я укажу источник и отмечу, что нужно уточнить.',
    situationPrompt: 'Где вы живёте теперь?',
    reminderPrompt: 'Включить или выключить напоминания?',
    sources: 'Источники',
    checkedOn: 'Проверено',
    enabled: 'Напоминания включены.',
    disabled: 'Напоминания выключены.',
    enable: 'Включить',
    disable: 'Выключить',
    backToMenu: 'Меню',
    back: 'Назад',
    cancel: 'Отменить',
    skip: 'Не знаю',
    plannedDateUnknown: 'Пока не знаю',
    genericRoute:
      'Вашего университета пока нет в справочнике. Покажем общие дела; правила своего вуза уточняйте на его официальном сайте.',
    cancelled: 'Заполнение анкеты приостановлено. Отправьте /start, когда будете готовы начать заново.',
    reset: 'Ваши данные удалены. Чтобы начать заново, отправьте /start.',
    invalidAnswer: 'Не удалось принять ответ. Выберите актуальный вариант.',
    scopeGeneral: 'Общее правило',
    scopeUniversity: 'Правило вашего вуза',
    prepare: 'Подготовить',
    officialSource: 'Официальный источник',
    firstAction: 'Первое дело',
    noActive: 'Активных дел сейчас нет.',
    firstRouteGuide:
      'Нажмите «Открыть план». На главной откройте первое дело: там инструкция и ссылка на источник, если она доступна. После выполнения отметьте дело. Если планы изменятся, обновите данные в приложении.',
    remindersAllowed:
      'Напоминания включены. Подтверждённые сроки учитываются автоматически; время можно изменить в разделе «Напоминания» приложения.',
    remindersOffGuide: 'Напоминания выключены. Их можно включить позже в настройках.',
    questionnaireUpdated:
      'Вопросы анкеты изменились. Я сохранил язык и уточню остальные сведения заново, чтобы составить подходящий план.',
    privateHousing: 'Снимаю жильё',
    relativesHousing: 'У родственников',
    confirmChange: 'Подтвердите изменение проживания.',
    changeUpdated: 'Маршрут обновлён. Добавлено: {added}, скрыто: {hidden}.',
    changeCancelled: 'Изменение отменено.',
    generalGuidance: 'Общая ориентировка, не правило вашего университета.',
  },
  en: {
    ready: 'Your plan for the first steps is ready.',
    appWelcome:
      '«Путь студента» helps after admission with moving, housing and first university tasks. Open the app and choose a language: a few answers will give you a personal plan linked to public sources. Universities have not reviewed this plan.',
    openApp: 'Open the app',
    invalidDate: 'That date does not look right. Send it as DD.MM.YYYY, for example 24.09.2026.',
    enterDate: 'Type in chat',
    datePrompt: 'Type your arrival date in the message field at the bottom of this chat. For example: 24.09.2026.',
    guide: 'Your plan is ready. Open it to continue with your next action.',
    fallback: 'I can show your route, next action, or find verified information.',
    stale: 'That button is no longer current. Let us continue from your current step.',
    menu: 'Main menu',
    openRoute: 'Open my plan',
    today: 'Today',
    next: 'Next action',
    situation: 'Situation changed',
    ask: 'Ask a question',
    human: 'Contact a human',
    reminders: 'Reminder settings',
    progress: 'Progress',
    allDone: 'All active steps are complete.',
    deadline: 'Deadline',
    noVerifiedDeadline: 'confirm the deadline using the official source',
    askPrompt: 'Send your question in one message. I will show the source and note what needs confirmation.',
    situationPrompt: 'Where are you living now?',
    reminderPrompt: 'Would you like to enable or disable reminders?',
    sources: 'Sources',
    checkedOn: 'Checked on',
    enabled: 'Reminders are enabled.',
    disabled: 'Reminders are disabled.',
    enable: 'Enable',
    disable: 'Disable',
    backToMenu: 'Menu',
    back: 'Back',
    cancel: 'Cancel',
    skip: "I don't know",
    plannedDateUnknown: 'Not sure yet',
    genericRoute:
      'Your university is not in the directory yet. We will show general steps; check university-specific rules on its official site.',
    cancelled: 'The questionnaire is paused. Send /start when you are ready to begin again.',
    reset: 'Your data has been deleted. Send /start to begin again.',
    invalidAnswer: 'I could not accept that answer. Choose an option from the current question.',
    scopeGeneral: 'General rule',
    scopeUniversity: 'Your university',
    prepare: 'Prepare',
    officialSource: 'Official source',
    firstAction: 'First action',
    noActive: 'There are no active actions right now.',
    firstRouteGuide:
      'Tap “Open my plan”. On the home screen, open the first action for instructions and a source link if one is available. Mark it done when you finish. If your plans change, update your details in the app.',
    remindersAllowed:
      'Reminders are on. Confirmed deadlines are scheduled automatically; change the time in the app’s Reminders section.',
    remindersOffGuide: 'Reminders are off. You can enable them later in Settings.',
    questionnaireUpdated:
      'The questionnaire has changed. I kept your language and will ask the remaining details again for a suitable plan.',
    privateHousing: 'Private housing',
    relativesHousing: 'With relatives',
    confirmChange: 'Confirm the accommodation change.',
    changeUpdated: 'Route updated. Added: {added}, hidden: {hidden}.',
    changeCancelled: 'Change cancelled.',
    generalGuidance: 'General guidance, not a rule of your university.',
  },
  kk: {
    ready: 'Алғашқы істеріңіздің жоспары дайын.',
    appWelcome:
      '«Путь студента» оқуға түскеннен кейін көшу, тұрғын жер және университеттегі алғашқы істерді түсінуге көмектеседі. Қолданбаны ашып, тілді таңдаңыз: бірнеше жауаптан кейін ашық дереккөздерге сілтемелері бар жеке жоспар аласыз. Университеттер бұл жоспарды тексермеген.',
    openApp: 'Қолданбаны ашу',
    invalidDate: 'Күн дұрыс емес. Оны 24.09.2026 үлгісінде хабарлама етіп жіберіңіз.',
    enterDate: 'Чатқа жазу',
    datePrompt: 'Келетін күніңізді чатқа жеке хабарлама етіп жазыңыз. Мысалы: 24.09.2026.',
    guide: 'Жоспарыңыз дайын. Келесі істі көру үшін оны ашыңыз.',
    fallback: 'Мен бағытыңызды, келесі істі көрсете аламын немесе дереккөздерден жауап іздеймін.',
    stale: 'Бұл түйме ескірді. Қазіргі қадамнан жалғастырайық.',
    menu: 'Басты мәзір',
    openRoute: 'Жоспарды ашу',
    today: 'Бүгін',
    next: 'Келесі іс',
    situation: 'Жағдай өзгерді',
    ask: 'Сұрақ қою',
    human: 'Адаммен байланысу',
    reminders: 'Еске салғыштар',
    progress: 'Орындалғаны',
    allDone: 'Барлық белсенді істер аяқталды.',
    deadline: 'Мерзім',
    noVerifiedDeadline: 'мерзімді ресми дереккөзден нақтылаңыз',
    askPrompt: 'Сұрағыңызды бір хабарламада жазыңыз.',
    situationPrompt: 'Қазір қайда тұрасыз?',
    reminderPrompt: 'Еске салғыштарды қосу керек пе?',
    sources: 'Дереккөздер',
    checkedOn: 'Тексерілген күн',
    enabled: 'Еске салғыштар қосылды.',
    disabled: 'Еске салғыштар өшірілді.',
    enable: 'Қосу',
    disable: 'Өшіру',
    backToMenu: 'Мәзір',
    back: 'Артқа',
    cancel: 'Бас тарту',
    skip: 'Білмеймін',
    plannedDateUnknown: 'Әзірге білмеймін',
    genericRoute:
      'Университетіңіз әзірге тізімде жоқ. Жалпы қадамдарды көрсетеміз; өз университетіңіздің ережелерін ресми сайтынан тексеріңіз.',
    cancelled: 'Сауалнама тоқтатылды. Қайта бастау үшін /start жіберіңіз.',
    reset: 'Деректеріңіз жойылды. Қайта бастау үшін /start жіберіңіз.',
    invalidAnswer: 'Жауап қабылданбады. Қазіргі сұрақтағы нұсқаны таңдаңыз.',
    scopeGeneral: 'Жалпы ереже',
    scopeUniversity: 'Университетіңіздің ережесі',
    prepare: 'Дайындау',
    officialSource: 'Ресми дереккөз',
    firstAction: 'Алғашқы іс',
    noActive: 'Қазір белсенді іс жоқ.',
    firstRouteGuide:
      '«Жоспарды ашу» түймесін басыңыз. Басты беттегі алғашқы істі ашып, нұсқаулықты және бар болса дереккөз сілтемесін қараңыз. Орындаған соң белгілеңіз. Жоспарыңыз өзгерсе, деректерді жаңартыңыз.',
    remindersAllowed:
      'Еске салғыштар қосылды. Расталған мерзімдер автоматты ескеріледі; уақытын қолданбаның «Еске салғыштар» бөлімінде өзгертіңіз.',
    remindersOffGuide: 'Еске салғыштар өшірілген. Оларды кейін баптаулардан қоса аласыз.',
    questionnaireUpdated:
      'Сауалнама өзгерді. Тілді сақтадым; сәйкес жоспар жасау үшін қалған деректерді қайта сұраймын.',
    privateHousing: 'Жеке үйде тұрамын',
    relativesHousing: 'Туыстарымның үйінде',
    confirmChange: 'Тұратын жердің өзгергенін растаңыз.',
    changeUpdated: 'Жоспар жаңартылды. Қосылды: {added}, жасырылды: {hidden}.',
    changeCancelled: 'Өзгеріс болдырылмады.',
    generalGuidance: 'Жалпы ақпарат, университетіңіздің ережесі емес.',
  },
  uz: {
    ready: 'Dastlabki ishlaringiz rejasi tayyor.',
    appWelcome:
      '«Путь студента» qabuldan keyin ko‘chish, turar joy va universitetdagi dastlabki ishlarni tushunishga yordam beradi. Ilovani ochib, tilni tanlang: bir necha javobdan so‘ng ochiq manbalarga havolali shaxsiy reja olasiz. Universitetlar bu rejani tekshirmagan.',
    openApp: 'Ilovani ochish',
    invalidDate: 'Sana noto‘g‘ri. Uni 24.09.2026 shaklida xabar qilib yuboring.',
    enterDate: 'Chatga yozish',
    datePrompt: 'Kelish sanangizni chatga alohida xabar qilib yozing. Masalan: 24.09.2026.',
    guide: 'Rejangiz tayyor. Keyingi ishni ko‘rish uchun uni oching.',
    fallback: 'Men rejangizni va keyingi ishni ko‘rsata olaman yoki manbalardan javob izlayman.',
    stale: 'Bu tugma eskirgan. Joriy qadamdan davom etamiz.',
    menu: 'Asosiy menyu',
    openRoute: 'Rejani ochish',
    today: 'Bugun',
    next: 'Keyingi ish',
    situation: 'Vaziyat o‘zgardi',
    ask: 'Savol berish',
    human: 'Xodimga murojaat',
    reminders: 'Eslatmalar',
    progress: 'Bajarilgan ishlar',
    allDone: 'Barcha faol ishlar bajarildi.',
    deadline: 'Muddat',
    noVerifiedDeadline: 'muddatni rasmiy manbadan aniqlang',
    askPrompt: 'Savolingizni bitta xabarda yozing.',
    situationPrompt: 'Hozir qayerda yashaysiz?',
    reminderPrompt: 'Eslatmalarni yoqasizmi?',
    sources: 'Manbalar',
    checkedOn: 'Tekshirilgan sana',
    enabled: 'Eslatmalar yoqildi.',
    disabled: 'Eslatmalar o‘chirildi.',
    enable: 'Yoqish',
    disable: 'O‘chirish',
    backToMenu: 'Menyu',
    back: 'Orqaga',
    cancel: 'Bekor qilish',
    skip: 'Bilmayman',
    plannedDateUnknown: 'Hozircha bilmayman',
    genericRoute:
      'Universitetingiz hali ro‘yxatda yo‘q. Umumiy ishlarni ko‘rsatamiz; universitetingiz qoidalarini rasmiy saytida tekshiring.',
    cancelled: 'So‘rovnoma to‘xtatildi. Qayta boshlash uchun /start yuboring.',
    reset: 'Ma’lumotlaringiz o‘chirildi. Qayta boshlash uchun /start yuboring.',
    invalidAnswer: 'Javob qabul qilinmadi. Joriy savoldagi variantni tanlang.',
    scopeGeneral: 'Umumiy qoida',
    scopeUniversity: 'Universitetingiz qoidasi',
    prepare: 'Tayyorlang',
    officialSource: 'Rasmiy manba',
    firstAction: 'Birinchi ish',
    noActive: 'Hozir faol ish yo‘q.',
    firstRouteGuide:
      '“Rejani ochish” tugmasini bosing. Bosh sahifada birinchi ishning yo‘riqnomasi va mavjud bo‘lsa manba havolasini ko‘ring. Bajargach belgilab qo‘ying. Rejangiz o‘zgarsa, ma’lumotlarni yangilang.',
    remindersAllowed:
      'Eslatmalar yoqildi. Tasdiqlangan muddatlar avtomatik belgilanadi; vaqtini ilovaning Eslatmalar bo‘limida o‘zgartiring.',
    remindersOffGuide: 'Eslatmalar o‘chirilgan. Ularni keyin sozlamalarda yoqishingiz mumkin.',
    questionnaireUpdated:
      'So‘rovnoma o‘zgardi. Tilni saqladim; mos reja tuzish uchun qolgan ma’lumotlarni qayta so‘rayman.',
    privateHousing: 'Ijarada yashayman',
    relativesHousing: 'Qarindoshlar bilan',
    confirmChange: 'Turar joy o‘zgarishini tasdiqlang.',
    changeUpdated: 'Reja yangilandi. Qo‘shildi: {added}, yashirildi: {hidden}.',
    changeCancelled: 'O‘zgarish bekor qilindi.',
    generalGuidance: 'Umumiy ma’lumot, universitetingiz qoidasi emas.',
  },
  tk: {
    ready: 'Ilkinji işleriňiziň meýilnamasy taýýar.',
    appWelcome:
      '«Путь студента» okuwa kabul edilenden soň göçmek, ýaşaýyş ýeri we uniwersitetdäki ilkinji işleri düşünmäge kömek edýär. Programmany açyp, dili saýlaň: birnäçe jogapdan soň açyk çeşmelere salgylary bolan şahsy meýilnama alarsyňyz. Uniwersitetler bu meýilnamany barlamady.',
    openApp: 'Programmany açmak',
    invalidDate: 'Sene nädogry. Ony 24.09.2026 görnüşinde habar edip iberiň.',
    enterDate: 'Çata ýazmak',
    datePrompt: 'Geljegiňiz senäni çata aýratyn habar edip ýazyň. Mysal: 24.09.2026.',
    guide: 'Meýilnama taýýar. Indiki işi görmek üçin ony açyň.',
    fallback: 'Men meýilnamaňyzy, indiki işi görkezip ýa-da çeşmelerden jogap gözläp bilerin.',
    stale: 'Bu düwme indi güýjüni ýitirdi. Häzirki ädimden dowam edeliň.',
    menu: 'Baş menýu',
    openRoute: 'Meýilnamany açmak',
    today: 'Şu gün',
    next: 'Indiki iş',
    situation: 'Ýagdaý üýtgedi',
    ask: 'Sorag bermek',
    human: 'Işgär bilen habarlaşmak',
    reminders: 'Ýatlatmalar',
    progress: 'Edilen işler',
    allDone: 'Ähli işjeň işler tamamlandy.',
    deadline: 'Möhlet',
    noVerifiedDeadline: 'möhleti resmi çeşmeden anyklaň',
    askPrompt: 'Soragyňyzy bir habarda ýazyň.',
    situationPrompt: 'Häzir nirede ýaşaýarsyňyz?',
    reminderPrompt: 'Ýatlatmalary açmalymy?',
    sources: 'Çeşmeler',
    checkedOn: 'Barlanan senesi',
    enabled: 'Ýatlatmalar açyldy.',
    disabled: 'Ýatlatmalar öçürildi.',
    enable: 'Açmak',
    disable: 'Öçürmek',
    backToMenu: 'Menýu',
    back: 'Yza',
    cancel: 'Ýatyrmak',
    skip: 'Bilmeýärin',
    plannedDateUnknown: 'Entek bilemok',
    genericRoute:
      'Uniwersitetiňiz entek sanawda ýok. Umumy ädimleri görkezeris; öz uniwersitetiňiziň düzgünlerini resmi sahypasyndan barlaň.',
    cancelled: 'Soragnama togtadyldy. Täzeden başlamak üçin /start iberiň.',
    reset: 'Maglumatlaryňyz öçürildi. Täzeden başlamak üçin /start iberiň.',
    invalidAnswer: 'Jogap kabul edilmedi. Häzirki soragdaky warianty saýlaň.',
    scopeGeneral: 'Umumy düzgün',
    scopeUniversity: 'Uniwersitetiňiziň düzgüni',
    prepare: 'Taýýarlamaly',
    officialSource: 'Resmi çeşme',
    firstAction: 'Ilkinji iş',
    noActive: 'Häzir işjeň iş ýok.',
    firstRouteGuide:
      '«Meýilnamany açmak» düwmesine basyň. Baş sahypadaky ilkinji işi açyp, görkezmäni we bar bolsa çeşme salgysyny görüň. Edenden soň belläň. Meýilnamaňyz üýtgese, maglumatlary täzeläň.',
    remindersAllowed:
      'Ýatlatmalar açyldy. Tassyklanan möhletler awtomatik bellenýär; wagty programmanyň Ýatlatmalar bölüminde üýtgediň.',
    remindersOffGuide: 'Ýatlatmalar öçürilen. Olary soň sazlamalarda açyp bilersiňiz.',
    questionnaireUpdated:
      'Soragnama üýtgedi. Diliňizi sakladym; laýyk meýilnama üçin galan maglumatlary täzeden soraryn.',
    privateHousing: 'Kärendesine ýaşaýaryn',
    relativesHousing: 'Garyndaşlaryň ýanynda',
    confirmChange: 'Ýaşaýan ýeriňiziň üýtgändigini tassyklaň.',
    changeUpdated: 'Meýilnama täzelendi. Goşuldy: {added}, gizlendi: {hidden}.',
    changeCancelled: 'Üýtgeşme ýatyryldy.',
    generalGuidance: 'Umumy maglumat, uniwersitetiňiziň düzgüni däl.',
  },
  'zh-CN': {
    ready: '您的入学后行动计划已准备好。',
    appWelcome:
      '“Путь студента”帮助您在录取后了解搬迁、住宿和大学里的首要事项。打开应用并选择语言，回答几个问题即可获得附有公开来源链接的个人计划。大学尚未审核此计划。',
    openApp: '打开应用',
    invalidDate: '日期无效。请按 24.09.2026 的格式发送。',
    enterDate: '在聊天中输入',
    datePrompt: '请在聊天输入框单独发送抵达日期，例如 24.09.2026。',
    guide: '您的计划已准备好。打开计划查看下一步。',
    fallback: '我可以显示您的计划、下一步，或从资料中查找答案。',
    stale: '此按钮已失效。请从当前步骤继续。',
    menu: '主菜单',
    openRoute: '打开计划',
    today: '今日',
    next: '下一步',
    situation: '情况有变',
    ask: '提问',
    human: '联系工作人员',
    reminders: '提醒',
    progress: '完成进度',
    allDone: '所有当前步骤均已完成。',
    deadline: '期限',
    noVerifiedDeadline: '请通过官方来源确认期限',
    askPrompt: '请将问题写在一条消息中。',
    situationPrompt: '您目前住在哪里？',
    reminderPrompt: '要开启提醒吗？',
    sources: '来源',
    checkedOn: '核查日期',
    enabled: '提醒已开启。',
    disabled: '提醒已关闭。',
    enable: '开启',
    disable: '关闭',
    backToMenu: '菜单',
    back: '返回',
    cancel: '取消',
    skip: '不知道',
    plannedDateUnknown: '暂不确定',
    genericRoute: '您的大学暂未列入目录。我们会显示通用步骤；请在大学官方网站核实具体规定。',
    cancelled: '问卷已暂停。发送 /start 可重新开始。',
    reset: '您的数据已删除。发送 /start 可重新开始。',
    invalidAnswer: '无法接受该回答。请选择当前问题提供的选项。',
    scopeGeneral: '通用规定',
    scopeUniversity: '您大学的规定',
    prepare: '需要准备',
    officialSource: '官方来源',
    firstAction: '第一件事',
    noActive: '目前没有待办步骤。',
    firstRouteGuide:
      '点击“打开计划”。在首页打开第一步，查看说明和可用的来源链接。完成后标记为已完成；情况变化时请在应用中更新资料。',
    remindersAllowed: '提醒已开启。已确认的截止时间会自动设置提醒；可在应用的“提醒”页面修改时间。',
    remindersOffGuide: '提醒已关闭。您可以稍后在设置中开启。',
    questionnaireUpdated: '问卷已更新。您的语言选择已保留；我会重新询问其他信息，以制定适合您的计划。',
    privateHousing: '租住私人住房',
    relativesHousing: '住在亲属家',
    confirmChange: '请确认住宿情况的变更。',
    changeUpdated: '计划已更新。新增 {added} 项，隐藏 {hidden} 项。',
    changeCancelled: '变更已取消。',
    generalGuidance: '通用参考，不是您大学的规定。',
  },
  hi: {
    ready: 'आपके शुरुआती कामों की योजना तैयार है।',
    appWelcome:
      '«Путь студента» दाखिले के बाद शहर बदलने, रहने की जगह और विश्वविद्यालय के शुरुआती काम समझने में मदद करता है। ऐप खोलकर भाषा चुनें: कुछ जवाबों से सार्वजनिक स्रोतों के लिंक वाली निजी योजना मिलेगी। विश्वविद्यालयों ने इस योजना की समीक्षा नहीं की है।',
    openApp: 'ऐप खोलें',
    invalidDate: 'तारीख सही नहीं है। इसे 24.09.2026 के रूप में संदेश भेजें।',
    enterDate: 'चैट में लिखें',
    datePrompt: 'आने की तारीख चैट में अलग संदेश के रूप में लिखें। उदाहरण: 24.09.2026।',
    guide: 'आपकी योजना तैयार है। अगला काम देखने के लिए इसे खोलें।',
    fallback: 'मैं आपकी योजना और अगला काम दिखा सकता हूँ या स्रोतों में उत्तर खोज सकता हूँ।',
    stale: 'यह बटन अब पुराना है। मौजूदा चरण से आगे बढ़ें।',
    menu: 'मुख्य मेनू',
    openRoute: 'योजना खोलें',
    today: 'आज',
    next: 'अगला काम',
    situation: 'स्थिति बदली',
    ask: 'सवाल पूछें',
    human: 'कर्मचारी से संपर्क करें',
    reminders: 'याद दिलाने वाले संदेश',
    progress: 'पूरे हुए काम',
    allDone: 'सभी सक्रिय काम पूरे हो गए हैं।',
    deadline: 'समय-सीमा',
    noVerifiedDeadline: 'आधिकारिक स्रोत से समय-सीमा की पुष्टि करें',
    askPrompt: 'अपना सवाल एक संदेश में लिखें।',
    situationPrompt: 'आप अभी कहाँ रहते हैं?',
    reminderPrompt: 'क्या याद दिलाने वाले संदेश चालू करें?',
    sources: 'स्रोत',
    checkedOn: 'जाँच की तारीख',
    enabled: 'संदेश चालू हैं।',
    disabled: 'संदेश बंद हैं।',
    enable: 'चालू करें',
    disable: 'बंद करें',
    backToMenu: 'मेनू',
    back: 'पीछे',
    cancel: 'रद्द करें',
    skip: 'पता नहीं',
    plannedDateUnknown: 'अभी पता नहीं',
    genericRoute:
      'आपका विश्वविद्यालय अभी सूची में नहीं है। हम सामान्य काम दिखाएँगे; अपने विश्वविद्यालय के नियम उसकी आधिकारिक वेबसाइट पर जाँचें।',
    cancelled: 'प्रश्नावली रोक दी गई है। फिर शुरू करने के लिए /start भेजें।',
    reset: 'आपका डेटा हटा दिया गया है। फिर शुरू करने के लिए /start भेजें।',
    invalidAnswer: 'जवाब स्वीकार नहीं हुआ। मौजूदा सवाल का कोई विकल्प चुनें।',
    scopeGeneral: 'सामान्य नियम',
    scopeUniversity: 'आपके विश्वविद्यालय का नियम',
    prepare: 'तैयार करें',
    officialSource: 'आधिकारिक स्रोत',
    firstAction: 'पहला काम',
    noActive: 'इस समय कोई सक्रिय काम नहीं है।',
    firstRouteGuide:
      '“योजना खोलें” दबाएँ। मुख्य पृष्ठ पर पहला काम खोलें और उपलब्ध निर्देश तथा स्रोत लिंक देखें। पूरा होने पर चिह्नित करें। स्थिति बदले तो ऐप में जानकारी बदलें।',
    remindersAllowed:
      'याद दिलाने वाले संदेश चालू हैं। पुष्ट समय-सीमाएँ अपने आप तय होती हैं; ऐप के याद दिलाने वाले संदेश अनुभाग में समय बदलें।',
    remindersOffGuide: 'याद दिलाने वाले संदेश बंद हैं। इन्हें बाद में सेटिंग्स में चालू कर सकते हैं।',
    questionnaireUpdated: 'प्रश्नावली बदल गई है। मैंने आपकी भाषा रखी है और सही योजना के लिए बाकी जानकारी फिर पूछूँगा।',
    privateHousing: 'निजी आवास में रहता हूँ',
    relativesHousing: 'रिश्तेदारों के साथ',
    confirmChange: 'आवास में बदलाव की पुष्टि करें।',
    changeUpdated: 'योजना बदली गई। जोड़े गए: {added}, छिपाए गए: {hidden}।',
    changeCancelled: 'बदलाव रद्द हुआ।',
    generalGuidance: 'सामान्य जानकारी, आपके विश्वविद्यालय का नियम नहीं।',
  },
} as const;

const extra = {
  ru: {
    done: 'Готово',
    completed: 'Дело отмечено выполненным.',
    already: 'Это дело уже выполнено.',
    stale: 'Кнопка устарела: дело изменилось или больше не входит в план.',
    todayNone: 'Дел с подтверждённым сроком на сегодня нет. Откройте актуальный план.',
    humanNone: 'Для вашего вуза нет проверенного контакта. Найдите ответственный отдел на официальном сайте вуза.',
    sourceCheck: 'Источник для уточнения',
    demoScope: 'Ориентир по открытым источникам; уточните применимость',
  },
  en: {
    done: 'Done',
    completed: 'Step marked as completed.',
    already: 'This step is already completed.',
    stale: 'This button is outdated: the step changed or is no longer in your plan.',
    todayNone: 'No steps have a confirmed deadline today. Open your current plan.',
    humanNone:
      'No verified contact is available for your university. Find the relevant office on its official website.',
    sourceCheck: 'Source to check',
    demoScope: 'Guidance from public sources; confirm how it applies to you',
  },
  kk: {
    done: 'Дайын',
    completed: 'Іс орындалды деп белгіленді.',
    already: 'Бұл іс бұрын орындалған.',
    stale: 'Түйме ескірді: іс өзгерді немесе жоспардан шықты.',
    todayNone: 'Бүгінге расталған мерзімі бар іс жоқ. Қазіргі жоспарды ашыңыз.',
    humanNone: 'Университетіңіз үшін расталған байланыс жоқ. Жауапты бөлімді ресми сайтынан іздеңіз.',
    sourceCheck: 'Тексеруге арналған дереккөз',
    demoScope: 'Ашық дереккөздерге негізделген бағдар; сәйкестігін нақтылаңыз',
  },
  uz: {
    done: 'Bajarildi',
    completed: 'Ish bajarildi deb belgilandi.',
    already: 'Bu ish allaqachon bajarilgan.',
    stale: 'Tugma eskirgan: ish o‘zgargan yoki rejadan chiqarilgan.',
    todayNone: 'Bugunga tasdiqlangan muddati bor ish yo‘q. Joriy rejani oching.',
    humanNone: 'Universitetingiz uchun tasdiqlangan aloqa yo‘q. Mas’ul bo‘limni rasmiy saytdan toping.',
    sourceCheck: 'Tekshirish uchun manba',
    demoScope: 'Ochiq manbalarga asoslangan yo‘l-yo‘riq; sizga mosligini aniqlang',
  },
  tk: {
    done: 'Boldy',
    completed: 'Ädim ýerine ýetirildi diýip bellendi.',
    already: 'Bu ädim eýýäm ýerine ýetirildi.',
    stale: 'Düwme köneldi: ädim üýtgedi ýa-da meýilnamada ýok.',
    todayNone: 'Şu gün üçin tassyklanan möhletli ädim ýok. Häzirki meýilnamany açyň.',
    humanNone: 'Uniwersitetiňiz üçin tassyklanan habarlaşma maglumaty ýok. Degişli bölümi resmi saýtdan gözläň.',
    sourceCheck: 'Barlamaly çeşme',
    demoScope: 'Açyk çeşmelere esaslanan ugur; size degişlidigini anyklaň',
  },
  'zh-CN': {
    done: '已完成',
    completed: '该事项已标记为完成。',
    already: '该事项已完成。',
    stale: '此按钮已失效：事项已变化或不在当前计划中。',
    todayNone: '今天没有已确认截止日期的事项。请打开当前计划。',
    humanNone: '暂无你所在大学的已核实联系方式。请在大学官网查找相关部门。',
    sourceCheck: '待核实来源',
    demoScope: '依据公开来源提供的参考信息；请确认是否适用于你',
  },
  hi: {
    done: 'पूरा हुआ',
    completed: 'काम पूरा चिह्नित कर दिया गया।',
    already: 'यह काम पहले ही पूरा हो चुका है।',
    stale: 'यह बटन पुराना है: काम बदल गया है या अब योजना में नहीं है।',
    todayNone: 'आज पुष्ट समय-सीमा वाला कोई काम नहीं है। वर्तमान योजना खोलें।',
    humanNone: 'आपके विश्वविद्यालय का सत्यापित संपर्क उपलब्ध नहीं है। आधिकारिक वेबसाइट पर संबंधित कार्यालय खोजें।',
    sourceCheck: 'जाँच के लिए स्रोत',
    demoScope: 'सार्वजनिक स्रोतों पर आधारित मार्गदर्शन; अपने मामले में पुष्टि करें',
  },
} as const;

export function reminderDoneLabel(language: Language): string {
  return extra[language].done;
}

function configuredQuestion(targetField: string): OnboardingQuestion {
  const question = onboardingFlow.questions.find((item) => item.targetField === targetField);
  if (!question) throw new Error(`Onboarding config has no question for ${targetField}`);
  return question;
}

function configuredOptionLabel(language: Language, question: OnboardingQuestion, value: string): string {
  if (question.targetField === 'preferredLanguage' && isSupportedLanguage(value)) {
    const choice = languageChoices[value];
    return `${choice.flag} ${choice.name}`;
  }
  const option = question.options?.find((item) => item.value === value);
  if (!option) throw new Error(`Onboarding config has no ${value} option for ${question.id}`);
  return t(language, option.labelKey);
}

export function normalizeArrivalDateInput(text: string): string {
  const value = text.trim();
  const localDate = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  const isoDate = localDate ? `${localDate[3]}-${localDate[2]}-${localDate[1]}` : value;
  return isValidIsoDate(isoDate) ? isoDate : value;
}

const questionIds = {
  language: configuredQuestion('preferredLanguage').id,
  arrivalStatus: configuredQuestion('arrivalStatus').id,
  plannedDate: 'ONB_06_PLANNED_DATE',
  entryDate: 'ONB_06_ENTRY_DATE',
  accommodation: configuredQuestion('housingChoice').id,
} as const;

function legacyOnboardingAnswer(payload: string): { questionId: string; answer: string | null } | null {
  if (payload === 'onb_lang_ru' || payload === 'onb_lang_en') {
    return { questionId: questionIds.language, answer: payload.endsWith('_en') ? 'en' : 'ru' };
  }
  if (payload === 'onb_status_preparing' || payload === 'onb_status_arrived') {
    return { questionId: questionIds.arrivalStatus, answer: payload.endsWith('arrived') ? 'arrived' : 'preparing' };
  }
  if (payload.startsWith('onb_home_')) return { questionId: questionIds.accommodation, answer: payload.slice(9) };
  return null;
}

function onboardingCallback(
  payload: string,
):
  | { action: 'answer'; questionId: string; answer: string | null }
  | { action: 'back' | 'cancel' | 'date_prompt'; questionId: string }
  | null {
  const legacy = legacyOnboardingAnswer(payload);
  if (legacy) return { action: 'answer', ...legacy };
  const answer = /^onb_answer:([^:]+):(.*)$/.exec(payload);
  if (answer) {
    return { action: 'answer', questionId: answer[1]!, answer: answer[2] === '__skip__' ? null : answer[2]! };
  }
  const datePrompt = /^onb_date_entry:(ONB_06_(?:PLANNED|ENTRY)_DATE)$/.exec(payload);
  if (datePrompt) return { action: 'date_prompt', questionId: datePrompt[1]! };
  const navigation = /^onb_(back|cancel):([^:]+)$/.exec(payload);
  if (navigation) return { action: navigation[1] as 'back' | 'cancel', questionId: navigation[2]! };
  return null;
}

/** Pure callback/state guard kept public so adapters can contract-test bot flows without MAX. */
export function expectedQuestionIdForCallback(payload: string): string | null {
  return onboardingCallback(payload)?.questionId ?? null;
}

export function isExpectedOnboardingCallback(payload: string, questionId: string | undefined): boolean {
  const expected = expectedQuestionIdForCallback(payload);
  return expected !== null && expected === questionId;
}

export function mainMenuButtonRows(language: Language): Array<Array<{ text: string; payload: string }>> {
  const value = copy[language];
  return [
    [
      { text: value.today, payload: 'menu_today' },
      { text: value.next, payload: 'menu_next' },
    ],
    [{ text: value.situation, payload: 'menu_situation' }],
    [
      { text: value.ask, payload: 'menu_ask' },
      { text: value.human, payload: 'menu_human' },
    ],
    [{ text: value.reminders, payload: 'menu_reminders' }],
  ];
}

function languageFrom(existing: Language, state?: ConversationState): Language {
  const selected = state?.collectedAnswers.preferredLanguage;
  return isSupportedLanguage(selected) ? selected : existing;
}

export function formatNextAction(language: Language, route: BotRoute): string {
  const value = copy[language];
  const next = route.nextAction;
  if (!next) return value.allDone;
  const scope =
    next.verificationStatus && next.verificationStatus !== 'verified'
      ? extra[language].demoScope
      : next.scope === 'general'
        ? value.scopeGeneral
        : value.scopeUniversity;
  const documents = next.preparation.length ? `${value.prepare}: ${next.preparation.join('; ')}` : null;
  const source = next.source
    ? `${next.verificationStatus && next.verificationStatus !== 'verified' ? extra[language].sourceCheck : value.officialSource}: ${next.source.title}\n${next.source.url}`
    : null;
  return [
    `${value.next}: ${next.title}`,
    scope,
    next.description,
    documents,
    next.contact,
    `${value.deadline}: ${(next.verificationStatus && next.verificationStatus !== 'verified' ? null : next.deadline) ?? value.noVerifiedDeadline}`,
    source,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function isCandidateId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isStaleCandidateError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    ['CANDIDATE_NOT_FOUND', 'CANDIDATE_NOT_PENDING', 'CANDIDATE_EXPIRED', 'CANDIDATE_RACE', 'CANDIDATE_STALE'].includes(
      error.code,
    )
  );
}

export class BotUpdateHandler {
  private readonly routeService: RouteService;

  constructor(
    private readonly db: Database,
    private readonly options: BotHandlerOptions,
  ) {
    this.routeService = new RouteService(db, options.llmAdapter);
  }

  private async resetOwnAccount(maxUserId: string, inboxId: string) {
    await this.db.transaction(async (tx) => {
      const user = (await tx.select().from(users).where(eq(users.maxUserId, maxUserId)).limit(1))[0];
      const language = user?.preferredLanguage ?? 'ru';
      // Outbox and inbox do not reference users: remove their personal payloads explicitly.
      await tx.delete(outbox).where(eq(outbox.recipient, maxUserId));
      const inboxUserId = sql<string>`case when ${webhookInbox.payload} ->> 'update_type' = 'message_callback' then ${webhookInbox.payload} #>> '{callback,user,user_id}' else coalesce(${webhookInbox.payload} #>> '{message,sender,user_id}', ${webhookInbox.payload} #>> '{user,user_id}') end`;
      await tx.delete(webhookInbox).where(and(eq(inboxUserId, maxUserId), ne(webhookInbox.id, inboxId)));
      if (user) await tx.delete(users).where(eq(users.id, user.id));
      // Keep only an opaque deduplication marker for this command; the worker marks it processed.
      await tx
        .update(webhookInbox)
        .set({ payload: { reset: true } })
        .where(eq(webhookInbox.id, inboxId));
      await tx.insert(outbox).values({
        sourceType: 'bot_update',
        sourceId: inboxId,
        recipient: maxUserId,
        payload: { kind: 'message', text: copy[language].reset, attachments: [] },
        idempotencyKey: `bot:${inboxId}:reset`,
      });
    });
  }

  private async enqueue(
    userId: string,
    sourceId: string,
    suffix: string,
    text: string,
    attachments: unknown[] = [],
    fallbackText?: string,
  ) {
    const user = (await this.db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!user) return;
    await this.db
      .insert(outbox)
      .values({
        sourceType: 'bot_update',
        sourceId,
        recipient: user.maxUserId,
        payload: { kind: 'message', text: text.slice(0, 4000), attachments, ...(fallbackText ? { fallbackText } : {}) },
        idempotencyKey: `bot:${sourceId}:${suffix}`,
      })
      .onConflictDoNothing();
  }

  private async ack(userId: string, sourceId: string, callbackId: string) {
    const user = (await this.db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
    if (!user) return;
    await this.db
      .insert(outbox)
      .values({
        sourceType: 'callback_ack',
        sourceId,
        recipient: user.maxUserId,
        payload: {
          kind: 'callback_answer',
          callbackId,
          notification: '✓',
        },
        idempotencyKey: `callback-ack:${callbackId}`,
      })
      .onConflictDoNothing();
  }

  private async getState(userId: string): Promise<ConversationState | undefined> {
    const state = (
      await this.db.select().from(conversationStates).where(eq(conversationStates.userId, userId)).limit(1)
    )[0];
    return state
      ? {
          flowId: state.flowId,
          questionId: state.questionId,
          collectedAnswers: state.collectedAnswers as Record<string, string | boolean | null>,
          history: state.history,
          updatedAt: state.updatedAt.toISOString(),
          completed: state.completed,
          cancelled: state.cancelled,
        }
      : undefined;
  }

  private async saveState(userId: string, state: OnboardingState, cancelled = false) {
    const questionId = state.completed ? 'complete' : state.questionId;
    await this.db
      .insert(conversationStates)
      .values({
        userId,
        flowId: state.flowId,
        questionId,
        collectedAnswers: { ...state.collectedAnswers },
        history: [...state.history],
        completed: state.completed,
        cancelled,
      })
      .onConflictDoUpdate({
        target: conversationStates.userId,
        set: {
          flowId: state.flowId,
          questionId,
          collectedAnswers: { ...state.collectedAnswers },
          history: [...state.history],
          completed: state.completed,
          cancelled,
          updatedAt: new Date(state.updatedAt),
        },
      });
  }

  private async start(userId: string, sourceId: string) {
    const state = createOnboardingState(onboardingFlow, new Date().toISOString());
    await this.saveState(userId, state);
    await this.renderOnboardingQuestion(userId, sourceId, 'ru', state, 'start');
  }

  private async showLanguageWelcome(userId: string, sourceId: string) {
    await this.saveState(userId, {
      flowId: introFlowId,
      questionId: 'intro_language',
      collectedAnswers: {},
      history: [],
      updatedAt: new Date().toISOString(),
      completed: false,
    });
    const choices = Object.entries(languageChoices).map(([language, choice]) => ({
      text: `${choice.flag} ${choice.name}`,
      payload: `intro_lang:${language}`,
    }));
    const rows: Array<Array<{ text: string; payload: string }>> = [];
    for (let index = 0; index < choices.length; index += 2) rows.push(choices.slice(index, index + 2));
    await this.enqueue(userId, sourceId, 'intro-language', introGreeting, [createCallbackKeyboard(rows)]);
  }

  private async showIntroAppShortcut(userId: string, sourceId: string, language: Language) {
    await this.enqueue(userId, sourceId, 'intro-app-shortcut', introCopy[language].shortcut, [
      createOpenAppKeyboard(introCopy[language].open, this.options.maxBotUsername ?? 'studyway_test_bot'),
    ]);
  }

  private async sendIntroVideo(userId: string, sourceId: string, language: Language) {
    const selected = introCopy[language];
    const token = this.options.introVideoTokens?.[language === 'ru' ? 'ru' : 'en'];
    const keyboard = createOpenAppKeyboard(selected.open, this.options.maxBotUsername ?? 'studyway_test_bot');
    await this.enqueue(
      userId,
      sourceId,
      'intro-welcome',
      token ? `${selected.welcome}\n\n${selected.videoIntro}` : selected.welcome,
    );
    if (!token) {
      await this.enqueue(userId, sourceId, 'intro-video-fallback', selected.fallback, [keyboard]);
      return;
    }
    await this.enqueue(
      userId,
      sourceId,
      'intro-video',
      selected.caption,
      [{ type: 'video', payload: { token } }, keyboard],
      selected.fallback,
    );
  }

  private async renderOnboardingQuestion(
    userId: string,
    sourceId: string,
    language: Language,
    state: OnboardingState,
    suffix = 'question',
  ): Promise<boolean> {
    const question = getOnboardingQuestion(onboardingFlow, state);
    if (!question) return false;
    const selectedUniversity = universityDirectory.find(
      (entry) => entry.code === state.collectedAnswers.universityCode,
    );
    const options =
      question.targetField === 'campusCode' && selectedUniversity
        ? (question.options ?? []).filter((option) =>
            selectedUniversity.campuses.some((campus) => campus.code === option.value),
          )
        : question.targetField === 'housingChoice' && state.collectedAnswers.arrivalStatus === 'arrived'
          ? (question.options ?? []).filter((option) => option.value !== 'unknown')
          : (question.options ?? []);
    const buttons = options.map((option) => ({
      text:
        question.targetField === 'campusCode'
          ? (selectedUniversity?.campuses.find((campus) => campus.code === option.value)?.[
              language === 'ru' ? 'nameRu' : 'nameEn'
            ] ?? configuredOptionLabel(language, question, option.value))
          : configuredOptionLabel(language, question, option.value),
      payload: `onb_answer:${question.id}:${option.value}`,
    }));
    const rows: Array<Array<{ text: string; payload: string }>> = [];
    for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
    if (question.type === 'date') {
      rows.push([{ text: copy[language].enterDate, payload: `onb_date_entry:${question.id}` }]);
    }
    if (!question.required) {
      rows.push([
        {
          text: question.id === questionIds.plannedDate ? copy[language].plannedDateUnknown : copy[language].skip,
          payload: `onb_answer:${question.id}:__skip__`,
        },
      ]);
    }
    if (state.history.length > 0) {
      rows.push([{ text: copy[language].back, payload: `onb_back:${question.id}` }]);
    }
    const text =
      question.targetField === 'preferredLanguage'
        ? '«Путь студента» помогает после зачисления разобраться с переездом, жильём и первыми делами в университете. Ответьте на несколько простых вопросов — получите личный план со ссылками на опубликованные источники. Вузы не проверяли этот план.\n\n«Путь студента» helps after admission with moving, housing and first university tasks. Answer a few questions for a personal plan based on public sources. Universities have not reviewed this plan.\n\nВыберите язык / Choose a language.'
        : t(language, question.textKey);
    const keyboard = createCallbackKeyboard(rows);
    const attachments =
      question.id === questionIds.language && suffix === 'start'
        ? [
            { type: 'image', payload: { url: new URL('/assets/bot-welcome.jpg', this.options.miniAppUrl).toString() } },
            keyboard,
          ]
        : [keyboard];
    await this.enqueue(userId, sourceId, `${suffix}-${question.id}`, text, attachments);
    return true;
  }

  private async applyOnboardingAnswer(
    userId: string,
    sourceId: string,
    language: Language,
    state: ConversationState,
    answer: string | null,
  ) {
    if (state.questionId === 'ONB_03_CITIZENSHIP') {
      if (answer === 'RU') answer = t(language, 'country.russia');
      if (typeof answer !== 'string' || !/^[\p{L}\p{M} .()'’-]{2,80}$/u.test(answer.trim())) {
        await this.enqueue(userId, sourceId, 'invalid-country', copy[language].invalidAnswer);
        await this.renderOnboardingQuestion(userId, sourceId, language, state, 'retry');
        return;
      }
      answer = answer.trim();
    }
    if (
      state.questionId === 'ONB_02_OTHER_UNIVERSITY' &&
      (typeof answer !== 'string' || answer.trim().length < 2 || answer.trim().length > 120)
    ) {
      await this.enqueue(userId, sourceId, 'invalid-university-name', copy[language].invalidAnswer);
      await this.renderOnboardingQuestion(userId, sourceId, language, state, 'retry');
      return;
    }
    if (
      state.questionId === questionIds.accommodation &&
      answer === 'unknown' &&
      state.collectedAnswers.arrivalStatus === 'arrived'
    ) {
      await this.enqueue(userId, sourceId, 'invalid-housing', copy[language].invalidAnswer);
      await this.renderOnboardingQuestion(userId, sourceId, language, state, 'retry');
      return;
    }
    if (state.questionId === 'ONB_02_CAMPUS' && answer !== null) {
      const university = universityDirectory.find((entry) => entry.code === state.collectedAnswers.universityCode);
      if (!university?.campuses.some((campus) => campus.code === answer)) {
        await this.enqueue(userId, sourceId, 'invalid-campus', copy[language].invalidAnswer);
        await this.renderOnboardingQuestion(userId, sourceId, language, state, 'retry');
        return;
      }
    }
    let transition = answerOnboardingQuestion(onboardingFlow, state, answer, new Date().toISOString());
    if (!transition.accepted) {
      const question = getOnboardingQuestion(onboardingFlow, state);
      await this.enqueue(
        userId,
        sourceId,
        'invalid-onboarding-answer',
        question?.type === 'date' ? copy[language].invalidDate : copy[language].invalidAnswer,
      );
      await this.renderOnboardingQuestion(userId, sourceId, language, state, 'retry');
      return;
    }

    if (state.questionId === 'ONB_02_UNIVERSITY' && transition.accepted) {
      const entry = universityDirectory.find((item) => item.code === answer);
      if (!entry || entry.campuses.length === 1) {
        transition = answerOnboardingQuestion(
          onboardingFlow,
          transition.state,
          entry?.campuses[0]?.code ?? 'main',
          new Date().toISOString(),
        );
      }
    }
    const nextState = transition.state;
    const selectedLanguage = nextState.collectedAnswers.preferredLanguage;
    const nextLanguage: Language = isSupportedLanguage(selectedLanguage) ? selectedLanguage : language;
    if (isSupportedLanguage(selectedLanguage)) {
      await this.routeService.updateLanguage(userId, selectedLanguage);
    }
    if (!nextState.completed) {
      await this.saveState(userId, nextState);
      await this.renderOnboardingQuestion(userId, sourceId, nextLanguage, nextState);
      return;
    }

    const answers = nextState.collectedAnswers;
    const housingChoice = answers.housingChoice;
    const accommodationType =
      housingChoice === 'dormitory' || housingChoice === 'private' || housingChoice === 'relatives'
        ? housingChoice
        : 'unknown';
    const arrivalStatus = answers.arrivalStatus;
    if (
      !isSupportedLanguage(answers.preferredLanguage) ||
      typeof answers.universityCode !== 'string' ||
      !(
        answers.universityCode === 'OTHER' ||
        universityDirectory.some(
          (entry) =>
            entry.code === answers.universityCode &&
            entry.campuses.some((campus) => campus.code === answers.campusCode),
        )
      ) ||
      (answers.citizenshipType !== 'rf' && answers.citizenshipType !== 'foreign') ||
      (arrivalStatus !== 'preparing' && arrivalStatus !== 'arrived') ||
      !['dormitory', 'private', 'relatives', 'hotel', 'other', 'unknown'].includes(String(housingChoice))
    ) {
      await this.enqueue(userId, sourceId, 'invalid-onboarding-state', copy[nextLanguage].invalidAnswer);
      await this.start(userId, sourceId);
      return;
    }
    await this.routeService.onboard(userId, {
      preferredLanguage: answers.preferredLanguage,
      universityCode: answers.universityCode,
      campusCode: String(answers.campusCode),
      facultyCode: typeof answers.facultyCode === 'string' ? answers.facultyCode : null,
      universityName: typeof answers.universityName === 'string' ? answers.universityName.trim() : null,
      citizenshipCountry: String(answers.citizenshipCountry),
      specialStatus: typeof answers.specialStatus === 'string' ? answers.specialStatus : 'unknown',
      citizenshipType: answers.citizenshipType as 'rf' | 'foreign',
      entryMode:
        answers.citizenshipType === 'foreign' &&
        (answers.entryMode === 'visa' || answers.entryMode === 'visa_free' || answers.entryMode === 'already_in_russia')
          ? answers.entryMode
          : 'unknown',
      mobilityStatus:
        answers.mobilityStatus === 'local' || answers.mobilityStatus === 'moving' || answers.mobilityStatus === 'moved'
          ? answers.mobilityStatus
          : 'unknown',
      housingStatus:
        answers.housingStatus === 'confirmed' || answers.housingStatus === 'applied'
          ? answers.housingStatus
          : 'unknown',
      admissionYear:
        answers.admissionYear === '2026' || answers.admissionYear === '2027' ? Number(answers.admissionYear) : null,
      programLevel:
        answers.programLevel === 'bachelor_specialist' ||
        answers.programLevel === 'masters' ||
        answers.programLevel === 'postgraduate'
          ? answers.programLevel
          : 'unknown',
      housingChoice: String(housingChoice),
      arrivalStatus,
      arrivalDate: typeof answers.arrivalDate === 'string' ? answers.arrivalDate : null,
      accommodationType,
    });
    await this.saveState(userId, nextState);
    await this.showFirstRoute(userId, sourceId, nextLanguage, false);
    if (answers.universityCode === 'OTHER')
      await this.enqueue(userId, sourceId, 'generic-route', copy[nextLanguage].genericRoute);
  }

  private async resumeOnboarding(
    userId: string,
    sourceId: string,
    language: Language,
    state: ConversationState,
  ): Promise<boolean> {
    if (
      ['student_onboarding_v1', 'student_onboarding_v2'].includes(state.flowId) &&
      !state.completed &&
      !state.cancelled
    ) {
      const fresh = createOnboardingState(onboardingFlow, new Date().toISOString());
      const oldLanguage = state.collectedAnswers.preferredLanguage;
      const resumed = isSupportedLanguage(oldLanguage)
        ? answerOnboardingQuestion(onboardingFlow, fresh, oldLanguage, new Date().toISOString()).state
        : fresh;
      await this.saveState(userId, resumed);
      await this.enqueue(userId, sourceId, 'onboarding-updated', copy[language].questionnaireUpdated);
      return this.renderOnboardingQuestion(userId, sourceId, language, resumed, 'migrated');
    }
    if (state.completed || state.cancelled || state.flowId !== onboardingFlow.id) return false;
    return this.renderOnboardingQuestion(userId, sourceId, language, state, 'resume');
  }

  private async showFirstRoute(userId: string, sourceId: string, language: Language, remindersEnabled: boolean) {
    const route = (await this.routeService.getRoute(userId)) as BotRoute;
    const first = route.nextAction;
    const value = copy[language];
    const text = [
      value.ready,
      first ? `${value.firstAction}: ${first.title}.` : value.noActive,
      value.firstRouteGuide,
      remindersEnabled ? value.remindersAllowed : value.remindersOffGuide,
    ].join('\n\n');
    await this.enqueue(userId, sourceId, 'first-route', text, [
      { type: 'image', payload: { url: new URL('/assets/bot-plan-ready.jpg', this.options.miniAppUrl).toString() } },
      createOpenAppKeyboard(copy[language].openRoute, this.options.maxBotUsername ?? 'studyway_test_bot'),
    ]);
  }

  private async showMainMenu(userId: string, sourceId: string, language: Language, prefix?: string) {
    const route = (await this.routeService.getRoute(userId)) as BotRoute;
    const value = copy[language];
    const text = [
      prefix,
      value.menu,
      `${value.progress}: ${route.progress.completed}/${route.progress.total} (${route.progress.percent}%)`,
      formatNextAction(language, route),
    ]
      .filter(Boolean)
      .join('\n\n');
    await this.enqueue(userId, sourceId, 'main-menu', text, [
      createAppMenuKeyboard(
        value.openRoute,
        this.options.maxBotUsername ?? 'studyway_test_bot',
        mainMenuButtonRows(language),
      ),
    ]);
  }

  private async staleCallback(
    userId: string,
    sourceId: string,
    language: Language,
    state: ConversationState | undefined,
    hasProfile: boolean,
  ) {
    await this.enqueue(userId, sourceId, 'stale', copy[language].stale);
    if (state && (await this.resumeOnboarding(userId, sourceId, language, state))) return;
    if (hasProfile) {
      await this.showMainMenu(userId, sourceId, language);
      return;
    }
    if (state?.flowId === introFlowId && state.completed) {
      await this.showIntroAppShortcut(userId, sourceId, language);
    } else {
      await this.showLanguageWelcome(userId, sourceId);
    }
  }

  private async handleMenuAction(userId: string, sourceId: string, language: Language, payload: string) {
    const value = copy[language];
    if (payload === 'menu_today' || payload === 'menu_next') {
      const route = (await this.routeService.getRoute(userId)) as BotRoute;
      const heading = payload === 'menu_today' ? value.today : value.next;
      let message = formatNextAction(language, route);
      let stepCode = route.nextAction?.code;
      if (payload === 'menu_today') {
        const profile = await this.routeService.getProfile(userId);
        const today = toDateOnlyInTimezone(
          new Date(),
          getUniversityConfig(profile.profile?.universityCode ?? '')?.timezone ?? 'Europe/Moscow',
        );
        const due = (route.steps ?? []).filter(
          (step) => step.status !== 'COMPLETED' && step.verificationStatus === 'verified' && step.deadline === today,
        );
        message = due.length
          ? due.map((step) => formatNextAction(language, { ...route, nextAction: step })).join('\n\n')
          : extra[language].todayNone;
        stepCode = due[0]?.code;
      }
      await this.enqueue(userId, sourceId, payload, `${heading}\n\n${message}`, [
        createAppMenuKeyboard(
          value.openRoute,
          this.options.maxBotUsername ?? 'studyway_test_bot',
          [[{ text: value.backToMenu, payload: 'menu_main' }]],
          stepCode,
        ),
      ]);
      return true;
    }
    if (payload === 'menu_situation') {
      await this.enqueue(userId, sourceId, 'situation-options', value.situationPrompt, [
        createCallbackKeyboard([
          [
            { text: t(language, 'accommodation.dormitory'), payload: 'situation_dormitory' },
            { text: value.privateHousing, payload: 'situation_private' },
          ],
          [{ text: value.relativesHousing, payload: 'situation_relatives' }],
          [{ text: value.backToMenu, payload: 'menu_main' }],
        ]),
      ]);
      return true;
    }
    if (payload === 'menu_ask') {
      await this.enqueue(userId, sourceId, 'ask-prompt', value.askPrompt, [
        createCallbackKeyboard([[{ text: value.backToMenu, payload: 'menu_main' }]]),
      ]);
      return true;
    }
    if (payload === 'menu_human') {
      const profile = await this.routeService.getProfile(userId);
      const contact = getUniversityConfig(profile.profile?.universityCode ?? '')?.officialContact;
      if (!contact || ![contact.email, contact.phone, contact.url].some(Boolean)) {
        await this.enqueue(userId, sourceId, 'human-contact-missing', extra[language].humanNone, [
          createAppMenuKeyboard(value.openRoute, this.options.maxBotUsername ?? 'studyway_test_bot', [
            [{ text: value.backToMenu, payload: 'menu_main' }],
          ]),
        ]);
        return true;
      }
      await this.enqueue(
        userId,
        sourceId,
        'human-contact',
        [t(language, contact.instructionKey), contact.email, contact.phone, contact.url].filter(Boolean).join('\n'),
        [createCallbackKeyboard([[{ text: value.backToMenu, payload: 'menu_main' }]])],
      );
      return true;
    }
    if (payload === 'menu_reminders') {
      const profile = await this.routeService.getProfile(userId);
      const status = profile.profile?.remindersEnabled ? value.enabled : value.disabled;
      await this.enqueue(userId, sourceId, 'reminder-settings', `${status}\n\n${value.reminderPrompt}`, [
        createCallbackKeyboard([
          [
            { text: value.enable, payload: 'reminders_enable' },
            { text: value.disable, payload: 'reminders_disable' },
          ],
          [{ text: value.backToMenu, payload: 'menu_main' }],
        ]),
      ]);
      return true;
    }
    if (payload === 'reminders_enable' || payload === 'reminders_disable') {
      const enabled = payload === 'reminders_enable';
      await this.routeService.setReminderConsent(userId, enabled);
      await this.showMainMenu(userId, sourceId, language, enabled ? value.enabled : value.disabled);
      return true;
    }
    if (payload === 'menu_main') {
      await this.showMainMenu(userId, sourceId, language);
      return true;
    }
    return false;
  }

  async handle(update: NormalizedMaxUpdate, inboxId: string): Promise<void> {
    if (!update.userId) return;
    if (update.type === 'message_created' && update.text?.trim() === '/reset') {
      await this.resetOwnAccount(update.userId, inboxId);
      return;
    }
    if (update.type === 'bot_stopped') {
      const existingUser = (await this.db.select().from(users).where(eq(users.maxUserId, update.userId)).limit(1))[0];
      if (!existingUser) return;
      const profile = await this.routeService.getProfile(existingUser.id);
      if (profile.profile?.remindersEnabled) {
        await this.routeService.setReminderConsent(existingUser.id, false);
      }
      return;
    }
    const existingUser = await this.routeService.ensureUser(update.userId);
    const sourceId = inboxId;
    if (update.callbackId) await this.ack(existingUser.id, sourceId, update.callbackId);

    let state = await this.getState(existingUser.id);
    const profileResult = await this.routeService.getProfile(existingUser.id);
    const hasProfile = Boolean(profileResult.profile);
    let language = languageFrom(existingUser.preferredLanguage, state);

    if (update.type === 'bot_started' || update.text?.trim() === '/start') {
      await this.db.select().from(users).where(eq(users.id, existingUser.id)).limit(1).for('update');
      await this.showLanguageWelcome(existingUser.id, sourceId);
      return;
    }

    if (
      state &&
      !hasProfile &&
      !state.completed &&
      !state.cancelled &&
      state.flowId !== onboardingFlow.id &&
      state.flowId !== introFlowId
    ) {
      await this.resumeOnboarding(existingUser.id, sourceId, language, state);
      return;
    }

    if (update.callbackPayload) {
      const payload = update.callbackPayload;
      if (payload.startsWith('intro_lang:')) {
        const selectedLanguage = payload.slice('intro_lang:'.length);
        if (!isSupportedLanguage(selectedLanguage)) {
          await this.enqueue(existingUser.id, sourceId, 'invalid-language', copy[language].fallback);
          return;
        }
        // The inbox handler runs in a transaction; consume each explicit start once.
        await this.db.select().from(users).where(eq(users.id, existingUser.id)).limit(1).for('update');
        state = await this.getState(existingUser.id);
        if (state?.flowId !== introFlowId || state.completed || state.cancelled) return;
        await this.routeService.updateLanguage(existingUser.id, selectedLanguage);
        await this.saveState(existingUser.id, {
          flowId: introFlowId,
          questionId: 'complete',
          collectedAnswers: { preferredLanguage: selectedLanguage },
          history: [],
          updatedAt: new Date().toISOString(),
          completed: true,
        });
        await this.sendIntroVideo(existingUser.id, sourceId, selectedLanguage);
        return;
      }
      if (
        !hasProfile &&
        payload.startsWith('onb_lang_') &&
        (!state || state.cancelled || (state.flowId === introFlowId && !state.completed))
      ) {
        state = { ...createOnboardingState(onboardingFlow, new Date().toISOString()), cancelled: false };
        await this.saveState(existingUser.id, state);
      }
      if (!isValidCallbackPayload(payload)) {
        await this.enqueue(existingUser.id, sourceId, 'invalid-callback', copy[language].fallback);
        return;
      }

      const onboardingAction = onboardingCallback(payload);
      const expectedQuestionId = onboardingAction?.questionId ?? null;
      if (expectedQuestionId && !isExpectedOnboardingCallback(payload, state?.questionId)) {
        await this.staleCallback(existingUser.id, sourceId, language, state, hasProfile);
        return;
      }

      if (onboardingAction) {
        if (!state || state.completed || state.cancelled) {
          await this.staleCallback(existingUser.id, sourceId, language, state, hasProfile);
          return;
        }
        if (onboardingAction.action === 'cancel') {
          await this.saveState(existingUser.id, state, true);
          await this.enqueue(existingUser.id, sourceId, 'onboarding-cancelled', copy[language].cancelled);
          return;
        }
        if (onboardingAction.action === 'date_prompt') {
          await this.enqueue(existingUser.id, sourceId, 'date-prompt', copy[language].datePrompt);
          return;
        }
        if (onboardingAction.action === 'back') {
          let previous = goBackOnboarding(onboardingFlow, state, new Date().toISOString());
          const university = universityDirectory.find((item) => item.code === previous.collectedAnswers.universityCode);
          if (previous.questionId === 'ONB_02_CAMPUS' && (!university || university.campuses.length === 1)) {
            previous = goBackOnboarding(onboardingFlow, previous, new Date().toISOString());
          }
          if (previous.questionId === 'ONB_02_UNIVERSITY') {
            const { campusCode: _campusCode, ...remainingAnswers } = previous.collectedAnswers;
            previous = { ...previous, collectedAnswers: remainingAnswers };
          }
          await this.saveState(existingUser.id, previous);
          await this.renderOnboardingQuestion(
            existingUser.id,
            sourceId,
            languageFrom(existingUser.preferredLanguage, { ...state, ...previous, cancelled: false }),
            previous,
            'back',
          );
          return;
        }
        if (onboardingAction.action === 'answer') {
          await this.applyOnboardingAnswer(existingUser.id, sourceId, language, state, onboardingAction.answer);
        }
        return;
      }

      if (!hasProfile) {
        await this.staleCallback(existingUser.id, sourceId, language, state, false);
        return;
      }

      if (payload.startsWith('reminder_done:')) {
        const parts = /^reminder_done:([0-9a-f-]{36}):([0-9a-f-]{36}):(\d+)$/.exec(payload);
        const outcome =
          parts && isCandidateId(parts[1]!) && isCandidateId(parts[2]!)
            ? await this.routeService.completeReminderStep(existingUser.id, parts[1]!, parts[2]!, Number(parts[3]))
            : 'stale';
        const text =
          outcome === 'completed'
            ? extra[language].completed
            : outcome === 'already'
              ? extra[language].already
              : extra[language].stale;
        await this.showMainMenu(existingUser.id, sourceId, language, text);
        return;
      }

      if (await this.handleMenuAction(existingUser.id, sourceId, language, payload)) return;

      if (payload === 'situation_private' || payload === 'situation_dormitory' || payload === 'situation_relatives') {
        const accommodationType = payload.slice('situation_'.length) as AccommodationType;
        const candidate = await this.routeService.createEventCandidate(existingUser.id, accommodationType);
        await this.enqueue(existingUser.id, sourceId, 'candidate', copy[language].confirmChange, [
          createCallbackKeyboard([
            [
              {
                text: t(language, 'common.confirm'),
                payload: `event_confirm:${candidate.id}`,
              },
              { text: t(language, 'common.cancel'), payload: `event_cancel:${candidate.id}` },
            ],
          ]),
        ]);
        return;
      }
      if (payload.startsWith('event_confirm:')) {
        const candidateId = payload.slice('event_confirm:'.length);
        if (!isCandidateId(candidateId)) {
          await this.staleCallback(existingUser.id, sourceId, language, state, true);
          return;
        }
        let result: Awaited<ReturnType<RouteService['confirmEventCandidate']>>;
        try {
          result = await this.routeService.confirmEventCandidate(existingUser.id, candidateId);
        } catch (error) {
          if (!isStaleCandidateError(error)) throw error;
          await this.staleCallback(existingUser.id, sourceId, language, state, true);
          return;
        }
        if (result.alreadyConfirmed) {
          await this.staleCallback(existingUser.id, sourceId, language, state, true);
          return;
        }
        await this.showMainMenu(
          existingUser.id,
          sourceId,
          language,
          copy[language].changeUpdated
            .replace('{added}', String(result.diff.added.length))
            .replace('{hidden}', String(result.diff.deactivated.length)),
        );
        return;
      }
      if (payload.startsWith('event_cancel:')) {
        const candidateId = payload.slice('event_cancel:'.length);
        if (!isCandidateId(candidateId)) {
          await this.staleCallback(existingUser.id, sourceId, language, state, true);
          return;
        }
        try {
          await this.routeService.cancelEventCandidate(existingUser.id, candidateId);
        } catch (error) {
          if (!isStaleCandidateError(error)) throw error;
          await this.staleCallback(existingUser.id, sourceId, language, state, true);
          return;
        }
        await this.showMainMenu(existingUser.id, sourceId, language, copy[language].changeCancelled);
        return;
      }

      await this.enqueue(existingUser.id, sourceId, 'unknown-callback', copy[language].fallback, [
        createCallbackKeyboard([[{ text: copy[language].backToMenu, payload: 'menu_main' }]]),
      ]);
      return;
    }

    state = await this.getState(existingUser.id);
    language = languageFrom(existingUser.preferredLanguage, state);
    if (state && !state.completed && !state.cancelled && update.text?.trim() === '/cancel') {
      await this.saveState(existingUser.id, state, true);
      await this.enqueue(existingUser.id, sourceId, 'onboarding-cancelled', copy[language].cancelled);
      return;
    }

    const currentQuestion = state && !state.cancelled ? getOnboardingQuestion(onboardingFlow, state) : null;
    if (
      state &&
      currentQuestion &&
      update.text &&
      (currentQuestion.type === 'date' || currentQuestion.type === 'text')
    ) {
      await this.applyOnboardingAnswer(
        existingUser.id,
        sourceId,
        language,
        state,
        currentQuestion.type === 'date' ? normalizeArrivalDateInput(update.text) : update.text.trim(),
      );
      return;
    }

    if (state && state.flowId !== introFlowId && !state.completed && !state.cancelled) {
      await this.enqueue(existingUser.id, sourceId, 'onboarding-resume', copy[language].stale);
      if (await this.resumeOnboarding(existingUser.id, sourceId, language, state)) return;
    }

    if (update.text && hasProfile) {
      const previous = (
        await this.db
          .select({ payload: outbox.payload })
          .from(outbox)
          .where(and(eq(outbox.recipient, existingUser.maxUserId), like(outbox.idempotencyKey, 'bot:%:knowledge')))
          .orderBy(desc(outbox.createdAt))
          .limit(1)
      )[0];
      const previousAnswer =
        typeof previous?.payload.text === 'string' ? previous.payload.text.slice(0, 700) : undefined;
      const answer = await this.routeService.answerKnowledge(existingUser.id, update.text, previousAnswer);
      const value = copy[language];
      const text =
        (answer.status === 'grounded' ||
          answer.status === 'general' ||
          answer.status === 'off_topic' ||
          answer.status === 'product_help') &&
        answer.answer
          ? [
              answer.status === 'general' ? value.generalGuidance : null,
              answer.answer,
              answer.nextAction,
              answer.sources.length > 0
                ? `${value.sources}:\n${answer.sources.map((source) => `${source.title}: ${source.url}`).join('\n')}`
                : null,
              answer.validAsOf ? `${value.checkedOn}: ${answer.validAsOf}` : null,
            ]
              .filter(Boolean)
              .join('\n\n')
          : `${answer.nextAction}${answer.contact ? `\n${answer.contact}` : ''}`;
      await this.enqueue(existingUser.id, sourceId, 'knowledge', text, [
        createCallbackKeyboard([[{ text: copy[language].backToMenu, payload: 'menu_main' }]]),
      ]);
      return;
    }

    if (hasProfile) {
      await this.showMainMenu(existingUser.id, sourceId, language, copy[language].fallback);
      return;
    }
    if (state?.flowId === introFlowId && state.completed) {
      await this.showIntroAppShortcut(existingUser.id, sourceId, language);
    } else {
      await this.showLanguageWelcome(existingUser.id, sourceId);
    }
  }
}
