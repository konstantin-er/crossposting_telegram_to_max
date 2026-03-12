# Crossposting Bot: Telegram → MAX

Бот автоматически копирует посты из Telegram-каналов в каналы на платформе [MAX](https://max.ru). Поддерживает текст с форматированием (жирный, курсив, ссылки), фото, видео, GIF, документы и альбомы (media group).

## Как это работает

1. **TG Worker** (`src/telegram_worker.js`) слушает посты в Telegram через long-polling
2. При получении поста находит маппинг TG-канал → MAX-канал в SQLite БД
3. Конвертирует Telegram-форматирование в Markdown и отправляет пост в MAX через API
4. Все переносы логируются в БД (статус: pending / posted / failed)

## Требования

- Docker + Docker Compose
- Telegram-бот с правами администратора в TG-каналах
- MAX-бот с правами администратора в MAX-каналах

## Быстрый старт

### 1. Клонировать репозиторий

```bash
git clone <repo-url>
cd crossposting
```

### 2. Создать `.env`

```bash
cp .env.example .env
```

Отредактировать `.env`:

```env
PORT=3000
MAX_BOT_TOKEN=токен_MAX_бота
TELEGRAM_BOT_TOKEN=токен_Telegram_бота
```

- `MAX_BOT_TOKEN` — токен бота MAX (из настроек бота на платформе)
- `TELEGRAM_BOT_TOKEN` — токен Telegram-бота (от @BotFather)

### 3. Запустить через Docker Compose

```bash
docker compose up -d --build
```

Запустятся два контейнера:
- `crosspost-server` — REST API для управления маппингами (порт 3000)
- `crosspost-tg-worker` — воркер, слушающий Telegram

SQLite БД хранится в именованном Docker-томе (`sqlite_data`) и доступна обоим контейнерам.

### 4. Настроить маппинги каналов

Убедитесь, что Telegram-бот добавлен администратором в TG-канал и отправьте туда любой тестовый пост — бот запомнит канал.

Запустите интерактивный скрипт:

```bash
bash crosspost-map.sh
```

Скрипт предложит:
1. Выбрать Telegram-канал из списка виденных ботом каналов
2. Выбрать MAX-канал из списка каналов, где бот является участником
3. Сохранить маппинг

После этого все новые посты из выбранного TG-канала будут автоматически появляться в выбранном MAX-канале.

## Управление маппингами

Через скрипт `crosspost-map.sh` доступны команды:

| Команда | Действие |
|---------|----------|
| `[a]` | Добавить маппинг TG → MAX |
| `[d]` | Удалить маппинг |
| `[t]` | Включить / выключить маппинг |
| `[q]` | Выйти |

## REST API

Все эндпоинты требуют `?token=<MAX_BOT_TOKEN>`.

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/health` | Проверка работоспособности сервера |
| `GET` | `/api/admin/tg-channels` | Список TG-каналов, которые видел бот |
| `GET` | `/api/admin/crosspost-channels` | Список активных маппингов |
| `POST` | `/api/admin/crosspost-channels` | Добавить маппинг |
| `DELETE` | `/api/admin/crosspost-channels/:tgChannelId` | Удалить маппинг |
| `PATCH` | `/api/admin/crosspost-channels/:tgChannelId` | Включить/выключить маппинг |

Пример добавления маппинга вручную:

```bash
curl -X POST "http://localhost:3000/api/admin/crosspost-channels?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tgChannelId": "-1001234567890", "tgChannelTitle": "Мой TG канал", "maxChannelId": "123456", "maxChannelTitle": "Мой MAX канал"}'
```

## Локальный запуск (без Docker)

Требует Node.js 22+.

```bash
npm install
node server.js          # API-сервер
node src/telegram_worker.js  # Воркер (в отдельном терминале)
```

## Структура проекта

```
crossposting/
├── src/
│   ├── config.js              — переменные окружения
│   ├── db.js                  — SQLite схема и миграции
│   ├── crosspost_db.js        — операции с маппингами и логом
│   ├── crosspost_handlers.js  — обработка постов и альбомов
│   ├── max_api.js             — отправка сообщений в MAX
│   └── telegram_worker.js     — Telegram long-polling воркер
├── server.js                  — Fastify REST API сервер
├── crosspost-map.sh           — интерактивный скрипт управления
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Что поддерживается

- Текстовые посты с форматированием: жирный, курсив, зачёркнутый, код, блоки кода, цитаты, ссылки
- Фото (берётся оригинальный размер)
- Видео и GIF (animation)
- Документы/файлы
- Альбомы (несколько фото/видео в одном посте) — склеиваются в одно сообщение MAX
- Подпись (caption) к медиа

## Что не поддерживается

- Редактирование/удаление постов (только новые)
- Опросы, стикеры, голосовые сообщения
