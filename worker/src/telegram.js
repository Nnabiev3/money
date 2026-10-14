const API = 'https://api.telegram.org';

/**
 * Клиент Bot API. Сбои сети и ответы с ошибкой не выбрасываются, а возвращают null:
 * неудавшийся ответ пользователю не должен ронять обработку уже сохранённых данных.
 * @param {string} botToken
 * @param {typeof fetch} [fetchFn]
 */
export function createTelegram(botToken, fetchFn = fetch) {
  async function call(method, payload) {
    try {
      const response = await fetchFn(`${API}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        console.error('Ответ Telegram с ошибкой', method, response.status);
        return null;
      }
      return await response.json();
    } catch (error) {
      console.error('Запрос к Telegram не удался', method, error?.message);
      return null;
    }
  }

  return {
    send: (chatId, text, replyMarkup) => call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {})
    }),
    answerCallback: (callbackQueryId, text) => call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {})
    }),
    clearButtons: (chatId, messageId) => call('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] }
    })
  };
}

/** Кнопки Web App: главный экран и сразу выбор выписки. Inline, потому что у кнопки-клавиатуры initData пустой. */
export function appKeyboard(appUrl) {
  const importUrl = new URL(appUrl);
  importUrl.searchParams.set('action', 'import');
  return {
    inline_keyboard: [
      [{ text: '📊 Открыть приложение', web_app: { url: appUrl } }],
      [{ text: '📥 Добавить выписку', web_app: { url: importUrl.toString() } }]
    ]
  };
}

export const undoKeyboard = operationId => ({
  inline_keyboard: [[{ text: '↩️ Отменить', callback_data: `undo:${operationId}` }]]
});

export const confirmDeleteKeyboard = () => ({
  inline_keyboard: [[
    { text: '🗑 Да, удалить всё', callback_data: 'deleteall:yes' },
    { text: 'Отмена', callback_data: 'deleteall:no' }
  ]]
});
