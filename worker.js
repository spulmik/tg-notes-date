export default {
	async fetch(request, env) {
		return handleRequest(request, env)
	},
}

// Функция отправки сообщений в Telegram
async function sendMessage(chatId, text, token) {
	const url = `https://api.telegram.org/bot${token}/sendMessage`

	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			chat_id: chatId,
			text: text,
		}),
	})
}

async function handleRequest(request, env) {
	const BOT_TOKEN = env.BOT_TOKEN

	// Telegram шлет POST-запросы, когда кто-то пишет боту
	if (request.method === 'POST') {
		const update = await request.json()

		// Если пришло сообщение
		if (update.message) {
			const chatId = update.message.chat.id
			const text = update.message.text
			const userName = update.message.from.first_name

			let reply = ''

			if (text === '/start') {
				reply = `Йоу, ${userName}! 👋\n\nЯ бот на Cloudflare Workers, и я ваще не падаю.`
			} else if (text === '/help') {
				reply =
					'🤖 Команды:\n/start - Начать\n/help - Эта хуйня\n\nОстальное пока не завезли.'
			} else {
				reply = `Ты написал: "${text}"\n\n...и что мне с этим делать? 🤔`
			}

			await sendMessage(chatId, reply, BOT_TOKEN)
		}

		return new Response('OK', { status: 200 })
	}

	return new Response('🤖 Бот живой, здоровый, не ебет.', {
		status: 200,
	})
}