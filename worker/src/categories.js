// Настройки по умолчанию и правила автокатегорий.
// ВНИМАНИЕ: копия из js/script.js (DEFAULT_SETTINGS) и js/import.js (RULES) — при изменении править оба места.

export const DEFAULT_MONTH_TARGET = 100000;

export const DEFAULT_SETTINGS = {
  goal: 1000000,
  goalName: 'Главная цель',
  currency: '₽',
  theme: 'dark',
  categories: {
    income: ['Зарплата', 'Подработка', 'Подарки', 'Прочее'],
    expense: ['Жильё', 'Еда', 'Транспорт', 'Здоровье', 'Развлечения', 'Покупки', 'Прочее']
  }
};

const RULES = {
  expense: [
    ['Еда', /супермаркет|продукт|пят[её]рочк|магнит|перекр[её]ст|лента|ашан|вкусвилл|дикси|самокат|лавка|азбука вкуса|metro|окей|spar|спар|fix price|ресторан|кафе|фастфуд|кофе|coffee|макдон|вкусно|kfc|rostic|бургер|додо|пицц|суши|еда|eda\.|food|чижик|верный|светофор/i],
    ['Транспорт', /такси|taxi|транспорт|метро|metro\s?moscow|mosmetro|тройка|азс|топлив|бензин|лукойл|газпромнефть|роснефть|татнефть|shell|парков|каршеринг|делимобил|драйв|ситидрайв|ржд|аэрофлот|авиа|s7|победа|автобус|whoosh|юрент/i],
    ['Жильё', /жкх|коммунал|квартплат|ипотек|аренд|электроэнерг|энергосбыт|мосэнерго|водоканал|газ\b|домофон|интернет|ростелеком|мтс|билайн|мегафон|теле2|\bt2\b|связь|мобильн/i],
    ['Здоровье', /аптек|apteka|клиник|медиц|стоматол|здоров|горздрав|ригла|асна|анализ|инвитро|гемотест|врач/i],
    ['Развлечения', /кино|театр|развлеч|игр|steam|playstation|подписк|кинопоиск|\bivi\b|okko|spotify|яндекс плюс|плюс|музык|концерт|билет|боулинг|бар\b|клуб/i],
    ['Покупки', /ozon|озон|wildberries|вайлдберриз|\bwb\b|маркет|одежд|обув|dns|м\.?видео|эльдорадо|леруа|ikea|hoff|спортмастер|lamoda|золотое яблоко|aliexpress|детск|косметик|электроник|zara|gloria/i]
  ],
  income: [
    ['Зарплата', /зарплат|заработн|аванс|salary|оплата труда|премия/i],
    ['Проценты и кэшбэк', /кэшб[еэ]к|кешб[еэ]к|cashback|процент|вознагражд|бонус|начислен.*процент/i]
  ]
};

/**
 * Дополняет настройки значениями по умолчанию (как делает приложение при загрузке).
 * @param {object} [settings]
 * @returns {object}
 */
export function withDefaults(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    categories: { ...DEFAULT_SETTINGS.categories, ...settings.categories }
  };
}

/**
 * @param {'income' | 'expense'} type
 * @param {string} text
 * @returns {string | null}
 */
export function guessCategory(type, text) {
  for (const [category, pattern] of RULES[type]) {
    if (pattern.test(text)) return category;
  }
  return null;
}

/**
 * Категория и название операции: точное совпадение с категорией пользователя,
 * иначе правила, иначе «Прочее» (или первая категория).
 * @param {'income' | 'expense'} type
 * @param {string} text описание из команды
 * @param {{ income: string[], expense: string[] }} categories
 * @returns {{ category: string, name: string }}
 */
export function resolveCategory(type, text, categories) {
  const list = categories[type];
  const typed = text.trim();
  const exact = list.find(category => category.toLowerCase() === typed.toLowerCase());
  if (exact) return { category: exact, name: exact };

  const guessed = guessCategory(type, typed);
  const fallback = list.includes('Прочее') ? 'Прочее' : list[0];
  const category = guessed && list.includes(guessed) ? guessed : fallback;
  return { category, name: typed || category };
}
