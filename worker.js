const DAYS_TO_SHOW = 7;

export default {
    async fetch(request, env) {
        if (request.method !== "POST") {
            return new Response("OK");
        }

        try {
            const update = await request.json();

            if (update.message) {
                await handleMessage(update.message, env);
            }

            if (update.callback_query) {
                await handleCallbackQuery(update.callback_query, env);
            }

            return new Response("OK");
        } catch (error) {
            console.error("Worker error:", error);

            return new Response("Internal Server Error", {
                status: 500
            });
        }
    }
};


// =========================
// Telegram API
// =========================

async function telegram(method, body, env) {
    const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const result = await response.json();

    if (!result.ok) {
        console.error("Telegram API error:", result);
    }

    return result;
}


// =========================
// MESSAGE
// =========================

async function handleMessage(message, env) {
    const chatId = message.chat.id;
    const telegramId = message.from.id;

    // /start
    if (message.text?.trim() === "/start") {
        await saveUser(message, env);

        await showDatePicker(chatId, env);

        return;
    }

    // Проверяем состояние пользователя
    const state = await getState(telegramId, env);

    if (!state) {
        await showDatePicker(chatId, env);
        return;
    }

    // Пользователь должен ввести текст заметки
    if (state.state === "waiting_note") {
        const text = message.text?.trim();

        if (!text) {
            await telegram(
                "sendMessage",
                {
                    chat_id: chatId,
                    text: "✍️ Напиши текст или название заметки."
                },
                env
            );

            return;
        }

        await saveNote(
            telegramId,
            state.selected_date,
            text,
            env
        );

        await clearState(telegramId, env);

        const formattedDate = formatDate(state.selected_date);

        await telegram(
            "sendMessage",
            {
                chat_id: chatId,
                text:
                    `✅ <b>Запись сохранена</b>\n\n` +
                    `📅 ${formattedDate}\n\n` +
                    `📝 ${escapeHtml(text)}`,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "➕ Новая запись",
                                callback_data: "new_note"
                            }
                        ]
                    ]
                }
            },
            env
        );

        return;
    }
}


// =========================
// CALLBACK QUERY
// =========================

async function handleCallbackQuery(callbackQuery, env) {
    const callbackId = callbackQuery.id;
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const telegramId = callbackQuery.from.id;

    // Telegram notification исчезает
    await telegram(
        "answerCallbackQuery",
        {
            callback_query_id: callbackId
        },
        env
    );

    // Новая запись
    if (data === "new_note") {
        await showDatePicker(chatId, env);
        return;
    }

    // Выбор даты
    if (data.startsWith("date:")) {
        const selectedDate = data.substring(5);

        await saveState(
            telegramId,
            "waiting_note",
            selectedDate,
            env
        );

        const formattedDate = formatDate(selectedDate);

        await telegram(
            "sendMessage",
            {
                chat_id: chatId,
                text:
                    `📅 <b>${formattedDate}</b>\n\n` +
                    `✍️ Теперь напиши название или текст заметки:`,
                parse_mode: "HTML"
            },
            env
        );

        return;
    }
}


// =========================
// DATE PICKER
// =========================

async function showDatePicker(chatId, env) {
    const dates = getNextDays(DAYS_TO_SHOW);

    const keyboard = [];

    for (let i = 0; i < dates.length; i += 2) {
        const row = [];

        row.push({
            text: dates[i].label,
            callback_data: `date:${dates[i].value}`
        });

        if (dates[i + 1]) {
            row.push({
                text: dates[i + 1].label,
                callback_data: `date:${dates[i + 1].value}`
            });
        }

        keyboard.push(row);
    }

    await telegram(
        "sendMessage",
        {
            chat_id: chatId,
            text: "📅 <b>Выбери дату</b>:",
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: keyboard
            }
        },
        env
    );
}


// =========================
// DATABASE
// =========================

async function saveUser(message, env) {
    const telegramId = message.from.id;
    const username = message.from.username || null;
    const firstName = message.from.first_name || null;

    await env.DB
        .prepare(`
            INSERT INTO users (
                telegram_id,
                username,
                first_name
            )
            VALUES (?, ?, ?)
            ON CONFLICT(telegram_id)
            DO UPDATE SET
                username = excluded.username,
                first_name = excluded.first_name
        `)
        .bind(
            telegramId,
            username,
            firstName
        )
        .run();
}


async function saveNote(
    telegramId,
    selectedDate,
    text,
    env
) {
    const user = await env.DB
        .prepare(`
            SELECT id
            FROM users
            WHERE telegram_id = ?
        `)
        .bind(telegramId)
        .first();

    if (!user) {
        throw new Error("User not found");
    }

    await env.DB
        .prepare(`
            INSERT INTO notes (
                user_id,
                text,
                note_date
            )
            VALUES (?, ?, ?)
        `)
        .bind(
            user.id,
            text,
            selectedDate
        )
        .run();
}


// =========================
// STATE
// =========================

async function saveState(
    telegramId,
    state,
    selectedDate,
    env
) {
    await env.DB
        .prepare(`
            INSERT INTO bot_state (
                telegram_id,
                state,
                selected_date,
                updated_at
            )
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(telegram_id)
            DO UPDATE SET
                state = excluded.state,
                selected_date = excluded.selected_date,
                updated_at = CURRENT_TIMESTAMP
        `)
        .bind(
            telegramId,
            state,
            selectedDate
        )
        .run();
}


async function getState(telegramId, env) {
    return await env.DB
        .prepare(`
            SELECT
                telegram_id,
                state,
                selected_date
            FROM bot_state
            WHERE telegram_id = ?
        `)
        .bind(telegramId)
        .first();
}


async function clearState(telegramId, env) {
    await env.DB
        .prepare(`
            DELETE FROM bot_state
            WHERE telegram_id = ?
        `)
        .bind(telegramId)
        .run();
}


// =========================
// DATE HELPERS
// =========================

function getNextDays(count) {
    const result = [];

    const now = new Date();

    // Используем текущую дату UTC для MVP.
    // Часовой пояс потом вынесем в настройки пользователя.
    now.setUTCHours(0, 0, 0, 0);

    for (let i = 0; i < count; i++) {
        const date = new Date(now);

        date.setUTCDate(
            date.getUTCDate() + i
        );

        const value = date.toISOString().slice(0, 10);

        let label;

        if (i === 0) {
            label = "📅 Сегодня";
        } else if (i === 1) {
            label = "📅 Завтра";
        } else {
            label = date.toLocaleDateString(
                "ru-RU",
                {
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                    timeZone: "UTC"
                }
            );
        }

        result.push({
            value,
            label
        });
    }

    return result;
}


function formatDate(value) {
    const date = new Date(`${value}T00:00:00Z`);

    return date.toLocaleDateString(
        "ru-RU",
        {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
            timeZone: "UTC"
        }
    );
}


// =========================
// HTML ESCAPE
// =========================

function escapeHtml(text) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}