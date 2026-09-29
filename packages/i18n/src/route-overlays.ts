import { researchOverlays } from './research-overlays.js';

/** Route copy translated from the existing English/Russian content; no runtime translation service. */
const base: Record<string, Readonly<Record<string, string>>> = {
  kk: {
    'steps.directory.why': 'Университет тәртібі кампусқа, қабылдау мәртебесіне және жеке жағдайыңызға байланысты.',
    'steps.directory.first.title': 'Университеттегі алғашқы қадамдарды тексеріңіз',
    'steps.directory.first.description':
      'Университеттің ресми нұсқаулығын ашыңыз. Кампус пен бағдарламаңызға арналған қолданыстағы тәртіпті нақтылаңыз; бұл анықтамалықты университет бекітпеген.',
    'steps.directory.foreign.title': 'Шетелдік студенттерге арналған нұсқаулықты тексеріңіз',
    'steps.directory.foreign.description':
      'Жарияланған нұсқаулық азаматтығыңызға, кампусыңызға және елге кіру жағдайыңызға қатысты ма, тексеріңіз. Күндерді университеттен нақтылаңыз.',
    'steps.directory.housing.title': 'Университеттегі тұрғын үй мәселесін нақтылаңыз',
    'steps.directory.housing.description':
      'Жеке тұрғын үй тағайындауын немесе өтініміңізді университеттен тексеріңіз. Өтінім беру орынға кепілдік бермейді.',
    'steps.common.why': 'Келесі іс жағдайыңызға байланысты; расталмаған күн мерзім болып саналмайды.',
    'steps.common.housing.title': 'Қайда тұратыныңызды нақтылаңыз',
    'steps.common.enrollment.title': 'Оқуға қабылдану мәртебесін тексеріңіз',
    'steps.common.enrollment.description':
      'Қабылдаудан кейінгі нұсқаулыққа сүйенбес бұрын университет хабарламасын немесе жеке кабинетіңізді тексеріңіз.',
    'steps.common.housing.description':
      'Жатақханадан орын тағайындалды ма, әлде басқа мекенжай қажет пе, тексеріңіз. Тек өтінімге сүйенбеңіз.',
    'steps.common.rf_registration.title': 'Уақытша тіркеу қажет пе, тексеріңіз',
    'steps.common.rf_registration.description':
      'Басқа мекенжайда 90 күннен артық уақытша тұрсаңыз, сол жердегі тіркеуді жалға берушіден немесе жатақханадан сұраңыз. Нақты тұрғылықты жерді ауыстыру үшін бөлек жеті күндік ереже бар. Сізге қай түрі қатысты және қашан келдіңіз? Күн белгілемес бұрын ерекшеліктерді тексеріңіз.',
    'steps.common.military.title': 'Әскери есеп сізге қатысты ма, тексеріңіз',
    'steps.common.military.description':
      'Әскери есепке жатсаңыз және жаңа уақытша тұратын жерге көшсеңіз, екі апта ішінде көшу туралы хабарлау керек пе, жауапты бөлімнен сұраңыз. Бұл тек жынысқа емес, мәртебе мен оқиға күніне байланысты; оқу өздігінен кейінге қалдыруға кепілдік бермейді.',
    'steps.common.foreign_entry.title': 'Елге кірудің жеке шарттарын тексеріңіз',
    'steps.common.foreign_entry.description':
      'Кіру құжаттарыңыз бен университеттің қазіргі нұсқауларын нақтылаңыз. Визамен және визасыз кіру тәртібі бөлек.',
    'steps.common.visa_entry.title': 'Визамен кіру шарттарын нақтылаңыз',
    'steps.common.visa_entry.description':
      'Өзіңізге қатысты виза мен кіру құжаттарын құжат берген органнан және университеттен тексеріңіз. Жалпы мерзім болжанбайды.',
    'steps.common.visa_free_entry.title': 'Визасыз кіру шарттарын нақтылаңыз',
    'steps.common.visa_free_entry.description':
      'Азаматтығыңыз бен сапар мақсатыңызға қатысты шарттарды ресми дереккөздерден және университеттен тексеріңіз.',
    'steps.common.current_stay.title': 'Қазіргі болу шарттарын нақтылаңыз',
    'steps.common.current_stay.description':
      'Ресейде болсаңыз, қазіргі мәртебеңіз бен нақты мекенжайыңыз келесі қадамдарға қалай әсер ететінін университеттен сұраңыз.',
    'steps.common.foreign_stay.title': 'Нақты мекенжайыңыз бойынша әрекеттерді нақтылаңыз',
    'steps.common.foreign_stay.description':
      'Нақты мекенжай мен қабылдаушы тарапты анықтаңыз: жатақхана әкімшілігі, қонақүй не пәтер иесі. Әдетте қабылдаушы жеті жұмыс күні ішінде келу туралы хабарлайды, бірақ азаматтық пен мәртебеге байланысты ерекшеліктер бар. Университетке қандай құжат керек екенін сұраңыз; оның ішкі мерзімі бөлек.',
    'steps.common.medical_2026.title': 'Жаңа медициналық тексеру мерзімі сізге қатысты ма, тексеріңіз',
    'steps.common.medical_2026.description':
      '2026 жылғы 1 қыркүйектен бастап Ресейге 90 күннен ұзақ уақытқа кірсеңіз, ІІМ медициналық тексеруге кірген күннен бастап 30 күнтізбелік күн көрсетеді. Ерекшеліктер мен бұрынғы жарамды тексеруді университеттен нақтылаңыз. Дактилоскопия — бөлек іс; шарттарыңыз расталмайынша күн есептелмейді.',
    'steps.common.amina.title': 'Жеке тұрғын үйіңізге Amina қатысты ма, тексеріңіз',
    'steps.common.amina.description':
      'Amina Мәскеу немесе облыста жеке тұратын, 90 күннен артық мерзімге визасыз кірген кейбір ересектерге қатысты. Алдымен азаматтықты, тұру рұқсатын, жасты, нақты мекенжайды және кіру күнін жауапты органнан тексеріңіз. Жатақхана мен қонақүйде тіркеу тәртібі бөлек. Барлық шарт сәйкес келмейінше Amina-ны тіркеудің орнына қолданбаңыз.',
    'contact.official.instruction': 'Жеке жауап алу үшін жағдайыңызға сай ИТМО-ның ресми байланысына жүгініңіз.',
    'contact.international':
      'Шетелдік студенттерді оқу және қолдау орталығы: int.students@itmo.ru. Жеке дерек жібермес бұрын ресми байланыс бетін тексеріңіз.',
    'contact.migration':
      'Көші-қон қызметі: omu@itmo.ru. Жеке нұсқауларды ИТМО-ның ресми байланыс беті арқылы нақтылаңыз.',
    'contact.dormitory':
      'Жатақхана мен келу жайын өзіңізге тағайындалған байланыстан нақтылаңыз; көші-қон сұрағын omu@itmo.ru мекенжайына жіберуге болады.',
    'contact.student_services':
      'Студенттерге қызмет көрсету бөлімі: so@itmo.ru. Сұрағыңызға осы бөлім жауапты екенін нақтылаңыз.',
    'knowledge.not_found': 'Қолжетімді дереккөздерден расталған жауап табылмады.',
    'knowledge.contact_next': 'Жеке жауап үшін ресми байланысқа жүгініңіз.',
    'knowledge.source': 'Ресми дереккөз',
    'knowledge.valid_as_of': 'Ақпарат {{date}} күні тексерілді',
    'event.accommodation.changed': 'Тұратын жерім өзгерді',
    'event.confirm_notice': 'Осы өзгерісті растағанша ештеңе өзгермейді.',
    'event.unsupported': 'Бұл өзгерісті қауіпсіз анықтай алмадым. Нұсқаны таңдаңыз немесе маманға жүгініңіз.',
    'reminders.opt_in': 'Еске салғыштарды қосу',
    'reminders.opt_out': 'Еске салғыштарды өшіру',
    'reminders.consent': 'Еске салғыштар тек анық келісіміңізден кейін жіберіледі.',
    'error.network': 'Қызмет уақытша қолжетімсіз. Енгізген ақпаратыңыз жоғалған жоқ.',
    'error.invalid_answer': 'Ұсынылған нұсқаны таңдаңыз немесе дұрыс күн енгізіңіз.',
    'steps.check_entry_requirements.title': 'Өзіңізге қатысты кіру талаптарын тексеріңіз',
    'steps.check_entry_requirements.description':
      'Құжаттарыңыз бен сапар жағдайыңызға қатысты ресми талаптарды қараңыз. Жеке құқықтық жағдай үшін жалпы тізімге ғана сүйенбеңіз.',
    'steps.check_entry_requirements.why': 'Талаптар жеке жағдайға қарай өзгеруі және жаңаруы мүмкін.',
    'steps.check_entry_requirements.prepare': 'Қабылдау хаты және қолыңыздағы жол жүру құжаттары',
    'steps.notify_planned_arrival.title': 'Келу туралы хабарлау тәртібін нақтылаңыз',
    'steps.notify_planned_arrival.description':
      'Қабылдау туралы ресми хаттағы хабарлау нұсқаулығын қараңыз; сұралса, ИТМО-ның көрсетілген байланысына хабарлаңыз.',
    'steps.notify_planned_arrival.why': 'Университет байланысы келу жоспарыңызға сәйкес нұсқау береді.',
    'steps.notify_planned_arrival.prepare': 'Жоспарланған немесе нақты келу күніңіз',
    'steps.arrange_dormitory.title': 'Жатақхана тәртібін нақтылаңыз',
    'steps.arrange_dormitory.description':
      'Жолға шығар алдында ресми орын тағайындауын немесе брондау нұсқаулығын тексеріңіз. Нақты мекенжайды, жұмыс уақытын және қажетті заттарды ИТМО-дан нақтылаңыз.',
    'steps.arrange_dormitory.why': 'Расталған тәртіп негізсіз келу жоспарының алдын алады.',
    'steps.arrange_dormitory.prepare': 'Жатақхана туралы ресми хаттарыңыз',
    'steps.obtain_health_insurance.title': 'Медициналық сақтандыру талаптарын тексеріңіз',
    'steps.obtain_health_insurance.description':
      'Өзіңізге қандай сақтандыру талабы қатысты екенін университеттің ресми байланысынан сұраңыз. Бұл жоспар жеке құқықтық қорытынды бермейді.',
    'steps.obtain_health_insurance.why': 'Қамту мен құжаттар қолданыстағы ережелерге және жағдайыңызға байланысты.',
    'steps.obtain_health_insurance.prepare': 'Қолда бар сақтандыру мәліметтері',
    'steps.check_border_documents.title': 'Кіргенде қолданылған немесе алынған құжаттарды қараңыз',
    'steps.check_border_documents.description':
      'Шекарадан өткенде қолданған не алған құжаттарды сақтап, олардың келесі қадамдарға әсерін ресми байланыстан сұраңыз.',
    'steps.check_border_documents.why': 'Келесі нұсқаулар сізге берілген құжаттарға байланысты болуы мүмкін.',
    'steps.check_border_documents.prepare': 'Жол сапары мен шекарадан өту құжаттары',
    'steps.register_dorm_residence.title': 'Жатақханада тұруға қатысты әрекеттерді нақтылаңыз',
    'steps.register_dorm_residence.description':
      'Жатақхананың жауапты қызметкерінен немесе шетелдік студенттер бөлімінен қандай әрекеттер қажет екенін және оларды кім орындайтынын сұраңыз.',
    'steps.register_dorm_residence.why': 'Тиісті тәртіп пен мерзім жеке жағдайыңыз үшін расталуы керек.',
    'steps.register_dorm_residence.prepare': 'Жатақхана және келу құжаттары',
    'steps.register_private_residence.title': 'Жеке тұрғын үйдегі тұру әрекеттерін нақтылаңыз',
    'steps.register_private_residence.description':
      'Университеттің ресми бөлімі мен қабылдаушы тараптан тұрғын үйіңізге қатысты қандай әрекеттер қажет екенін сұраңыз.',
    'steps.register_private_residence.why':
      'Міндеттер жатақхана тәртібінен өзгеше болуы мүмкін және жеке растауды қажет етеді.',
    'steps.register_private_residence.prepare': 'Тұратын жеріңіз бен қабылдаушы тарап туралы мәлімет',
    'steps.check_migration_procedures.title': 'Қалған көші-қон әрекеттерін қараңыз',
    'steps.check_migration_procedures.description':
      'Ресми нұсқаулықты шетелдік студенттер бөлімімен бірге қараңыз. Бұл қадам жол көрсетеді, құқықтық кеңес емес.',
    'steps.check_migration_procedures.why': 'Жеке тексеру жалпы ережені қате қолдану қаупін азайтады.',
    'steps.check_migration_procedures.prepare': 'Қазіргі жол жүру және тұру құжаттарыңыз',
    'steps.complete_first_days.title': 'Университеттегі алғашқы күндердің рәсімдерін аяқтаңыз',
    'steps.complete_first_days.description':
      'ИТМО студенттік қызметтерінің қазіргі нұсқаулығын қарап, тек өзіңізге тағайындалған рәсімдерді орындаңыз.',
    'steps.complete_first_days.why': 'Бұл оқуға қажетті қызметтерге қол жеткізуге көмектеседі.',
    'steps.complete_first_days.prepare': 'ИТМО аккаунтыңыз немесе қабылдау мәліметтері',
    'steps.orientation_support.title': 'Бейімдеу және қолдау мүмкіндіктерін қараңыз',
    'steps.orientation_support.description':
      'Қазіргі ресми бейімдеу және қолдау мүмкіндіктерін қараңыз. Қатысу шарттарын ИТМО-ның өзекті хабарламаларынан нақтылаңыз.',
    'steps.orientation_support.why': 'Қолдау шаралары оқу мен күнделікті өмірге бейімделуді жеңілдетеді.',
    'steps.orientation_support.prepare': 'Кестеңіз және ИТМО-ның қазіргі хабарламалары',
  },
  uz: {
    'steps.directory.why': 'Universitet tartibi kampus, qabul holati va shaxsiy vaziyatingizga bog‘liq.',
    'steps.directory.first.title': 'Universitetingizdagi ilk qadamlarni tekshiring',
    'steps.directory.first.description':
      'Universitetning rasmiy yo‘riqnomasini oching. Kampus va dasturingiz uchun amaldagi tartibni aniqlang; ushbu maʼlumotnomani universitet tasdiqlamagan.',
    'steps.directory.foreign.title': 'Xorijiy talabalar uchun yo‘riqnomani tekshiring',
    'steps.directory.foreign.description':
      'Eʼlon qilingan yo‘riqnoma fuqaroligingiz, kampusingiz va kirish holatingizga mosligini tekshiring. Sanalarni universitetdan tasdiqlang.',
    'steps.directory.housing.title': 'Universitet turar joyi tartibini aniqlang',
    'steps.directory.housing.description':
      'Shaxsiy turar joy ajratilishi yoki arizangizni universitetdan tekshiring. Ariza joy kafolati emas.',
    'steps.common.why': 'Keyingi ish vaziyatingizga bog‘liq; tasdiqlanmagan sana muddat emas.',
    'steps.common.housing.title': 'Qayerda yashashingizni aniqlang',
    'steps.common.enrollment.title': 'O‘qishga qabul holatini tekshiring',
    'steps.common.enrollment.description':
      'Qabuldan keyingi yo‘riqnomaga tayanishdan avval universitet xabari yoki shaxsiy kabinetingizni tekshiring.',
    'steps.common.housing.description':
      'Yotoqxonadan joy ajratilganmi yoki boshqa manzil kerakmi, tekshiring. Faqat arizaga tayanmang.',
    'steps.common.rf_registration.title': 'Vaqtincha ro‘yxatga olish sizga tegishlimi, tekshiring',
    'steps.common.rf_registration.description':
      'Boshqa manzilda 90 kundan ko‘proq vaqtincha yashasangiz, u yerdagi ro‘yxatga olishni uy egasi yoki yotoqxonadan so‘rang. Haqiqiy yashash joyini almashtirish uchun alohida yetti kunlik qoida bor. Sizga qaysi tur tegishli va qachon keldingiz? Sana belgilashdan oldin istisnolarni tekshiring.',
    'steps.common.military.title': 'Harbiy hisob sizga tegishlimi, tekshiring',
    'steps.common.military.description':
      'Harbiy hisobga majbur bo‘lsangiz va yangi vaqtincha yashash joyiga ko‘chsangiz, ko‘chishni ikki hafta ichida xabar qilish kerakmi, masʼul idoradan so‘rang. Bu faqat jinsga emas, maqom va voqea sanasiga bog‘liq; o‘qish o‘z-o‘zidan kechiktirish kafolati emas.',
    'steps.common.foreign_entry.title': 'Shaxsiy kirish shartlaringizni tekshiring',
    'steps.common.foreign_entry.description':
      'Kirish hujjatlaringiz va universitetning amaldagi ko‘rsatmalarini aniqlang. Vizali va vizasiz holatlar farq qiladi.',
    'steps.common.visa_entry.title': 'Viza bilan kirish shartlarini aniqlang',
    'steps.common.visa_entry.description':
      'Sizga tegishli viza va kirish hujjatlarini ularni bergan idora hamda universitetdan tekshiring. Umumiy muddat taxmin qilinmaydi.',
    'steps.common.visa_free_entry.title': 'Vizasiz kirish shartlarini aniqlang',
    'steps.common.visa_free_entry.description':
      'Fuqaroligingiz va safar maqsadingizga tegishli shartlarni rasmiy manbalar va universitetdan tekshiring.',
    'steps.common.current_stay.title': 'Hozirgi yashash shartlaringizni aniqlang',
    'steps.common.current_stay.description':
      'Rossiyada bo‘lsangiz, hozirgi maqomingiz va haqiqiy manzilingiz keyingi qadamlarga qanday taʼsir qilishini universitetdan so‘rang.',
    'steps.common.foreign_stay.title': 'Haqiqiy manzilingiz bo‘yicha ishlarni aniqlang',
    'steps.common.foreign_stay.description':
      'Haqiqiy manzil va qabul qiluvchi tomonni aniqlang: yotoqxona maʼmuriyati, mehmonxona yoki uy egasi. Odatda shu tomon kelganlik haqida yetti ish kuni ichida xabar beradi, lekin fuqarolik va maqomga oid istisnolar bor. Universitetga sizdan qaysi hujjatlar kerakligini so‘rang; uning ichki muddati alohida.',
    'steps.common.medical_2026.title': 'Yangi tibbiy ko‘rik muddati sizga tegishlimi, tekshiring',
    'steps.common.medical_2026.description':
      '2026-yil 1-sentabrdan Rossiyaga 90 kundan ortiq muddatga kirgan bo‘lsangiz, IIV ko‘rik uchun kirgan kundan boshlab 30 kalendar kunni ko‘rsatadi. Istisnolar va avvalgi amaldagi ko‘rikni universitetdan aniqlang. Barmoq izini topshirish alohida ish; shartlaringiz tasdiqlanmaguncha sana hisoblanmaydi.',
    'steps.common.amina.title': 'Amina xususiy turar joyingizga tegishlimi, tekshiring',
    'steps.common.amina.description':
      'Amina Moskva yoki viloyatda xususiy uyda yashaydigan, 90 kundan ortiq muddatga vizasiz kirgan ayrim voyaga yetganlarga tegishli. Avval fuqarolik, yashash ruxsati, yosh, haqiqiy manzil va kirish sanasini masʼul idoradan aniqlang. Yotoqxona va mehmonxonalar boshqa ro‘yxatga olish tartibidan foydalanadi. Barcha shartlar mos kelmasa, Aminani ro‘yxatga olish o‘rniga qo‘ymang.',
    'contact.official.instruction': 'Shaxsiy javob uchun vaziyatingizga mos ITMO rasmiy aloqa manzilidan foydalaning.',
    'contact.international':
      'Xorijiy talabalarni o‘qitish va qo‘llab-quvvatlash markazi: int.students@itmo.ru. Shaxsiy maʼlumot yuborishdan avval rasmiy aloqa sahifasini tekshiring.',
    'contact.migration':
      'Migratsiya xizmati: omu@itmo.ru. Shaxsiy ko‘rsatmalarni ITMO rasmiy aloqa sahifasidan aniqlang.',
    'contact.dormitory':
      'Yotoqxona va kelish tafsilotlarini sizga biriktirilgan xodimdan aniqlang; migratsiya savollarini omu@itmo.ru ga yuborish mumkin.',
    'contact.student_services':
      'Talabalarga xizmat ko‘rsatish bo‘limi: so@itmo.ru. Savolingizga aynan shu bo‘lim javob berishini tekshiring.',
    'knowledge.not_found': 'Mavjud manbalarda tasdiqlangan javob topilmadi.',
    'knowledge.contact_next': 'Shaxsiy javob uchun rasmiy aloqa manziliga murojaat qiling.',
    'knowledge.source': 'Rasmiy manba',
    'knowledge.valid_as_of': 'Maʼlumot {{date}} kuni tekshirilgan',
    'event.accommodation.changed': 'Yashash joyim o‘zgardi',
    'event.confirm_notice': 'Bu o‘zgarishni tasdiqlamaguningizcha hech narsa o‘zgarmaydi.',
    'event.unsupported': 'O‘zgarishni ishonchli aniqlay olmadim. Variantni tanlang yoki mutaxassisga murojaat qiling.',
    'reminders.opt_in': 'Eslatmalarni yoqish',
    'reminders.opt_out': 'Eslatmalarni o‘chirish',
    'reminders.consent': 'Eslatmalar faqat aniq roziligingizdan keyin yuboriladi.',
    'error.network': 'Xizmat vaqtincha ishlamayapti. Kiritgan maʼlumotingiz yo‘qolmadi.',
    'error.invalid_answer': 'Mavjud variantni tanlang yoki to‘g‘ri sana kiriting.',
    'steps.check_entry_requirements.title': 'Shaxsiy kirish talablaringizni tekshiring',
    'steps.check_entry_requirements.description':
      'Hujjat va safar holatingizga tegishli rasmiy talablarni ko‘ring. Shaxsiy huquqiy vaziyatda umumiy ro‘yxatga tayanmang.',
    'steps.check_entry_requirements.why': 'Talablar shaxsiy vaziyatga qarab farqlanadi va o‘zgarishi mumkin.',
    'steps.check_entry_requirements.prepare': 'Qabul xatlari va qo‘lingizdagi safar hujjatlari',
    'steps.notify_planned_arrival.title': 'Kelganlik haqida xabar berish tartibini aniqlang',
    'steps.notify_planned_arrival.description':
      'Qabul haqidagi rasmiy xatdagi xabar berish ko‘rsatmasini o‘qing va so‘ralsa belgilangan ITMO aloqasiga xabar bering.',
    'steps.notify_planned_arrival.why': 'Universitet xodimi kelish rejangizga mos yo‘l-yo‘riq beradi.',
    'steps.notify_planned_arrival.prepare': 'Rejalangan yoki haqiqiy kelish sanangiz',
    'steps.arrange_dormitory.title': 'Yotoqxona tartibini aniqlang',
    'steps.arrange_dormitory.description':
      'Safardan avval rasmiy joy ajratilishi yoki bronlash yo‘riqnomasini tekshiring. Aniq manzil, ish vaqti va kerakli narsalarni ITMOdan tasdiqlang.',
    'steps.arrange_dormitory.why': 'Tasdiqlangan tartib asossiz kelish rejasidan saqlaydi.',
    'steps.arrange_dormitory.prepare': 'Yotoqxona haqidagi rasmiy yozishmalar',
    'steps.obtain_health_insurance.title': 'Tibbiy sug‘urta talablarini tekshiring',
    'steps.obtain_health_insurance.description':
      'Sizga qaysi sug‘urta talablari tegishliligini universitet rasmiy aloqasidan so‘rang. Bu reja shaxsiy huquqiy xulosa bermaydi.',
    'steps.obtain_health_insurance.why': 'Qamrov va hujjatlar amaldagi qoidalar hamda vaziyatingizga bog‘liq.',
    'steps.obtain_health_insurance.prepare': 'Mavjud sug‘urta maʼlumoti',
    'steps.check_border_documents.title': 'Kirishda ishlatilgan yoki olingan hujjatlarni ko‘ring',
    'steps.check_border_documents.description':
      'Kirishda ishlatgan yoki olgan hujjatlarni saqlang va ular keyingi ishlarga qanday taʼsir qilishini rasmiy aloqa manzilidan so‘rang.',
    'steps.check_border_documents.why': 'Keyingi ko‘rsatmalar sizga berilgan hujjatlarga bog‘liq bo‘lishi mumkin.',
    'steps.check_border_documents.prepare': 'Safar va chegara kesib o‘tish hujjatlari',
    'steps.register_dorm_residence.title': 'Yotoqxonada yashashga oid ishlarni aniqlang',
    'steps.register_dorm_residence.description':
      'Yotoqxona yoki xorijiy talabalar bo‘limidan sizga qaysi yashashga oid ishlar tegishli va ularni kim bajarishini so‘rang.',
    'steps.register_dorm_residence.why': 'To‘g‘ri tartib va muddat shaxsiy holatingiz uchun tasdiqlanishi kerak.',
    'steps.register_dorm_residence.prepare': 'Yotoqxona va kelish hujjatlari',
    'steps.register_private_residence.title': 'Xususiy uyda yashashga oid ishlarni aniqlang',
    'steps.register_private_residence.description':
      'Universitetning rasmiy xorijiy talabalar aloqasi va qabul qiluvchi tomondan turar joyingizga qaysi ishlar tegishliligini so‘rang.',
    'steps.register_private_residence.why':
      'Majburiyatlar yotoqxona tartibidan farq qilishi va shaxsiy tasdiq talab qilishi mumkin.',
    'steps.register_private_residence.prepare': 'Turar joyingiz va qabul qiluvchi tomon haqida maʼlumot',
    'steps.check_migration_procedures.title': 'Qolgan migratsiya ishlarini ko‘rib chiqing',
    'steps.check_migration_procedures.description':
      'Rasmiy yo‘riqnomani xorijiy talabalar bo‘limi bilan ko‘ring. Bu yo‘naltiruvchi qadam, huquqiy maslahat emas.',
    'steps.check_migration_procedures.why': 'Shaxsiy tekshiruv umumiy qoidani noto‘g‘ri qo‘llash xavfini kamaytiradi.',
    'steps.check_migration_procedures.prepare': 'Hozirgi safar va yashash hujjatlaringiz',
    'steps.complete_first_days.title': 'Universitetdagi ilk kunlar sozlamalarini yakunlang',
    'steps.complete_first_days.description':
      'ITMO talabalar xizmatlarining amaldagi yo‘riqnomasini o‘qing va faqat sizga belgilangan ishlarni bajaring.',
    'steps.complete_first_days.why': 'Bu o‘qishga kerakli xizmatlarga kirishga yordam beradi.',
    'steps.complete_first_days.prepare': 'ITMO akkauntingiz yoki qabul maʼlumoti',
    'steps.orientation_support.title': 'Moslashuv va yordam imkoniyatlarini ko‘ring',
    'steps.orientation_support.description':
      'Amaldagi rasmiy moslashuv va yordam imkoniyatlarini ko‘ring. Qatnashish tafsilotlarini ITMOning yangi eʼlonlaridan tasdiqlang.',
    'steps.orientation_support.why': 'Yordam tadbirlari o‘qish va kundalik hayotga moslashishni osonlashtiradi.',
    'steps.orientation_support.prepare': 'Jadvalingiz va ITMOning amaldagi eʼlonlari',
  },
  tk: {
    'steps.directory.why': 'Uniwersitetiň tertibi kampusa, kabul ediliş ýagdaýyňyza we şahsy şertleriňize bagly.',
    'steps.directory.first.title': 'Uniwersitetiňizdäki ilkinji ädimleri barlaň',
    'steps.directory.first.description':
      'Uniwersitetiň resmi görkezmesini açyň. Kampusyňyz we okuw maksatnamaňyz üçin häzirki tertibi anyklaň; bu maglumatnamany uniwersitet tassyklamady.',
    'steps.directory.foreign.title': 'Daşary ýurtly talyplar üçin görkezmäni barlaň',
    'steps.directory.foreign.description':
      'Çap edilen görkezmäniň raýatlygyňyza, kampusyňyza we ýurda giriş ýagdaýyňyza degişlidigini barlaň. Seneleri uniwersitetden tassyklaň.',
    'steps.directory.housing.title': 'Uniwersitet ýaşaýyş jaýyňyzyň ýagdaýyny anyklaň',
    'steps.directory.housing.description':
      'Özüňize ýaşaýyş jaýy bellenendigini ýa-da arzanyň ýagdaýyny uniwersitetden barlaň. Arza ýer berilmegini kepillendirmeýär.',
    'steps.common.why': 'Indiki iş ýagdaýyňyza bagly; tassyklanmadyk sene möhlet däldir.',
    'steps.common.housing.title': 'Nirede ýaşajakdygyňyzy anyklaň',
    'steps.common.enrollment.title': 'Okuwa kabul ediliş ýagdaýyňyzy barlaň',
    'steps.common.enrollment.description':
      'Kabul edilenden soňky görkezmelere esaslanmazdan öň uniwersitet habaryny ýa-da şahsy hasabyňyzy barlaň.',
    'steps.common.housing.description':
      'Ýaşaýyş jaýyndan ýer bellenendigi ýa-da başga salgy gerekdigini barlaň. Diňe arza bil baglamaň.',
    'steps.common.rf_registration.title': 'Wagtlaýyn hasaba alyş size degişlimi, barlaň',
    'steps.common.rf_registration.description':
      'Başga salgyda 90 günden köp wagtlaýyn ýaşasaňyz, şol ýerdäki hasaba alyş barada öý eýesinden ýa-da ýaşaýyş jaýyndan soraň. Hakyky ýaşaýan ýeriňizi üýtgetmek üçin aýratyn ýedi günlük düzgün bar. Size haýsy ýagdaý degişli we haçan geldiňiz? Sene goýmazdan öň kadadan çykmalary barlaň.',
    'steps.common.military.title': 'Harby hasap size degişlimi, barlaň',
    'steps.common.military.description':
      'Harby hasaba degişli bolup, täze wagtlaýyn ýaşaýan ýeriňize göçseňiz, göçüşi iki hepdäniň içinde habar bermelimi, degişli bölümden soraň. Bu diňe jynsa däl, ýagdaýyňyza we wakanyň senesine bagly; okuw öz-özünden yza süýşürmegi kepillendirmeýär.',
    'steps.common.foreign_entry.title': 'Şahsy giriş şertleriňizi barlaň',
    'steps.common.foreign_entry.description':
      'Giriş resminamalaryňyzy we uniwersitetiň häzirki görkezmelerini anyklaň. Wizaly we wizasyz ýagdaýlar tapawutlanýar.',
    'steps.common.visa_entry.title': 'Wiza bilen giriş şertlerini anyklaň',
    'steps.common.visa_entry.description':
      'Size degişli wiza we giriş resminamalaryny olary beren edara hem-de uniwersitet bilen barlaň. Umumy möhlet çaklanylmaýar.',
    'steps.common.visa_free_entry.title': 'Wizasyz giriş şertlerini anyklaň',
    'steps.common.visa_free_entry.description':
      'Raýatlygyňyza we saparyň maksadyna degişli şertleri resmi çeşmelerden we uniwersitetden barlaň.',
    'steps.common.current_stay.title': 'Häzirki ýaşamak şertleriňizi anyklaň',
    'steps.common.current_stay.description':
      'Eger Russiýada bolsaňyz, häzirki hukuk ýagdaýyňyzyň we hakyky salgyňyzyň indiki ädimlere täsirini uniwersitetden soraň.',
    'steps.common.foreign_stay.title': 'Hakyky salgyňyz boýunça işleri anyklaň',
    'steps.common.foreign_stay.description':
      'Hakyky salgyňyzy we kabul edýän tarapy anyklaň: ýaşaýyş jaýynyň ýolbaşçylygy, myhmanhana ýa-da öý eýesi. Adatça şol tarap ýedi iş gününiň içinde geleniňizi habar berýär, ýöne raýatlyk we ýagdaý boýunça kadadan çykmalar bar. Uniwersitetiň sizden haýsy resminamalary isleýändigini soraň; onuň içerki möhleti aýratyn.',
    'steps.common.medical_2026.title': 'Täze lukmançylyk barlagynyň möhleti size degişlimi, barlaň',
    'steps.common.medical_2026.description':
      '2026-njy ýylyň 1-nji sentýabryndan başlap Russiýa 90 günden köp möhlete giren bolsaňyz, Içeri işler ministrligi lukmançylyk barlagy üçin girişden soň 30 senenama gününi görkezýär. Kadadan çykmalary we öňki güýjündäki barlagy uniwersitetden anyklaň. Barmak yzyny tabşyrmak aýratyn iş; şertleriňiz tassyklanman sene hasaplanmaýar.',
    'steps.common.amina.title': 'Amina şahsy ýaşaýyş jaýyňyza degişlimi, barlaň',
    'steps.common.amina.description':
      'Amina Moskwada ýa-da sebitinde şahsy jaýda ýaşaýan, 90 günden köp möhlete wizasyz giren käbir uly ýaşlylara degişlidir. Ilki raýatlygy, ýaşamak rugsadyny, ýaşy, hakyky salgyny we giriş senesini degişli edaradan barlaň. Ýaşaýyş jaýy we myhmanhana üçin hasaba alyş tertibi başga. Ähli şertler gabat gelmese, Aminany hasaba alyşyň ornuna ulanmaň.',
    'contact.official.instruction': 'Şahsy jogap üçin ýagdaýyňyza laýyk ITMO-nyň resmi aragatnaşygyna ýüz tutuň.',
    'contact.international':
      'Daşary ýurtly talyplary okatmak we goldamak merkezi: int.students@itmo.ru. Şahsy maglumat ibermezden öň resmi aragatnaşyk sahypasyny barlaň.',
    'contact.migration':
      'Migrasiýa gullugy: omu@itmo.ru. Şahsy görkezmeleri ITMO-nyň resmi aragatnaşyk sahypasyndan anyklaň.',
    'contact.dormitory':
      'Ýaşaýyş jaýy we gelmek baradaky maglumatlary bellenen aragatnaşykdan anyklaň; migrasiýa soraglaryny omu@itmo.ru salgysyna iberip bilersiňiz.',
    'contact.student_services':
      'Talyplara hyzmat ediş bölümi: so@itmo.ru. Soragyňyz üçin şu bölümiň jogapkärdigini barlaň.',
    'knowledge.not_found': 'Elýeterli çeşmelerde tassyklanan jogap tapylmady.',
    'knowledge.contact_next': 'Şahsy jogap üçin resmi aragatnaşyga ýüz tutuň.',
    'knowledge.source': 'Resmi çeşme',
    'knowledge.valid_as_of': 'Maglumat {{date}} senesinde barlandy',
    'event.accommodation.changed': 'Ýaşaýan ýerim üýtgedi',
    'event.confirm_notice': 'Bu üýtgeşmäni tassyklaman hiç zat üýtgemez.',
    'event.unsupported': 'Bu üýtgeşmäni ygtybarly anyklap bilmedim. Görnüşi saýlaň ýa-da hünärmene ýüz tutuň.',
    'reminders.opt_in': 'Ýatlatmalary açmak',
    'reminders.opt_out': 'Ýatlatmalary öçürmek',
    'reminders.consent': 'Ýatlatmalar diňe açyk razylygyňyzdan soň iberilýär.',
    'error.network': 'Hyzmat wagtlaýyn elýeterli däl. Girizen maglumatlaryňyz ýitmedi.',
    'error.invalid_answer': 'Bar bolan görnüşi saýlaň ýa-da dogry sene giriziň.',
    'steps.check_entry_requirements.title': 'Şahsy giriş talaplaryňyzy barlaň',
    'steps.check_entry_requirements.description':
      'Resminamalaryňyza we sapar ýagdaýyňyza degişli resmi talaplary okaň. Şahsy hukuk ýagdaýynda umumy sanawa bil baglamaň.',
    'steps.check_entry_requirements.why': 'Talaplar şahsy ýagdaý boýunça tapawutlanyp we üýtgäp biler.',
    'steps.check_entry_requirements.prepare': 'Kabul hatlaryňyz we eliňizdäki ýol resminamalary',
    'steps.notify_planned_arrival.title': 'Gelşi habar bermegiň tertibini anyklaň',
    'steps.notify_planned_arrival.description':
      'Kabul ediş baradaky resmi hatdaky habar beriş görkezmesini barlaň; soralsa, ITMO-nyň bellenen aragatnaşygyna habar beriň.',
    'steps.notify_planned_arrival.why': 'Uniwersitetiň wekili gelmek meýilnamaňyza laýyk maslahat berip biler.',
    'steps.notify_planned_arrival.prepare': 'Meýilleşdirilen ýa-da hakyky gelen senäňiz',
    'steps.arrange_dormitory.title': 'Ýaşaýyş jaýynyň tertibini anyklaň',
    'steps.arrange_dormitory.description':
      'Sapardan öň resmi ýer berlişini ýa-da bron görkezmesini barlaň. Takyk salgyny, iş wagtyny we gerekli zatlary ITMO-dan tassyklaň.',
    'steps.arrange_dormitory.why': 'Tassyklanan tertip esassyz gelmek meýilnamasyndan gorar.',
    'steps.arrange_dormitory.prepare': 'Ýaşaýyş jaýy baradaky resmi hatlaryňyz',
    'steps.obtain_health_insurance.title': 'Saglyk ätiýaçlandyryş talaplaryny barlaň',
    'steps.obtain_health_insurance.description':
      'Size degişli saglyk ätiýaçlandyryş talaplaryny uniwersitetiň resmi aragatnaşygyndan soraň. Bu meýilnama şahsy hukuk netijesini bermeýär.',
    'steps.obtain_health_insurance.why': 'Gorag we resminamalar häzirki düzgünlere we ýagdaýyňyza bagly.',
    'steps.obtain_health_insurance.prepare': 'Bar bolan ätiýaçlandyryş maglumatlary',
    'steps.check_border_documents.title': 'Girişde ulanylan ýa-da alnan resminamalary gözden geçiriň',
    'steps.check_border_documents.description':
      'Girişde ulanan ýa-da alan resminamalaryňyzy saklaň we olaryň indiki ädimlere täsirini resmi aragatnaşykdan soraň.',
    'steps.check_border_documents.why': 'Soňky görkezmeler ýagdaýyňyzda berlen resminamalara bagly bolup biler.',
    'steps.check_border_documents.prepare': 'Sapar we serhetden geçiş resminamalary',
    'steps.register_dorm_residence.title': 'Ýaşaýyş jaýynda ýaşamak bilen bagly işleri anyklaň',
    'steps.register_dorm_residence.description':
      'Ýaşaýyş jaýynyň jogapkär işgärinden ýa-da daşary ýurtly talyplar bölüminden size haýsy işleri etmelidigini we olary kimiň ýerine ýetirýändigini soraň.',
    'steps.register_dorm_residence.why': 'Dogry tertip we möhlet şahsy ýagdaýyňyz üçin tassyklanmaly.',
    'steps.register_dorm_residence.prepare': 'Ýaşaýyş jaýy we gelmek resminamalary',
    'steps.register_private_residence.title': 'Şahsy jaýda ýaşamak bilen bagly işleri anyklaň',
    'steps.register_private_residence.description':
      'Uniwersitetiň resmi daşary ýurtly talyplar aragatnaşygyndan we kabul edýän tarapdan ýaşaýyş jaýyňyza haýsy işleriň degişlidigini soraň.',
    'steps.register_private_residence.why':
      'Jogapkärçilik ýaşaýyş jaýynyň tertibinden tapawutlanyp, şahsy tassyklamany talap edip biler.',
    'steps.register_private_residence.prepare': 'Ýaşaýan ýeriňiz we kabul edýän tarap barada maglumat',
    'steps.check_migration_procedures.title': 'Galan migrasiýa işlerini gözden geçiriň',
    'steps.check_migration_procedures.description':
      'Resmi görkezmäni daşary ýurtly talyplar bölümi bilen okaň. Bu ugrukdyryjy ädim, hukuk maslahaty däl.',
    'steps.check_migration_procedures.why': 'Şahsy barlag umumy düzgüni nädogry ulanmak howpuny azaldýar.',
    'steps.check_migration_procedures.prepare': 'Häzirki ýol we ýaşamak resminamalaryňyz',
    'steps.complete_first_days.title': 'Uniwersitetiň ilkinji günlerindäki işleri tamamlaň',
    'steps.complete_first_days.description':
      'ITMO-nyň talyp hyzmatlary baradaky häzirki görkezmesini okaň we diňe size degişli işleri ýerine ýetiriň.',
    'steps.complete_first_days.why': 'Bu okuw üçin zerur hyzmatlara girmegiňize kömek edýär.',
    'steps.complete_first_days.prepare': 'ITMO hasabyňyz ýa-da kabul ediş maglumatlary',
    'steps.orientation_support.title': 'Uýgunlaşma we goldaw mümkinçiliklerini barlaň',
    'steps.orientation_support.description':
      'Häzirki resmi uýgunlaşma we goldaw mümkinçiliklerini görüň. Gatnaşmak şertlerini ITMO-nyň täze bildirişlerinden anyklaň.',
    'steps.orientation_support.why': 'Goldaw çäreleri okuw we gündelik durmuşa uýgunlaşmagy ýeňilleşdirýär.',
    'steps.orientation_support.prepare': 'Okuw tertibiňiz we ITMO-nyň häzirki bildirişleri',
  },
  'zh-CN': {
    'steps.directory.why': '学校办理流程取决于校区、录取状态和个人情况。',
    'steps.directory.first.title': '核实学校的入学后第一步',
    'steps.directory.first.description': '打开学校官方指南，确认适用于所在校区和专业的现行流程；本目录未经学校审核。',
    'steps.directory.foreign.title': '核实国际学生指南',
    'steps.directory.foreign.description': '确认公开指南是否适用于您的国籍、校区和入境情况，并向学校核实日期。',
    'steps.directory.housing.title': '确认学校住宿安排',
    'steps.directory.housing.description': '向学校核实个人宿舍分配结果或申请状态。提交申请不保证获得床位。',
    'steps.common.why': '下一步取决于您的情况；未经核实的日期不能当作截止日期。',
    'steps.common.housing.title': '确认居住地点',
    'steps.common.enrollment.title': '确认录取状态',
    'steps.common.enrollment.description': '在依据录取后的指南行动前，先查看学校通知或个人账户。',
    'steps.common.housing.description': '确认是否已分配宿舍床位，或是否需要另行安排住址；不要仅凭申请判断。',
    'steps.common.rf_registration.title': '核实是否需要办理临时登记',
    'steps.common.rf_registration.description':
      '如果您在另一个地址临时居住超过90天，请向房东或宿舍询问该地址的登记手续。实际常住地变更另有七天规定。请先弄清自己属于哪种居住情形、何时抵达，并核实例外情况后再确定日期。',
    'steps.common.military.title': '核实自己是否需要办理兵役登记',
    'steps.common.military.description':
      '如果您有兵役登记义务并搬到新的临时居住地，请向主管部门核实是否须在两周内报告迁居。这取决于身份和事件日期，不能只按性别判断；在校学习本身不保证缓征。',
    'steps.common.foreign_entry.title': '核实个人入境条件',
    'steps.common.foreign_entry.description': '确认自己的入境文件及学校现行说明。持签证与免签入境的情形不同。',
    'steps.common.visa_entry.title': '确认持签证入境条件',
    'steps.common.visa_entry.description': '向签发机关和学校核实适用于您的签证及入境文件；不预设统一期限。',
    'steps.common.visa_free_entry.title': '确认免签入境条件',
    'steps.common.visa_free_entry.description': '向官方渠道和学校核实适用于您国籍及旅行目的的条件。',
    'steps.common.current_stay.title': '确认目前在俄居留条件',
    'steps.common.current_stay.description': '如果已经在俄罗斯，请向学校询问当前身份和实际住址如何影响后续手续。',
    'steps.common.foreign_stay.title': '确认实际住址相关手续',
    'steps.common.foreign_stay.description':
      '确认实际住址及接待方是谁：宿舍管理处、酒店或私人房东。通常由接待方在七个工作日内申报到达，但国籍和身份可能带来例外。向学校询问您需提供哪些材料；学校的内部期限另行计算。',
    'steps.common.medical_2026.title': '核实新体检期限是否适用',
    'steps.common.medical_2026.description':
      '如果您自2026年9月1日起入境俄罗斯并拟停留超过90天，俄内务部规定体检期限为入境后30个自然日。请与学校核实例外情况及此前有效的体检。指纹采集是另一项手续；个人条件未确认前不计算日期。',
    'steps.common.amina.title': '核实私人住所是否适用Amina',
    'steps.common.amina.description':
      'Amina适用于部分免签入境超过90天、在莫斯科市或州私人住宅居住的成年人。请先向主管部门核实国籍、居留许可、年龄、实际住址和入境日期。宿舍和酒店采用不同的登记流程。只有全部条件均符合时，才可考虑该流程，不能直接用Amina替代登记。',
    'contact.official.instruction': '请通过适合您情况的ITMO官方联系方式获取个人答复。',
    'contact.international': '国际学生学习与支持中心：int.students@itmo.ru。发送个人信息前请先核对官方联系页面。',
    'contact.migration': '移民事务办公室：omu@itmo.ru。请通过ITMO官方联系页面核实个人指引。',
    'contact.dormitory': '请向指定联系人核实宿舍和到达事宜；移民事务问题可发至omu@itmo.ru。',
    'contact.student_services': '学生服务办公室：so@itmo.ru。请确认该部门负责您的问题。',
    'knowledge.not_found': '现有资料中没有找到已核实的答案。',
    'knowledge.contact_next': '请联系官方部门获取针对个人情况的答复。',
    'knowledge.source': '官方来源',
    'knowledge.valid_as_of': '资料核查日期：{{date}}',
    'event.accommodation.changed': '我的住处变了',
    'event.confirm_notice': '确认此更改前，不会修改任何信息。',
    'event.unsupported': '无法可靠识别这一更改。请选择选项或联系工作人员。',
    'reminders.opt_in': '开启提醒',
    'reminders.opt_out': '关闭提醒',
    'reminders.consent': '只有获得您的明确同意后才会发送提醒。',
    'error.network': '服务暂时无法使用，您输入的内容没有丢失。',
    'error.invalid_answer': '请选择现有选项或输入有效日期。',
    'steps.check_entry_requirements.title': '核实个人入境要求',
    'steps.check_entry_requirements.description':
      '查看适用于您文件和旅行情况的官方要求。个人法律问题不能仅凭通用清单判断。',
    'steps.check_entry_requirements.why': '要求可能因个人情况而异，也可能发生变化。',
    'steps.check_entry_requirements.prepare': '录取邮件和已有的旅行文件',
    'steps.notify_planned_arrival.title': '确认到达通知要求',
    'steps.notify_planned_arrival.description': '查看官方录取邮件中的到达通知说明；如有要求，请通知指定的ITMO联系人。',
    'steps.notify_planned_arrival.why': '学校联系人可提供符合您到达计划的指引。',
    'steps.notify_planned_arrival.prepare': '计划或实际到达日期',
    'steps.arrange_dormitory.title': '确认宿舍安排',
    'steps.arrange_dormitory.description':
      '出发前核实官方宿舍分配结果或预约说明。确切地址、办公时间和所需物品须向ITMO确认。',
    'steps.arrange_dormitory.why': '确认安排可避免依据未经证实的计划出行。',
    'steps.arrange_dormitory.prepare': '宿舍相关官方邮件',
    'steps.obtain_health_insurance.title': '核实医疗保险要求',
    'steps.obtain_health_insurance.description':
      '向学校官方联系人询问哪些医疗保险要求适用于您。此路线不作个人法律判断。',
    'steps.obtain_health_insurance.why': '保障范围和材料取决于现行规定及个人情况。',
    'steps.obtain_health_insurance.prepare': '已有的保险资料',
    'steps.check_border_documents.title': '检查入境时使用或取得的文件',
    'steps.check_border_documents.description': '保留入境时使用或取得的文件，并向官方联系人询问它们对后续步骤的影响。',
    'steps.check_border_documents.why': '后续指引可能取决于您实际取得的文件。',
    'steps.check_border_documents.prepare': '旅途及过境文件',
    'steps.register_dorm_residence.title': '确认宿舍居住相关手续',
    'steps.register_dorm_residence.description': '向宿舍或国际学生事务负责人询问哪些居住手续适用，以及由谁办理。',
    'steps.register_dorm_residence.why': '正确流程和时间应根据个人情况确认。',
    'steps.register_dorm_residence.prepare': '宿舍和到达文件',
    'steps.register_private_residence.title': '确认私人住所相关手续',
    'steps.register_private_residence.description': '向学校国际学生事务联系人和接待方询问哪些居住手续适用于您的住所。',
    'steps.register_private_residence.why': '责任可能与宿舍流程不同，需要针对个人情况确认。',
    'steps.register_private_residence.prepare': '住所及接待方信息',
    'steps.check_migration_procedures.title': '检查其余移民事务手续',
    'steps.check_migration_procedures.description':
      '与国际学生事务联系人一起核对官方指南。这是导航步骤，不是法律建议。',
    'steps.check_migration_procedures.why': '针对个人情况核实可降低误用通用规则的风险。',
    'steps.check_migration_procedures.prepare': '现有旅行与居留文件',
    'steps.complete_first_days.title': '完成开学初期设置',
    'steps.complete_first_days.description': '查看ITMO现行学生服务说明，只完成分配给自己的设置步骤。',
    'steps.complete_first_days.why': '这有助于使用学习所需的服务。',
    'steps.complete_first_days.prepare': 'ITMO账号或录取资料',
    'steps.orientation_support.title': '查看新生适应与支持活动',
    'steps.orientation_support.description': '查看现行官方新生适应及支持机会；参与细节以ITMO最新公告为准。',
    'steps.orientation_support.why': '支持活动有助于适应学习和日常生活。',
    'steps.orientation_support.prepare': '您的日程及ITMO最新公告',
  },
  hi: {
    'steps.directory.why':
      'विश्वविद्यालय की प्रक्रिया आपके परिसर, दाखिले की स्थिति और व्यक्तिगत परिस्थितियों पर निर्भर करती है।',
    'steps.directory.first.title': 'अपने विश्वविद्यालय के शुरुआती कदम जाँचें',
    'steps.directory.first.description':
      'विश्वविद्यालय का आधिकारिक मार्गदर्शन खोलें। अपने परिसर और पाठ्यक्रम की वर्तमान प्रक्रिया की पुष्टि करें; यह निर्देशिका विश्वविद्यालय द्वारा अनुमोदित नहीं है।',
    'steps.directory.foreign.title': 'अंतरराष्ट्रीय छात्रों का मार्गदर्शन जाँचें',
    'steps.directory.foreign.description':
      'देखें कि प्रकाशित निर्देश आपकी नागरिकता, परिसर और प्रवेश की स्थिति पर लागू हैं या नहीं। तारीखों की पुष्टि विश्वविद्यालय से करें।',
    'steps.directory.housing.title': 'विश्वविद्यालय आवास की व्यवस्था की पुष्टि करें',
    'steps.directory.housing.description':
      'अपना आवास आवंटन या आवेदन विश्वविद्यालय से जाँचें। आवेदन करने से कमरा मिलने की गारंटी नहीं होती।',
    'steps.common.why': 'अगला काम आपकी स्थिति पर निर्भर है; अपुष्ट तारीख अंतिम तिथि नहीं है।',
    'steps.common.housing.title': 'पुष्टि करें कि आप कहाँ रहेंगे',
    'steps.common.enrollment.title': 'दाखिले की स्थिति की पुष्टि करें',
    'steps.common.enrollment.description':
      'दाखिले के बाद के निर्देशों पर निर्भर होने से पहले विश्वविद्यालय की घोषणा या अपना खाता जाँचें।',
    'steps.common.housing.description':
      'जाँचें कि छात्रावास में स्थान मिला है या किसी अन्य पते की व्यवस्था करनी है। केवल आवेदन पर निर्भर न रहें।',
    'steps.common.rf_registration.title': 'जाँचें कि अस्थायी पंजीकरण लागू है या नहीं',
    'steps.common.rf_registration.description':
      'अगर आप दूसरे पते पर 90 दिनों से अधिक अस्थायी रूप से रहते हैं, तो वहाँ के पंजीकरण के बारे में मकान मालिक या छात्रावास से पूछें। वास्तविक स्थायी निवास बदलने के लिए अलग सात-दिन का नियम है। आप पर किस तरह का निवास लागू है और आप कब आए? तारीख तय करने से पहले अपवाद जाँचें।',
    'steps.common.military.title': 'जाँचें कि सैन्य पंजीकरण आप पर लागू है या नहीं',
    'steps.common.military.description':
      'अगर आप सैन्य पंजीकरण के दायरे में आते हैं और नए अस्थायी निवास पर गए हैं, तो संबंधित कार्यालय से पूछें कि क्या दो सप्ताह में स्थानांतरण की सूचना देनी है। यह केवल लिंग से नहीं, आपकी स्थिति और घटना की तारीख से तय होता है; पढ़ाई अपने आप छूट की गारंटी नहीं है।',
    'steps.common.foreign_entry.title': 'अपने प्रवेश की व्यक्तिगत शर्तें जाँचें',
    'steps.common.foreign_entry.description':
      'अपने प्रवेश दस्तावेज़ और विश्वविद्यालय के वर्तमान निर्देश जाँचें। वीज़ा और वीज़ा-मुक्त स्थितियाँ अलग हैं।',
    'steps.common.visa_entry.title': 'वीज़ा से प्रवेश की शर्तें स्पष्ट करें',
    'steps.common.visa_entry.description':
      'अपने लिए लागू वीज़ा और प्रवेश दस्तावेज़ जारी करने वाले प्राधिकरण और विश्वविद्यालय से जाँचें। कोई सार्वभौमिक समय-सीमा नहीं मानी जाती।',
    'steps.common.visa_free_entry.title': 'वीज़ा-मुक्त प्रवेश की शर्तें स्पष्ट करें',
    'steps.common.visa_free_entry.description':
      'अपनी नागरिकता और यात्रा के उद्देश्य पर लागू शर्तें आधिकारिक स्रोतों और विश्वविद्यालय से जाँचें।',
    'steps.common.current_stay.title': 'वर्तमान निवास की शर्तें स्पष्ट करें',
    'steps.common.current_stay.description':
      'यदि आप पहले से रूस में हैं, तो विश्वविद्यालय से पूछें कि आपकी वर्तमान स्थिति और वास्तविक पता अगले कदमों को कैसे प्रभावित करते हैं।',
    'steps.common.foreign_stay.title': 'अपने वास्तविक पते से जुड़े काम स्पष्ट करें',
    'steps.common.foreign_stay.description':
      'अपना वास्तविक पता और मेज़बान तय करें: छात्रावास प्रशासन, होटल या निजी मकान मालिक। आम तौर पर मेज़बान सात कार्यदिवसों में आगमन की सूचना देता है, लेकिन नागरिकता और स्थिति के अनुसार अपवाद हैं। विश्वविद्यालय से पूछें कि उसे आपसे कौन-से दस्तावेज़ चाहिए; उसकी आंतरिक समय-सीमा अलग है।',
    'steps.common.medical_2026.title': 'जाँचें कि नई चिकित्सा-जाँच अवधि लागू है या नहीं',
    'steps.common.medical_2026.description':
      'यदि आपने 1 सितंबर 2026 से रूस में 90 दिनों से अधिक रहने के लिए प्रवेश किया है, तो गृह मंत्रालय प्रवेश से 30 कैलेंडर दिन के भीतर चिकित्सा जाँच बताता है। अपवाद और पहले की वैध जाँच विश्वविद्यालय से जाँचें। फिंगरप्रिंट देना अलग काम है; व्यक्तिगत शर्तें पुष्ट हुए बिना तारीख नहीं निकाली जाती।',
    'steps.common.amina.title': 'जाँचें कि आपके निजी आवास पर Amina लागू है या नहीं',
    'steps.common.amina.description':
      'Amina मॉस्को शहर या क्षेत्र में निजी घर में रहने वाले, 90 दिनों से अधिक के लिए वीज़ा-मुक्त प्रवेश करने वाले कुछ वयस्कों पर लागू है। पहले नागरिकता, निवास अनुमति, आयु, वास्तविक पता और प्रवेश तारीख जिम्मेदार कार्यालय से जाँचें। छात्रावास और होटल की पंजीकरण प्रक्रिया अलग है। सभी शर्तें पूरी हुए बिना Amina को पंजीकरण का विकल्प न मानें।',
    'contact.official.instruction':
      'व्यक्तिगत उत्तर के लिए अपनी स्थिति से संबंधित ITMO के आधिकारिक संपर्क का उपयोग करें।',
    'contact.international':
      'अंतरराष्ट्रीय छात्र शिक्षा और सहायता केंद्र: int.students@itmo.ru। निजी जानकारी भेजने से पहले आधिकारिक संपर्क पृष्ठ जाँचें।',
    'contact.migration':
      'प्रवासन सेवा कार्यालय: omu@itmo.ru। व्यक्तिगत निर्देश ITMO के आधिकारिक संपर्क पृष्ठ से पुष्ट करें।',
    'contact.dormitory':
      'छात्रावास और आगमन का विवरण अपने नियुक्त संपर्क से पुष्ट करें; प्रवासन प्रश्न omu@itmo.ru पर भेज सकते हैं।',
    'contact.student_services': 'छात्र सेवा कार्यालय: so@itmo.ru। जाँचें कि आपका प्रश्न इसी कार्यालय से संबंधित है।',
    'knowledge.not_found': 'उपलब्ध स्रोतों में पुष्ट उत्तर नहीं मिला।',
    'knowledge.contact_next': 'व्यक्तिगत उत्तर के लिए आधिकारिक संपर्क से पूछें।',
    'knowledge.source': 'आधिकारिक स्रोत',
    'knowledge.valid_as_of': 'जानकारी की जाँच {{date}} को हुई',
    'event.accommodation.changed': 'मेरा आवास बदल गया है',
    'event.confirm_notice': 'इस बदलाव की पुष्टि करने तक कुछ नहीं बदलेगा।',
    'event.unsupported':
      'मैं इस बदलाव को सुरक्षित रूप से पहचान नहीं पाया। विकल्प चुनें या किसी व्यक्ति से संपर्क करें।',
    'reminders.opt_in': 'रिमाइंडर चालू करें',
    'reminders.opt_out': 'रिमाइंडर बंद करें',
    'reminders.consent': 'रिमाइंडर केवल आपकी स्पष्ट सहमति के बाद भेजे जाते हैं।',
    'error.network': 'सेवा अभी उपलब्ध नहीं है। आपकी दर्ज जानकारी नष्ट नहीं हुई है।',
    'error.invalid_answer': 'उपलब्ध विकल्प चुनें या सही तारीख दर्ज करें।',
    'steps.check_entry_requirements.title': 'अपनी व्यक्तिगत प्रवेश आवश्यकताएँ जाँचें',
    'steps.check_entry_requirements.description':
      'अपने दस्तावेज़ और यात्रा की स्थिति पर लागू आधिकारिक नियम पढ़ें। व्यक्तिगत कानूनी मामले में सामान्य सूची पर निर्भर न रहें।',
    'steps.check_entry_requirements.why': 'आवश्यकताएँ व्यक्तिगत परिस्थितियों के अनुसार अलग और परिवर्तनशील हो सकती हैं।',
    'steps.check_entry_requirements.prepare': 'दाखिले के पत्र और आपके पास उपलब्ध यात्रा दस्तावेज़',
    'steps.notify_planned_arrival.title': 'आगमन की सूचना का तरीका स्पष्ट करें',
    'steps.notify_planned_arrival.description':
      'दाखिले के आधिकारिक पत्र में आगमन की सूचना देने के निर्देश जाँचें और माँगे जाने पर नियुक्त ITMO संपर्क को बताएँ।',
    'steps.notify_planned_arrival.why': 'विश्वविद्यालय संपर्क आपकी आगमन योजना के अनुसार सलाह दे सकता है।',
    'steps.notify_planned_arrival.prepare': 'योजनाबद्ध या वास्तविक आगमन तारीख',
    'steps.arrange_dormitory.title': 'छात्रावास व्यवस्था की पुष्टि करें',
    'steps.arrange_dormitory.description':
      'यात्रा से पहले आधिकारिक आवंटन या बुकिंग निर्देश जाँचें। सटीक पता, समय और आवश्यक वस्तुएँ ITMO से पुष्ट करें।',
    'steps.arrange_dormitory.why': 'पुष्ट व्यवस्था बिना आधार वाली आगमन योजना से बचाती है।',
    'steps.arrange_dormitory.prepare': 'छात्रावास संबंधी आधिकारिक पत्राचार',
    'steps.obtain_health_insurance.title': 'स्वास्थ्य बीमा की आवश्यकताएँ जाँचें',
    'steps.obtain_health_insurance.description':
      'विश्वविद्यालय के आधिकारिक संपर्क से पूछें कि आप पर कौन-से स्वास्थ्य बीमा नियम लागू होते हैं। यह मार्ग व्यक्तिगत कानूनी निर्णय नहीं देता।',
    'steps.obtain_health_insurance.why': 'कवरेज और दस्तावेज़ वर्तमान नियमों और आपकी परिस्थितियों पर निर्भर हैं।',
    'steps.obtain_health_insurance.prepare': 'मौजूदा बीमा की जानकारी',
    'steps.check_border_documents.title': 'प्रवेश पर मिले या उपयोग किए दस्तावेज़ देखें',
    'steps.check_border_documents.description':
      'प्रवेश के समय उपयोग किए या मिले दस्तावेज़ सुरक्षित रखें और आधिकारिक संपर्क से पूछें कि वे आगे के कदमों पर कैसे लागू होते हैं।',
    'steps.check_border_documents.why': 'आगे के निर्देश आपके मामले में जारी दस्तावेज़ों पर निर्भर हो सकते हैं।',
    'steps.check_border_documents.prepare': 'यात्रा और सीमा पार करने के दस्तावेज़',
    'steps.register_dorm_residence.title': 'छात्रावास निवास से जुड़े काम स्पष्ट करें',
    'steps.register_dorm_residence.description':
      'जिम्मेदार छात्रावास या अंतरराष्ट्रीय छात्र संपर्क से पूछें कि निवास संबंधी कौन-से काम लागू हैं और कौन उन्हें पूरा करता है।',
    'steps.register_dorm_residence.why': 'सही प्रक्रिया और समय आपके मामले में पुष्ट होना चाहिए।',
    'steps.register_dorm_residence.prepare': 'छात्रावास और आगमन दस्तावेज़',
    'steps.register_private_residence.title': 'निजी आवास से जुड़े काम स्पष्ट करें',
    'steps.register_private_residence.description':
      'आधिकारिक अंतरराष्ट्रीय छात्र संपर्क और जिम्मेदार मेज़बान से पूछें कि आपके आवास पर कौन-से निवास संबंधी काम लागू हैं।',
    'steps.register_private_residence.why': 'जिम्मेदारियाँ छात्रावास से अलग हो सकती हैं और व्यक्तिगत पुष्टि चाहिए।',
    'steps.register_private_residence.prepare': 'अपने आवास और मेज़बान की जानकारी',
    'steps.check_migration_procedures.title': 'बाकी प्रवासन कार्यों की समीक्षा करें',
    'steps.check_migration_procedures.description':
      'अंतरराष्ट्रीय छात्र संपर्क के साथ आधिकारिक निर्देश देखें। यह दिशा बताने वाला कदम है, कानूनी सलाह नहीं।',
    'steps.check_migration_procedures.why': 'व्यक्तिगत जाँच सामान्य नियम गलत लागू करने का जोखिम घटाती है।',
    'steps.check_migration_procedures.prepare': 'मौजूदा यात्रा और निवास दस्तावेज़',
    'steps.complete_first_days.title': 'विश्वविद्यालय के शुरुआती दिनों की व्यवस्था पूरी करें',
    'steps.complete_first_days.description':
      'ITMO छात्र सेवाओं के वर्तमान निर्देश देखें और केवल आपको दिए गए कदम पूरे करें।',
    'steps.complete_first_days.why': 'इससे पढ़ाई के लिए ज़रूरी सेवाओं तक पहुँच मिलती है।',
    'steps.complete_first_days.prepare': 'आपका ITMO खाता या दाखिले का विवरण',
    'steps.orientation_support.title': 'अनुकूलन और सहायता के विकल्प देखें',
    'steps.orientation_support.description':
      'वर्तमान आधिकारिक अनुकूलन और सहायता कार्यक्रम देखें। भागीदारी का विवरण ITMO की ताज़ा घोषणाओं से पुष्ट करें।',
    'steps.orientation_support.why': 'सहायता कार्यक्रम पढ़ाई और रोज़मर्रा के जीवन में ढलने में मदद कर सकते हैं।',
    'steps.orientation_support.prepare': 'आपकी समय-सारणी और ITMO की ताज़ा घोषणाएँ',
  },
};

export const routeOverlays: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.fromEntries(
  Object.entries(base).map(([language, copy]) => [language, { ...copy, ...researchOverlays[language] }]),
);
