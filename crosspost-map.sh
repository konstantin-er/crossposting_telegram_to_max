#!/bin/bash
# Скрипт управления маппингом кросспостинга Telegram → MAX
# Запуск: bash crosspost-map.sh

set -e

# --- Читаем .env ---
ENV_FILE="$(dirname "$0")/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Ошибка: файл .env не найден (ожидается рядом со скриптом)"
  exit 1
fi

BOT_TOKEN=$(grep -E '^MAX_BOT_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
PORT=$(grep -E '^PORT=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
PORT="${PORT:-3000}"
MAX_API="https://platform-api.max.ru"
BASE_URL="http://localhost:$PORT"

if [ -z "$BOT_TOKEN" ] || [ "$BOT_TOKEN" = "replace_me" ]; then
  echo "Ошибка: MAX_BOT_TOKEN не задан в .env"
  exit 1
fi

echo ""
echo "=== Управление кросспостингом Telegram → MAX ==="
echo ""

# --- Получаем список MAX каналов бота ---
echo "Получаю список MAX каналов бота..."
TMPFILE=$(mktemp)
HTTP_CODE=$(curl -s -o "$TMPFILE" -w "%{http_code}" -H "Authorization: $BOT_TOKEN" "$MAX_API/chats?count=100")

if [ "$HTTP_CODE" != "200" ]; then
  echo "Ошибка API MAX (HTTP $HTTP_CODE): $(cat "$TMPFILE")"
  rm -f "$TMPFILE"
  exit 1
fi

MAX_CHATS=$(python3 -c "
import json, sys
with open('$TMPFILE') as f:
    data = json.load(f)
chats = data.get('chats', [])
if not chats:
    print('EMPTY')
    sys.exit(0)
for i, c in enumerate(chats):
    chat_id = c.get('chat_id') or c.get('id', '')
    title = c.get('title', '(без названия)').replace('|', ' ')
    ctype = c.get('type', '')
    print(f'{i+1}|{chat_id}|{title}|{ctype}')
")
rm -f "$TMPFILE"

if [ "$MAX_CHATS" = "EMPTY" ] || [ -z "$MAX_CHATS" ]; then
  echo "Бот не состоит ни в одном MAX канале."
  exit 0
fi

# --- Массивы для MAX каналов ---
declare -a MAX_IDS
declare -a MAX_NAMES
MAX_TOTAL=0

load_max_channels() {
  MAX_IDS=()
  MAX_NAMES=()
  MAX_TOTAL=0
  IFS=$'\n'
  for line in $MAX_CHATS; do
    local ID=$(echo "$line" | cut -d'|' -f2)
    local TITLE=$(echo "$line" | cut -d'|' -f3)
    MAX_IDS[$MAX_TOTAL]="$ID"
    MAX_NAMES[$MAX_TOTAL]="$TITLE"
    MAX_TOTAL=$((MAX_TOTAL+1))
  done
  IFS=$' \t\n'
}

show_max_channels() {
  echo "Доступные MAX каналы:"
  IFS=$'\n'
  for line in $MAX_CHATS; do
    local NUM=$(echo "$line" | cut -d'|' -f1)
    local ID=$(echo "$line" | cut -d'|' -f2)
    local TITLE=$(echo "$line" | cut -d'|' -f3)
    local TYPE=$(echo "$line" | cut -d'|' -f4)
    printf "  [%s] %-40s (id: %s, тип: %s)\n" "$NUM" "$TITLE" "$ID" "$TYPE"
  done
  IFS=$' \t\n'
}

# --- Массивы для TG каналов ---
declare -a TG_IDS
declare -a TG_TITLES
declare -a TG_USERNAMES
TG_TOTAL=0

load_tg_channels() {
  TG_IDS=()
  TG_TITLES=()
  TG_USERNAMES=()
  TG_TOTAL=0

  local RAW
  RAW=$(curl -s "$BASE_URL/api/admin/tg-channels?token=$BOT_TOKEN" 2>/dev/null)

  local PARSED
  PARSED=$(echo "$RAW" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    channels = d.get('channels', [])
    if not channels:
        print('EMPTY')
        sys.exit(0)
    for i, c in enumerate(channels):
        cid = c.get('channel_id', '')
        title = (c.get('title') or '(без названия)').replace('|', ' ')
        username = c.get('username') or ''
        print(f'{i+1}|{cid}|{title}|{username}')
except Exception as e:
    print('ERROR')
" 2>/dev/null)

  if [ "$PARSED" = "EMPTY" ] || [ -z "$PARSED" ] || [ "$PARSED" = "ERROR" ]; then
    return
  fi

  IFS=$'\n'
  for line in $PARSED; do
    local ID=$(echo "$line" | cut -d'|' -f2)
    local TITLE=$(echo "$line" | cut -d'|' -f3)
    local USERNAME=$(echo "$line" | cut -d'|' -f4)
    TG_IDS[$TG_TOTAL]="$ID"
    TG_TITLES[$TG_TOTAL]="$TITLE"
    TG_USERNAMES[$TG_TOTAL]="$USERNAME"
    TG_TOTAL=$((TG_TOTAL+1))
  done
  IFS=$' \t\n'

  echo "Доступные Telegram каналы:"
  IFS=$'\n'
  local i=0
  for line in $PARSED; do
    local NUM=$(echo "$line" | cut -d'|' -f1)
    local ID=$(echo "$line" | cut -d'|' -f2)
    local TITLE=$(echo "$line" | cut -d'|' -f3)
    local USERNAME=$(echo "$line" | cut -d'|' -f4)
    local USERLABEL=""
    if [ -n "$USERNAME" ]; then USERLABEL=" (@$USERNAME)"; fi
    printf "  [%s] %-40s (id: %s%s)\n" "$NUM" "$TITLE" "$ID" "$USERLABEL"
    i=$((i+1))
  done
  IFS=$' \t\n'
}

# --- Вспомогательные функции ---
get_mappings() {
  curl -s "$BASE_URL/api/admin/crosspost-channels?token=$BOT_TOKEN" | python3 -c "
import json, sys
d = json.load(sys.stdin)
channels = d.get('channels', [])
if not channels:
    print('  (нет маппингов)')
    sys.exit(0)
for c in channels:
    status = '✅' if c['enabled'] else '⏸'
    print(f\"{status} TG {c.get('tg_channel_title','?')} ({c['tg_channel_id']}) → MAX {c.get('max_channel_title','?')} ({c['max_channel_id']})\")
" 2>/dev/null || echo "  (нет маппингов)"
}

# Preload MAX channel arrays
load_max_channels

# --- Главное меню ---
while true; do
  echo ""
  echo "Текущие маппинги:"
  get_mappings
  echo ""
  echo "Команды:"
  echo "  [a] Добавить маппинг"
  echo "  [d] Удалить маппинг"
  echo "  [t] Включить/выключить маппинг (toggle)"
  echo "  [q] Выйти"
  echo ""
  printf "Введите команду: "
  read -r CMD

  case "$CMD" in
    a|A)
      echo ""

      # --- Выбор TG канала ---
      echo "Загружаю список Telegram каналов..."
      load_tg_channels

      if [ "$TG_TOTAL" -eq 0 ]; then
        echo ""
        echo "⚠️  Бот ещё не видел ни одного Telegram канала."
        echo "   Отправьте любой пост в канал, где бот является администратором,"
        echo "   затем перезапустите скрипт."
        continue
      fi

      echo ""
      printf "Выберите номер Telegram канала: "
      read -r TG_NUM

      if ! [[ "$TG_NUM" =~ ^[0-9]+$ ]] || [ "$TG_NUM" -lt 1 ] || [ "$TG_NUM" -gt "$TG_TOTAL" ]; then
        echo "Некорректный номер."
        continue
      fi

      TG_IDX=$((TG_NUM-1))
      TG_ID="${TG_IDS[$TG_IDX]}"
      TG_TITLE="${TG_TITLES[$TG_IDX]}"

      # --- Выбор MAX канала ---
      echo ""
      show_max_channels
      echo ""
      printf "Выберите номер MAX канала: "
      read -r MAX_NUM

      if ! [[ "$MAX_NUM" =~ ^[0-9]+$ ]] || [ "$MAX_NUM" -lt 1 ] || [ "$MAX_NUM" -gt "$MAX_TOTAL" ]; then
        echo "Некорректный номер."
        continue
      fi

      MAX_IDX=$((MAX_NUM-1))
      MAX_ID="${MAX_IDS[$MAX_IDX]}"
      MAX_NAME="${MAX_NAMES[$MAX_IDX]}"

      RESULT=$(curl -s -X POST "$BASE_URL/api/admin/crosspost-channels?token=$BOT_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"tgChannelId\": \"$TG_ID\", \"tgChannelTitle\": \"$TG_TITLE\", \"maxChannelId\": \"$MAX_ID\", \"maxChannelTitle\": \"$MAX_NAME\", \"skipKeyword\": \"\"}")
      OK=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',''))" 2>/dev/null)
      if [ "$OK" = "True" ] || [ "$OK" = "true" ]; then
        echo "  ✅ Маппинг добавлен: $TG_TITLE → $MAX_NAME"
      else
        echo "  Ошибка: $RESULT"
      fi
      ;;

    d|D)
      echo ""
      echo "Текущие маппинги:"
      get_mappings
      echo ""
      printf "Введите Telegram channel_id для удаления: "
      read -r TG_ID
      if [ -z "$TG_ID" ]; then echo "Отмена."; continue; fi

      RESULT=$(curl -s -X DELETE "$BASE_URL/api/admin/crosspost-channels/$TG_ID?token=$BOT_TOKEN")
      OK=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',''))" 2>/dev/null)
      if [ "$OK" = "True" ] || [ "$OK" = "true" ]; then
        echo "  ✅ Маппинг удалён."
      else
        echo "  Ошибка: $RESULT"
      fi
      ;;

    t|T)
      echo ""
      echo "Текущие маппинги:"
      get_mappings
      echo ""
      printf "Введите Telegram channel_id для toggle: "
      read -r TG_ID
      if [ -z "$TG_ID" ]; then echo "Отмена."; continue; fi

      CURRENT=$(curl -s "$BASE_URL/api/admin/crosspost-channels?token=$BOT_TOKEN" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for c in d.get('channels', []):
    if str(c['tg_channel_id']) == '$TG_ID':
        print(c['enabled'])
        sys.exit(0)
print('not_found')
" 2>/dev/null)

      if [ "$CURRENT" = "not_found" ]; then
        echo "  Маппинг с TG ID $TG_ID не найден."
        continue
      fi

      if [ "$CURRENT" = "1" ]; then
        NEW_ENABLED=0
        LABEL="выключен ⏸"
      else
        NEW_ENABLED=1
        LABEL="включён ✅"
      fi

      RESULT=$(curl -s -X PATCH "$BASE_URL/api/admin/crosspost-channels/$TG_ID?token=$BOT_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"enabled\": $NEW_ENABLED}")
      OK=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('ok',''))" 2>/dev/null)
      if [ "$OK" = "True" ] || [ "$OK" = "true" ]; then
        echo "  Маппинг $TG_ID теперь $LABEL"
      else
        echo "  Ошибка: $RESULT"
      fi
      ;;

    q|Q)
      echo "Выход."
      break
      ;;

    *)
      echo "Неизвестная команда."
      ;;
  esac
done

echo ""
