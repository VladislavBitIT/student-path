import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApplicationWorker, BotUpdateHandler, RouteService } from '@first30/application';
import { MockLlmAdapter, NoneLlmAdapter } from '@first30/domain';
import { supportedLanguages, languageChoices } from '@first30/domain';
import {
  conversationStates,
  createDatabase,
  eventCandidates,
  maxAuthExchanges,
  mockDeliveries,
  outbox,
  routes,
  userProfiles,
  users,
  webhookInbox,
  type DatabaseConnection,
} from '@first30/database';
import { MaxTransportError, type NormalizedMaxUpdate } from '@first30/max-adapter';
import { universityDirectory } from '@first30/config';
import { runMigrations } from '../../apps/api/src/migrate.js';
import { runSeed } from '../../apps/api/src/seed.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

function update(maxUserId: string, input: Partial<NormalizedMaxUpdate>): NormalizedMaxUpdate {
  return {
    type: 'message_created',
    userId: maxUserId,
    providerKey: `test:${randomUUID()}`,
    raw: {},
    ...input,
  };
}

describeDatabase('MAX bot state machine', () => {
  let connection: DatabaseConnection;
  let handler: BotUpdateHandler;

  beforeAll(async () => {
    await runMigrations(databaseUrl);
    await runSeed(databaseUrl);
    connection = createDatabase(databaseUrl!);
    handler = new BotUpdateHandler(connection.db, {
      miniAppUrl: 'http://localhost:4173',
      introVideoTokens: { ru: 'test-ru-video-token', en: 'test-en-video-token' },
    });
  }, 60_000);

  afterAll(async () => {
    await connection?.close();
  });

  async function send(maxUserId: string, input: Partial<NormalizedMaxUpdate>) {
    const sourceId = randomUUID();
    await handler.handle(update(maxUserId, input), sourceId);
    return connection.db.select().from(outbox).where(eq(outbox.sourceId, sourceId));
  }

  async function userAndState(maxUserId: string) {
    const user = (await connection.db.select().from(users).where(eq(users.maxUserId, maxUserId)).limit(1))[0]!;
    const state = (
      await connection.db.select().from(conversationStates).where(eq(conversationStates.userId, user.id)).limit(1)
    )[0];
    return { user, state };
  }

  async function finishNewQuestions(maxUserId: string, choices: Partial<Record<string, string>> = {}) {
    const defaults: Record<string, string> = {
      ONB_08_ADMISSION_YEAR: '2026',
      ONB_09_ENTRY_MODE: 'visa_free',
      ONB_10_HOUSING_STATUS: 'applied',
      ONB_11_MOBILITY: 'moving',
      ONB_12_PROGRAM_LEVEL: 'bachelor_specialist',
    };
    let replies: Awaited<ReturnType<typeof send>> = [];
    for (let index = 0; index < 5; index += 1) {
      const state = (await userAndState(maxUserId)).state;
      if (state?.completed) return replies;
      const answer = choices[state!.questionId] ?? defaults[state!.questionId];
      if (!answer) throw new Error(`Unexpected onboarding question: ${state?.questionId}`);
      replies = await send(maxUserId, {
        type: 'message_callback',
        callbackPayload: `onb_answer:${state!.questionId}:${answer}`,
      });
    }
    if ((await userAndState(maxUserId)).state?.completed) return replies;
    throw new Error('Questionnaire did not finish');
  }

  it('sends the requested bilingual greeting with inline languages, then a localized welcome and one video', async () => {
    for (const selected of supportedLanguages) {
      const maxUserId = `bot-intro-${selected}-${randomUUID()}`;
      const greeting = await send(maxUserId, { type: 'message_created', text: '/start' });
      expect(greeting).toHaveLength(1);
      const welcome = greeting.find((row) => row.sourceType === 'bot_update');
      expect(welcome?.payload).toMatchObject({
        text:
          '👋 Путь студента / Student Path\n' +
          'Поможем разобраться с первыми шагами после зачисления и приезда в Россию.\n\n' +
          'We’ll help you navigate your first steps after admission and arrival in Russia.\n\n' +
          'Выберите язык / Choose your language',
        attachments: [expect.objectContaining({ type: 'inline_keyboard' })],
      });
      const welcomeJson = JSON.stringify(welcome?.payload);
      for (const language of supportedLanguages) {
        expect(welcomeJson).toContain(`intro_lang:${language}`);
        expect(welcomeJson).toContain(languageChoices[language].name);
      }
      const selectedMessages = await send(maxUserId, {
        type: 'message_callback',
        callbackPayload: `intro_lang:${selected}`,
      });
      const messages = selectedMessages.filter((row) => row.sourceType === 'bot_update');
      expect(messages).toHaveLength(2);
      const introduction = messages.find((row) => row.idempotencyKey.endsWith(':intro-welcome'))!;
      expect(introduction.payload.attachments).toEqual([]);
      const expectedWelcome = {
        ru:
          '😊 Добро пожаловать в «Путь студента»\n' +
          'Сервис поможет после зачисления разобраться с переездом, жильём и первыми делами в университете.\n\n' +
          'Ответьте на несколько вопросов — и получите персональный план действий со ссылками на опубликованные источники.\n\n' +
          'Ниже — короткое видео о том, как работает сервис.',
        en: '😊 Welcome to Student Path\n',
        kk: '😊 «Путь студента» сервисіне қош келдіңіз\n',
        uz: '😊 «Путь студента» xizmatiga xush kelibsiz\n',
        tk: '😊 «Путь студента» hyzmatyna hoş geldiňiz\n',
        'zh-CN': '😊 欢迎使用「Путь студента」\n',
        hi: '😊 «Путь студента» में आपका स्वागत है\n',
      }[selected];
      expect(introduction.payload.text).toEqual(
        selected === 'ru' ? expectedWelcome : expect.stringContaining(expectedWelcome),
      );
      expect((introduction.payload.text as string).split('\n\n')).toHaveLength(3);
      const video = messages.find((row) => row.idempotencyKey.endsWith(':intro-video'))!;
      const payload = video.payload as { text: string; attachments: Array<{ type: string; payload: unknown }> };
      expect(payload.attachments.map((attachment) => attachment.type)).toEqual(['video', 'inline_keyboard']);
      expect(payload.attachments[0]!.payload).toEqual({
        token: selected === 'ru' ? 'test-ru-video-token' : 'test-en-video-token',
      });
      expect(JSON.stringify(payload.attachments[1])).toContain('open_app');
      const expectedButton = {
        ru: 'Открыть мини-приложение',
        en: 'Open mini app',
        kk: 'Шағын қолданбаны ашу',
        uz: 'Mini-ilovani ochish',
        tk: 'Kiçi programmany açmak',
        'zh-CN': '打开小程序',
        hi: 'मिनी ऐप खोलें',
      }[selected];
      expect(JSON.stringify(payload.attachments[1])).toContain(expectedButton);
      expect(payload.text.length).toBeGreaterThan(10);
      if (selected !== 'ru' && selected !== 'en') expect(payload.text).toMatch(/ағылшын|ingliz|iňlis|英语|अंग्रेज़ी/iu);
      const current = await userAndState(maxUserId);
      expect(current.user.preferredLanguage).toBe(selected);
      expect(current.state?.flowId).toBe('intro_video_v1');
      expect(current.state?.completed).toBe(true);
      expect((await new RouteService(connection.db).getProfile(current.user.id)).user.preferredLanguage).toBe(selected);
      expect(
        await send(maxUserId, { type: 'message_callback', callbackPayload: `intro_lang:${selected}` }),
      ).toHaveLength(0);
      const again = await send(maxUserId, { type: 'message_created', text: '/start' });
      expect(again).toHaveLength(1);
      expect(again[0]?.payload).toEqual(welcome?.payload);
      expect(JSON.stringify(again)).not.toContain('test-ru-video-token');
      expect(JSON.stringify(again)).not.toContain('test-en-video-token');
      const selectedAgain = await send(maxUserId, {
        type: 'message_callback',
        callbackPayload: `intro_lang:${selected}`,
      });
      expect(selectedAgain).toHaveLength(2);
      expect(selectedAgain.map((row) => row.payload)).toEqual(
        expect.arrayContaining(messages.map((row) => row.payload)),
      );
      expect(
        await send(maxUserId, { type: 'message_callback', callbackPayload: `intro_lang:${selected}` }),
      ).toHaveLength(0);
    }
  });

  it('replays the requested intro on each start without resetting an existing profile, progress or reminders', async () => {
    const maxUserId = `bot-returning-intro-${randomUUID()}`;
    const service = new RouteService(connection.db);
    const user = await service.ensureUser(maxUserId);
    const { route } = await service.onboard(user.id, {
      preferredLanguage: 'en',
      universityCode: 'ITMO',
      campusCode: 'main',
      citizenshipType: 'foreign',
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'dormitory',
    });
    const completedStep = route.steps[0]!;
    const remindedStep = route.steps[1]!;
    await service.setStepStatus(user.id, completedStep.code, 'COMPLETED');
    await service.setReminderConsent(user.id, true);
    await service.createReminder(user.id, remindedStep.code, new Date(Date.now() + 86_400_000));
    const profileBefore = (await service.getProfile(user.id)).profile;
    const routeBefore = await service.getRoute(user.id);
    const remindersBefore = await service.listReminders(user.id);

    for (const start of [{ type: 'message_created', text: '/start' }, { type: 'bot_started' }] as const) {
      const greeting = await send(maxUserId, start);
      expect(greeting).toHaveLength(1);
      expect(greeting[0]?.payload.text).toContain('👋 Путь студента / Student Path');
      expect(greeting[0]?.payload.text).toContain('Выберите язык / Choose your language');
      expect(JSON.stringify(greeting[0]?.payload.attachments)).toContain('intro_lang:ru');
      expect((await userAndState(maxUserId)).state).toMatchObject({ flowId: 'intro_video_v1', completed: false });
      const menuBeforeChoice = await send(maxUserId, { type: 'message_callback', callbackPayload: 'menu_main' });
      expect(JSON.stringify(menuBeforeChoice)).toContain('open_app');

      const selected = await send(maxUserId, { type: 'message_callback', callbackPayload: 'intro_lang:ru' });
      expect(selected).toHaveLength(2);
      expect(selected.find((row) => row.idempotencyKey.endsWith(':intro-welcome'))?.payload.text).toContain(
        '😊 Добро пожаловать в «Путь студента»',
      );
      expect(JSON.stringify(selected)).toContain('test-ru-video-token');
      expect(JSON.stringify(selected)).toContain('open_app');
      expect(await send(maxUserId, { type: 'message_callback', callbackPayload: 'intro_lang:ru' })).toHaveLength(0);
      expect((await service.getProfile(user.id)).profile).toEqual(profileBefore);
      expect((await service.getProfile(user.id)).user.preferredLanguage).toBe('ru');
      const currentRoute = await service.getRoute(user.id);
      expect(currentRoute.id).toBe(routeBefore.id);
      expect(currentRoute.version).toBe(routeBefore.version);
      expect(currentRoute.progress).toEqual(routeBefore.progress);
      expect(currentRoute.steps.find((step) => step.code === completedStep.code)?.status).toBe('COMPLETED');
      expect(await service.listReminders(user.id)).toEqual(remindersBefore);
      const menu = await send(maxUserId, { type: 'message_callback', callbackPayload: 'menu_main' });
      expect(JSON.stringify(menu)).toContain('Главное меню');
      expect(JSON.stringify(menu)).toContain('open_app');
    }
  });

  it('keeps the app reachable when intro video tokens are unavailable', async () => {
    const maxUserId = `bot-intro-fallback-${randomUUID()}`;
    const withoutVideo = new BotUpdateHandler(connection.db, { miniAppUrl: 'http://localhost:4173' });
    await withoutVideo.handle(update(maxUserId, { type: 'bot_started' }), randomUUID());
    const sourceId = randomUUID();
    await withoutVideo.handle(
      update(maxUserId, { type: 'message_callback', callbackPayload: 'intro_lang:ru' }),
      sourceId,
    );
    const rows = await connection.db.select().from(outbox).where(eq(outbox.sourceId, sourceId));
    expect(rows).toHaveLength(2);
    const welcome = rows.find((row) => row.idempotencyKey.endsWith(':intro-welcome'))!;
    expect(welcome.payload.text).toContain('😊 Добро пожаловать в «Путь студента»');
    expect(welcome.payload.text).not.toContain('Ниже — короткое видео');
    const payload = rows.find((row) => row.idempotencyKey.endsWith(':intro-video-fallback'))!.payload as {
      text: string;
      attachments: unknown[];
    };
    expect(payload.text).toContain('Видео пока недоступно');
    expect(JSON.stringify(payload.attachments)).toContain('open_app');
    expect(JSON.stringify(payload.attachments)).not.toContain('video');
  });

  it('delivers the welcome before the video even when the video is queued earlier or the welcome is retried', async () => {
    const maxUserId = `bot-intro-order-${randomUUID()}`;
    await send(maxUserId, { type: 'bot_started' });
    const choice = await send(maxUserId, { type: 'message_callback', callbackPayload: 'intro_lang:ru' });
    const welcome = choice.find((row) => row.idempotencyKey.endsWith(':intro-welcome'))!;
    const video = choice.find((row) => row.idempotencyKey.endsWith(':intro-video'))!;
    const worker = new ApplicationWorker(connection.db, {
      maxProvider: 'mock',
      miniAppUrl: 'http://localhost:4173',
      batchSize: 1,
    });
    const now = new Date('2000-01-03');
    await connection.db
      .update(outbox)
      .set({ availableAt: new Date('2000-01-01') })
      .where(eq(outbox.id, video.id));
    // A scheduled retry must not let the video overtake the welcome.
    expect(await worker.deliverOutbox(now)).toBe(0);
    await connection.db.update(outbox).set({ status: 'processing' }).where(eq(outbox.id, welcome.id));
    expect(await worker.deliverOutbox(now)).toBe(0);
    await connection.db
      .update(outbox)
      .set({ status: 'pending', availableAt: new Date('2000-01-02') })
      .where(eq(outbox.id, welcome.id));
    expect(await worker.deliverOutbox(now)).toBe(1);
    expect((await connection.db.select().from(outbox).where(eq(outbox.id, welcome.id)))[0]?.status).toBe('sent');
    expect((await connection.db.select().from(outbox).where(eq(outbox.id, video.id)))[0]?.status).toBe('pending');
    expect(await worker.deliverOutbox(now)).toBe(1);
    expect((await connection.db.select().from(outbox).where(eq(outbox.id, video.id)))[0]?.status).toBe('sent');
  });

  it('queues one button-only fallback after a definitive video delivery failure', async () => {
    const maxUserId = `bot-intro-delivery-${randomUUID()}`;
    await send(maxUserId, { type: 'bot_started' });
    const choice = await send(maxUserId, { type: 'message_callback', callbackPayload: 'intro_lang:en' });
    const video = choice.find((row) => row.idempotencyKey.endsWith(':intro-video'))!;
    const welcome = choice.find((row) => row.idempotencyKey.endsWith(':intro-welcome'))!;
    await connection.db.update(outbox).set({ status: 'sent' }).where(eq(outbox.id, welcome.id));
    await connection.db
      .update(outbox)
      .set({ availableAt: new Date('2000-01-01') })
      .where(eq(outbox.id, video.id));
    const worker = new ApplicationWorker(connection.db, {
      maxProvider: 'real',
      miniAppUrl: 'http://localhost:4173',
      maxBotUsername: 'studyway_test_bot',
      batchSize: 1,
      maxClient: {
        sendToUser: async () => {
          throw new MaxTransportError('MAX API returned 400', 'permanent', 400);
        },
        answerCallback: async () => undefined,
      },
    });
    await worker.deliverOutbox();
    const fallback = (await connection.db.select().from(outbox).where(eq(outbox.sourceId, video.sourceId))).find(
      (item) => item.idempotencyKey.endsWith(':intro-video-delivery-fallback'),
    );
    expect(video).toBeDefined();
    expect(fallback?.payload).toMatchObject({
      text: expect.stringContaining('temporarily unavailable'),
      attachments: [expect.objectContaining({ type: 'inline_keyboard' })],
    });
    expect(JSON.stringify(fallback?.payload)).toContain('open_app');
    expect(JSON.stringify(fallback?.payload)).not.toContain('test-en-video-token');
  });

  it('opens the mini app first and still accepts an already issued chat-questionnaire callback', async () => {
    const maxUserId = `bot-state-${randomUUID()}`;
    const greeting = await send(maxUserId, { type: 'bot_started' });
    const greetingText = greeting.map((row) => (row.payload as { text?: string }).text).join(' ');
    expect(greetingText).toContain('после зачисления и приезда в Россию');
    expect(greetingText).toContain('Choose your language');
    expect(greeting.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('intro_lang:ru');
    expect(greeting.map((row) => JSON.stringify(row.payload)).join(' ')).not.toContain('open_app');
    expect(greeting.map((row) => JSON.stringify(row.payload)).join(' ')).not.toContain('ONB_01_LANGUAGE');
    const firstMessage = greeting.find((row) => row.sourceType === 'bot_update');
    expect((firstMessage?.payload as { attachments?: unknown[] }).attachments).toEqual([
      expect.objectContaining({ type: 'inline_keyboard' }),
    ]);
    let current = await userAndState(maxUserId);
    expect(current.state).toMatchObject({ flowId: 'intro_video_v1', completed: false, cancelled: false });

    const english = await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_lang_en' });
    expect(english.map((row) => (row.payload as { text?: string }).text).join(' ')).not.toMatch(/[А-Яа-яЁё]/);
    current = await userAndState(maxUserId);
    expect(current.user.preferredLanguage).toBe('en');
    expect(current.state?.questionId).toBe('ONB_02_UNIVERSITY');
    expect(current.state?.history).toEqual(['ONB_01_LANGUAGE']);
    expect(english.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('Choose your university');
    expect(english.map((row) => JSON.stringify(row.payload)).join(' ')).not.toContain('onb_cancel');

    const staleReplies = await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_lang_ru' });
    current = await userAndState(maxUserId);
    expect(current.user.preferredLanguage).toBe('en');
    expect(current.state?.questionId).toBe('ONB_02_UNIVERSITY');
    expect(staleReplies).toHaveLength(2);
    expect(staleReplies.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('no longer current');

    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_back:ONB_02_UNIVERSITY' });
    current = await userAndState(maxUserId);
    expect(current.state?.questionId).toBe('ONB_01_LANGUAGE');
    expect(current.state?.history).toEqual([]);
    expect(current.state?.collectedAnswers).toEqual({});
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_lang_en' });
    const restarted = await send(maxUserId, { type: 'bot_started' });
    expect((await userAndState(maxUserId)).state).toMatchObject({
      flowId: 'intro_video_v1',
      completed: false,
      cancelled: false,
    });
    expect(restarted.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('intro_lang:ru');
  });

  it('keeps the date question on an impossible date and completes into a real bilingual menu', async () => {
    const maxUserId = `bot-date-${randomUUID()}`;
    await send(maxUserId, { type: 'bot_started' });
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_lang_ru' });
    for (const payload of [
      'onb_answer:ONB_02_UNIVERSITY:ITMO',
      'onb_answer:ONB_03_CITIZENSHIP:India',
      'onb_answer:ONB_04_SPECIAL_STATUS:none',
    ])
      await send(maxUserId, { type: 'message_callback', callbackPayload: payload });
    const dateQuestion = await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_status_preparing' });
    const dateQuestionJson = dateQuestion.map((row) => JSON.stringify(row.payload)).join(' ');
    expect(dateQuestionJson).toContain('onb_date_entry:ONB_06_PLANNED_DATE');
    expect(dateQuestionJson).toContain('Написать в чат');
    expect(dateQuestionJson).not.toContain('onb_cancel');
    const dateHelp = await send(maxUserId, {
      type: 'message_callback',
      callbackPayload: 'onb_date_entry:ONB_06_PLANNED_DATE',
    });
    expect(dateHelp.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('24.09.2026');
    expect((await userAndState(maxUserId)).state?.questionId).toBe('ONB_06_PLANNED_DATE');

    const invalid = await send(maxUserId, { text: '31.02.2026' });
    expect((await userAndState(maxUserId)).state?.questionId).toBe('ONB_06_PLANNED_DATE');
    expect(invalid).toHaveLength(2);
    expect(invalid.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('Дата не подошла');

    await send(maxUserId, { text: '28.02.2026' });
    expect((await userAndState(maxUserId)).state?.questionId).toBe('ONB_07_ACCOMMODATION');
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_home_dormitory' });
    const completed = await finishNewQuestions(maxUserId);
    expect((await userAndState(maxUserId)).state?.questionId).toBe('complete');
    expect((await userAndState(maxUserId)).state?.completed).toBe(true);
    const completedUser = (await userAndState(maxUserId)).user;
    const reminderProfile = (
      await connection.db.select().from(userProfiles).where(eq(userProfiles.userId, completedUser.id)).limit(1)
    )[0];
    expect(reminderProfile?.remindersEnabled).toBe(false);
    expect(reminderProfile?.countryOrRegion).toBe('India');
    expect(reminderProfile?.attributes.specialStatus).toBe('none');
    const menuJson = completed.map((row) => JSON.stringify(row.payload)).join(' ');
    expect(menuJson).toContain('Напоминания выключены');
    for (const payload of ['menu_today', 'menu_next', 'menu_situation', 'menu_ask', 'menu_human', 'menu_reminders']) {
      expect(menuJson).not.toContain(payload);
    }
    expect(menuJson).toContain('open_app');
    const menuMessage = completed.find(
      (row) => row.sourceType === 'bot_update' && row.idempotencyKey.endsWith('first-route'),
    );
    expect((menuMessage?.payload as { attachments?: unknown[] }).attachments).toEqual([
      { type: 'image', payload: { url: 'http://localhost:4173/assets/bot-plan-ready.jpg' } },
      expect.objectContaining({ type: 'inline_keyboard' }),
    ]);

    const restarted = await send(maxUserId, { type: 'bot_started' });
    expect(restarted.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('intro_lang:ru');
    expect(restarted.map((row) => JSON.stringify(row.payload)).join(' ')).not.toContain('bot-plan-ready.jpg');
  });

  it('cancels the questionnaire safely and starts a fresh intro on Start', async () => {
    const maxUserId = `bot-cancel-${randomUUID()}`;
    await send(maxUserId, { type: 'bot_started' });
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_lang_en' });
    const cancelled = await send(maxUserId, { type: 'message_created', text: '/cancel' });
    let current = await userAndState(maxUserId);
    expect(current.state?.cancelled).toBe(true);
    expect(current.state?.history).toEqual(['ONB_01_LANGUAGE']);
    expect(cancelled.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('paused');

    await send(maxUserId, { type: 'message_created', text: '/start' });
    current = await userAndState(maxUserId);
    expect(current.state).toMatchObject({ flowId: 'intro_video_v1', completed: false, cancelled: false });
    expect(current.state?.history).toEqual([]);
  });

  it('completes the MAX questionnaire for every directory university without cross-university steps', async () => {
    for (const entry of universityDirectory) {
      const maxUserId = `bot-directory-${entry.code}-${randomUUID()}`;
      await send(maxUserId, { type: 'bot_started' });
      const callbacks = [
        'onb_lang_ru',
        `onb_answer:ONB_02_UNIVERSITY:${entry.code}`,
        ...(entry.campuses.length > 1 ? [`onb_answer:ONB_02_CAMPUS:${entry.campuses[0]!.code}`] : []),
        ...(entry.code === 'MSU' ? ['onb_answer:ONB_02_MSU_FACULTY:other'] : []),
        ...(entry.code === 'TSU' ? ['onb_answer:ONB_02_TSU_FACULTY:other'] : []),
        'onb_answer:ONB_03_CITIZENSHIP:RU',
        'onb_status_arrived',
        'onb_answer:ONB_06_ENTRY_DATE:__skip__',
        'onb_home_private',
      ];
      for (const payload of callbacks) await send(maxUserId, { type: 'message_callback', callbackPayload: payload });
      await finishNewQuestions(maxUserId);
      const { user, state } = await userAndState(maxUserId);
      expect(state?.completed, entry.code).toBe(true);
      const service = new RouteService(connection.db);
      const profile = await service.getProfile(user.id);
      expect(profile.profile?.universityCode).toBe(entry.code);
      const route = await service.getRoute(user.id);
      expect(route.partnerStatus).toBe('directory_public');
      expect(route.steps.some((step) => step.scope === 'university')).toBe(true);
      expect(route.steps.every((step) => !step.source?.id.startsWith('itmo_') || entry.code === 'ITMO')).toBe(true);
      if (entry.code === 'ITMO') {
        expect(route.steps.map((step) => step.code)).not.toContain('NOTIFY_PLANNED_ARRIVAL');
        expect(route.steps.map((step) => step.code)).not.toContain('COMPLETE_FIRST_DAYS');
      }
      if (entry.code === 'MSU') {
        const unknown = await send(maxUserId, { text: 'zeppelinpermit' });
        const answerText = unknown.map((row) => (row.payload as { text?: string }).text ?? '').join(' ');
        expect(answerText).not.toContain('itmo.ru');
        expect(answerText).toContain('msu.ru');
      }
    }
  });

  it('lets the student leave the admission year unknown and fill it in later', async () => {
    const maxUserId = `bot-nsu-year-${randomUUID()}`;
    await send(maxUserId, { type: 'bot_started' });
    for (const callbackPayload of [
      'onb_lang_ru',
      'onb_answer:ONB_02_UNIVERSITY:NSU',
      'onb_answer:ONB_03_CITIZENSHIP:RU',
      'onb_status_preparing',
      'onb_answer:ONB_06_PLANNED_DATE:__skip__',
      'onb_home_dormitory',
    ])
      await send(maxUserId, { type: 'message_callback', callbackPayload });
    await finishNewQuestions(maxUserId, { ONB_08_ADMISSION_YEAR: 'unknown' });
    const { user, state } = await userAndState(maxUserId);
    expect(state?.completed).toBe(true);
    const service = new RouteService(connection.db);
    expect((await service.getProfile(user.id)).profile?.attributes.admissionYear).toBeNull();
    const updated = await service.onboard(
      user.id,
      {
        preferredLanguage: 'ru',
        universityCode: 'NSU',
        campusCode: 'main',
        citizenshipType: 'rf',
        mobilityStatus: 'moving',
        admissionYear: 2026,
        housingStatus: 'applied',
        arrivalStatus: 'preparing',
        arrivalDate: null,
        accommodationType: 'dormitory',
      },
      new Date(),
      true,
    );
    expect((await service.getProfile(user.id)).profile?.attributes.admissionYear).toBe(2026);
    expect(updated.route.steps.some((step) => step.code === 'NSU_DORM_PACKAGE')).toBe(true);
  });

  it('skips a single campus and builds a general route for a university outside the directory', async () => {
    const maxUserId = `bot-other-${randomUUID()}`;
    await send(maxUserId, { type: 'bot_started' });
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_lang_ru' });
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_answer:ONB_02_UNIVERSITY:OTHER' });
    expect((await userAndState(maxUserId)).state?.questionId).toBe('ONB_02_OTHER_UNIVERSITY');
    await send(maxUserId, { text: 'Другой университет' });
    expect((await userAndState(maxUserId)).state?.questionId).toBe('ONB_03_CITIZENSHIP');
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_answer:ONB_03_CITIZENSHIP:RU' });
    expect((await userAndState(maxUserId)).state?.questionId).toBe('ONB_05_ARRIVAL_STATUS');
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_status_preparing' });
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_answer:ONB_06_PLANNED_DATE:__skip__' });
    await send(maxUserId, {
      type: 'message_callback',
      callbackPayload: 'onb_answer:ONB_07_ACCOMMODATION:unknown',
    });
    const completed = await finishNewQuestions(maxUserId);
    const { user, state } = await userAndState(maxUserId);
    expect(state?.completed).toBe(true);
    const profile = await new RouteService(connection.db).getProfile(user.id);
    expect(profile.profile?.countryOrRegion).toBe('Россия');
    const route = await new RouteService(connection.db).getRoute(user.id);
    expect(route.university).toBe('Другой университет');
    expect(route.steps.some((step) => step.code === 'CHECK_UNIVERSITY_FIRST_STEPS' && step.source === null)).toBe(true);
    expect(
      route.steps.every((step) => !step.source?.id.startsWith('uni_') && !step.source?.id.startsWith('itmo_')),
    ).toBe(true);
    expect(completed.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('общие дела');
    const adapter = new MockLlmAdapter();
    const providerCall = vi.spyOn(adapter, 'answerFromContext');
    await new RouteService(connection.db, adapter).answerKnowledge(user.id, 'Как подготовиться к переезду?');
    expect(providerCall.mock.calls[0]?.[0].profile?.university).toBe('Другой университет');
    expect(providerCall.mock.calls[0]?.[0].profile?.city).toBe('Не указан');
    expect(providerCall.mock.calls[0]?.[0].context.every((item) => !item.sourceId.startsWith('itmo_'))).toBe(true);
  });

  it('uses last-entry date and preserves hotel housing without inventing a visa mode', async () => {
    const maxUserId = `bot-arrived-${randomUUID()}`;
    await send(maxUserId, { type: 'bot_started' });
    for (const callbackPayload of ['onb_lang_en', 'onb_answer:ONB_02_UNIVERSITY:ITMO']) {
      await send(maxUserId, { type: 'message_callback', callbackPayload });
    }
    await send(maxUserId, { text: 'India' });
    for (const callbackPayload of ['onb_answer:ONB_04_SPECIAL_STATUS:rvpo', 'onb_status_arrived']) {
      await send(maxUserId, { type: 'message_callback', callbackPayload });
    }
    expect((await userAndState(maxUserId)).state?.questionId).toBe('ONB_06_ENTRY_DATE');
    await send(maxUserId, { text: '23.09.2026' });
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_answer:ONB_07_ACCOMMODATION:hotel' });
    await finishNewQuestions(maxUserId, { ONB_09_ENTRY_MODE: 'already_in_russia' });
    const { user, state } = await userAndState(maxUserId);
    expect(state?.completed).toBe(true);
    const profile = (await new RouteService(connection.db).getProfile(user.id)).profile;
    expect(profile?.arrivalDate).toBe('2026-09-23');
    expect(profile?.countryOrRegion).toBe('India');
    expect(profile?.accommodationType).toBe('unknown');
    expect(profile?.attributes?.housingChoice).toBe('hotel');
    expect(profile?.attributes?.specialStatus).toBe('rvpo');
    expect(profile?.attributes?.entryMode).toBe('already_in_russia');
  });

  it('executes menu actions, reminder consent, and confirmed accommodation change', async () => {
    const maxUserId = `bot-menu-${randomUUID()}`;
    const service = new RouteService(connection.db);
    const user = await service.ensureUser(maxUserId, 'en');
    await service.onboard(user.id, {
      preferredLanguage: 'en',
      universityCode: 'ITMO',
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'dormitory',
    });

    for (const payload of ['menu_today', 'menu_next', 'menu_ask', 'menu_human', 'menu_reminders', 'menu_situation']) {
      const replies = await send(maxUserId, {
        type: 'message_callback',
        callbackId: `callback-${payload}-${randomUUID()}`,
        callbackPayload: payload,
      });
      expect(replies.length, payload).toBeGreaterThan(0);
      expect(
        replies.some((row) => row.sourceType === 'callback_ack'),
        payload,
      ).toBe(true);
      expect(replies.some((row) => (row.payload as { text?: string }).text?.length)).toBe(true);
    }

    await send(maxUserId, { type: 'message_callback', callbackPayload: 'reminders_enable' });
    let profile = (
      await connection.db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1)
    )[0]!;
    expect(profile.remindersEnabled).toBe(true);
    const stoppedReplies = await send(maxUserId, { type: 'bot_stopped' });
    profile = (await connection.db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1))[0]!;
    expect(profile.remindersEnabled).toBe(false);
    expect(stoppedReplies).toHaveLength(0);

    await send(maxUserId, { type: 'message_callback', callbackPayload: 'situation_private' });
    const candidate = (
      await connection.db
        .select()
        .from(eventCandidates)
        .where(and(eq(eventCandidates.userId, user.id), eq(eventCandidates.status, 'PENDING')))
        .limit(1)
    )[0]!;
    expect(candidate.payload).toEqual({ accommodationType: 'private' });
    const confirmed = await send(maxUserId, {
      type: 'message_callback',
      callbackPayload: `event_confirm:${candidate.id}`,
    });
    profile = (await connection.db.select().from(userProfiles).where(eq(userProfiles.userId, user.id)).limit(1))[0]!;
    expect(profile.accommodationType).toBe('private');
    expect(confirmed.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('Route updated');

    const repeatedConfirmation = await send(maxUserId, {
      type: 'message_callback',
      callbackId: `callback-event-confirm-repeat-${randomUUID()}`,
      callbackPayload: `event_confirm:${candidate.id}`,
    });
    expect(repeatedConfirmation.some((row) => row.sourceType === 'callback_ack')).toBe(true);
    expect(repeatedConfirmation.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('no longer current');

    const cancelledCandidate = await service.createEventCandidate(user.id, 'dormitory');
    await service.cancelEventCandidate(user.id, cancelledCandidate.id);
    for (const action of ['event_confirm', 'event_cancel']) {
      const stale = await send(maxUserId, {
        type: 'message_callback',
        callbackId: `callback-${action}-${randomUUID()}`,
        callbackPayload: `${action}:${cancelledCandidate.id}`,
      });
      expect(stale.some((row) => row.sourceType === 'callback_ack')).toBe(true);
      expect(stale.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('no longer current');
    }
    const cancelledRow = (
      await connection.db.select().from(eventCandidates).where(eq(eventCandidates.id, cancelledCandidate.id)).limit(1)
    )[0];
    expect(cancelledRow?.status).toBe('CANCELLED');

    const grounded = await send(maxUserId, { text: 'How do I arrange a dormitory booking?' });
    const groundedJson = grounded.map((row) => JSON.stringify(row.payload)).join(' ');
    expect(groundedJson).toContain('https://');
    expect(groundedJson).toContain('2026-09-21');
  });

  it('passes the configured LLM through the inbox worker to bot knowledge answers', async () => {
    const maxUserId = `bot-llm-${randomUUID()}`;
    const service = new RouteService(connection.db);
    const user = await service.ensureUser(maxUserId, 'en');
    await service.onboard(user.id, {
      preferredLanguage: 'en',
      universityCode: 'ITMO',
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'dormitory',
    });
    const llmAdapter = new NoneLlmAdapter();
    const answer = vi.spyOn(llmAdapter, 'answerFromContext');
    const id = randomUUID();
    await connection.db.insert(webhookInbox).values({
      providerUpdateKey: `llm:${id}`,
      payload: {
        update_type: 'message_created',
        message: {
          sender: { user_id: maxUserId },
          body: { mid: id, text: 'How do I arrange a dormitory booking?' },
        },
      },
    });
    await new ApplicationWorker(connection.db, {
      maxProvider: 'mock',
      miniAppUrl: 'http://localhost:4173',
      llmAdapter,
    }).processInbox();
    expect(answer).toHaveBeenCalledOnce();
    expect(answer.mock.calls[0]?.[0].context.length).toBeGreaterThan(0);
  });

  it('cancels the Russian questionnaire without English terminology', async () => {
    const maxUserId = `bot-ru-cancel-${randomUUID()}`;
    await send(maxUserId, { type: 'bot_started' });
    await send(maxUserId, { type: 'message_callback', callbackPayload: 'onb_lang_ru' });
    const replies = await send(maxUserId, { text: '/cancel' });
    const text = replies.map((row) => (row.payload as { text?: string }).text).join(' ');
    expect(text).toContain('Заполнение анкеты приостановлено');
    expect(text).not.toContain('Onboarding');
  });

  it('resets only the sender, removes personal queues and restarts from the first question', async () => {
    const maxUserId = `bot-reset-${randomUUID()}`;
    const otherMaxUserId = `bot-reset-other-${randomUUID()}`;
    await send(maxUserId, { type: 'bot_started' });
    await send(otherMaxUserId, { type: 'bot_started' });
    const { user } = await userAndState(maxUserId);
    const other = await userAndState(otherMaxUserId);
    await new RouteService(connection.db).onboard(user.id, {
      preferredLanguage: 'ru',
      universityCode: 'ITMO',
      campusCode: 'main',
      citizenshipType: 'foreign',
      arrivalStatus: 'preparing',
      arrivalDate: null,
      accommodationType: 'dormitory',
    });
    const now = new Date();
    const fingerprint = randomBytes(32).toString('hex');
    await connection.db.insert(maxAuthExchanges).values({
      fingerprint,
      userId: user.id,
      sessionIssuedAt: now,
      sessionExpiresAt: new Date(now.getTime() + 60_000),
      exchangeExpiresAt: new Date(now.getTime() + 60_000),
    });
    const [oldMessage] = await connection.db.select().from(outbox).where(eq(outbox.recipient, maxUserId)).limit(1);
    expect(oldMessage).toBeTruthy();
    await connection.db.insert(mockDeliveries).values({
      outboxId: oldMessage!.id,
      recipient: maxUserId,
      payload: oldMessage!.payload,
    });
    const oldInboxId = randomUUID();
    await connection.db.insert(webhookInbox).values({
      id: oldInboxId,
      providerUpdateKey: `reset-old:${oldInboxId}`,
      status: 'processed',
      payload: {
        update_type: 'message_created',
        message: { sender: { user_id: maxUserId }, body: { mid: oldInboxId, text: 'private question' } },
      },
    });
    const oldCallbackId = randomUUID();
    await connection.db.insert(webhookInbox).values({
      id: oldCallbackId,
      providerUpdateKey: `reset-callback:${oldCallbackId}`,
      status: 'processed',
      payload: {
        update_type: 'message_callback',
        message: { sender: { user_id: otherMaxUserId } },
        callback: { callback_id: oldCallbackId, user: { user_id: maxUserId }, payload: 'menu_main' },
      },
    });
    const resetInboxId = randomUUID();
    await connection.db.insert(webhookInbox).values({
      id: resetInboxId,
      providerUpdateKey: `reset-command:${resetInboxId}`,
      payload: {
        update_type: 'message_created',
        message: { sender: { user_id: maxUserId }, body: { mid: resetInboxId, text: '/reset' } },
      },
    });
    const worker = new ApplicationWorker(connection.db, { maxProvider: 'mock', miniAppUrl: 'http://localhost:4173' });
    await worker.processInbox();

    expect(await connection.db.select().from(users).where(eq(users.id, user.id))).toHaveLength(0);
    expect(await connection.db.select().from(userProfiles).where(eq(userProfiles.userId, user.id))).toHaveLength(0);
    expect(await connection.db.select().from(routes).where(eq(routes.userId, user.id))).toHaveLength(0);
    expect(
      await connection.db.select().from(maxAuthExchanges).where(eq(maxAuthExchanges.fingerprint, fingerprint)),
    ).toHaveLength(0);
    expect(
      await connection.db.select().from(mockDeliveries).where(eq(mockDeliveries.outboxId, oldMessage!.id)),
    ).toHaveLength(0);
    expect(await connection.db.select().from(webhookInbox).where(eq(webhookInbox.id, oldInboxId))).toHaveLength(0);
    expect(await connection.db.select().from(webhookInbox).where(eq(webhookInbox.id, oldCallbackId))).toHaveLength(0);
    const [marker] = await connection.db.select().from(webhookInbox).where(eq(webhookInbox.id, resetInboxId));
    expect(marker?.status).toBe('processed');
    expect(marker?.payload).toEqual({ reset: true });
    const remainingOutbox = await connection.db.select().from(outbox).where(eq(outbox.recipient, maxUserId));
    expect(remainingOutbox).toHaveLength(1);
    expect((remainingOutbox[0]!.payload as { text: string }).text).toContain('Чтобы начать заново, отправьте /start');
    expect(await connection.db.select().from(users).where(eq(users.id, other.user.id))).toHaveLength(1);

    const greeting = await send(maxUserId, { text: '/start' });
    const restarted = await userAndState(maxUserId);
    expect(restarted.user.id).not.toBe(user.id);
    expect(restarted.state).toMatchObject({ flowId: 'intro_video_v1', completed: false, cancelled: false });
    expect(greeting.map((row) => JSON.stringify(row.payload)).join(' ')).toContain('intro_lang:ru');
    await send(maxUserId, { text: '/reset' });
    expect(await connection.db.select().from(users).where(eq(users.id, restarted.user.id))).toHaveLength(0);
    expect(await connection.db.select().from(users).where(eq(users.id, other.user.id))).toHaveLength(1);
  });
});
