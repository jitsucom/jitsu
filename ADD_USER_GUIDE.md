# 🚀 Руководство по добавлению пользователей в Jitsu Self-Hosted

## 📋 Доступные скрипты

### 1. `generate-password-hash.js` - Генерация хеша пароля

**Простое использование:**
```bash
node generate-password-hash.js "password123"
```

**С правильным CONSOLE_TOKEN_SECRET:**
```bash
# Получите SECRET из вашего .env файла
cd docker
export CONSOLE_TOKEN_SECRET=$(grep CONSOLE_TOKEN_SECRET .env | cut -d'=' -f2)
cd ..
node generate-password-hash.js "password123"
```

**Или в одну строку:**
```bash
CONSOLE_TOKEN_SECRET="ваш-секрет-из-env" node generate-password-hash.js "password123"
```

---

### 2. `create-jitsu-user.js` - Полное создание пользователя

**Генерация SQL команд:**
```bash
node create-jitsu-user.js "user@example.com" "User Name" "password123"
```

**Автоматическое создание (если установлен модуль `pg`):**
```bash
# Установите pg модуль
npm install pg

# Загрузите переменные из .env и создайте пользователя
cd docker
export $(grep -v '^#' .env | xargs)
cd ..
node create-jitsu-user.js "user@example.com" "User Name" "password123"
```

**Создание администратора:**
```bash
node create-jitsu-user.js "admin@example.com" "Admin User" "admin123" true
```

---

## 🔧 Способы добавления пользователей

### Способ 1: Через Docker контейнер (РЕКОМЕНДУЕТСЯ)

Если у вас Docker доступен, самый простой способ - скопировать скрипт в контейнер:

```bash
# Скопируйте скрипт в контейнер
docker cp create-jitsu-user.js jitsu-console-1:/app/

# Запустите внутри контейнера
docker exec -it jitsu-console-1 node /app/create-jitsu-user.js \
  "user@example.com" \
  "User Name" \
  "password123"
```

---

### Способ 2: Через PostgreSQL напрямую

**Шаг 1:** Сгенерируйте SQL:
```bash
node create-jitsu-user.js "user@example.com" "User Name" "password123"
```

**Шаг 2:** Подключитесь к PostgreSQL:
```bash
# Через Docker
docker exec -it jitsu-postgres-1 psql -U postgres -d postgres

# Или напрямую (если PostgreSQL доступен)
psql "postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres"
```

**Шаг 3:** Скопируйте и выполните SQL команды из вывода скрипта.

---

### Способ 3: GitHub OAuth (БЕЗ ПАРОЛЕЙ)

Самый простой и безопасный способ для множества пользователей:

**1. Создайте GitHub OAuth App:**
- Перейдите: https://github.com/settings/developers
- Нажмите "New OAuth App"
- Заполните:
  - **Application name**: Jitsu Self-Hosted
  - **Homepage URL**: `http://localhost:3000` (или ваш домен)
  - **Authorization callback URL**: `http://localhost:3000/api/auth/callback/github`

**2. Обновите `.env`:**
```bash
GITHUB_CLIENT_ID=ваш_client_id
GITHUB_CLIENT_SECRET=ваш_client_secret
```

**3. Перезапустите Jitsu:**
```bash
cd docker
docker-compose down
docker-compose up -d
```

Теперь пользователи могут регистрироваться через GitHub на странице `/signup`!

---

## ⚠️ ВАЖНО: Проблема с CONSOLE_TOKEN_SECRET

Хеши паролей в Jitsu **зависят от CONSOLE_TOKEN_SECRET**!

### Проверка вашего SECRET:

**На сервере:**
```bash
cd docker
grep CONSOLE_TOKEN_SECRET .env
```

**Копируйте этот SECRET при генерации хешей:**
```bash
CONSOLE_TOKEN_SECRET="значение_из_env_файла" node generate-password-hash.js "password"
```

### Почему это важно?

- ❌ Хеш созданный с дефолтным SECRET не будет работать, если на сервере кастомный SECRET
- ✅ Всегда используйте одинаковый SECRET при генерации и проверке хешей
- ✅ Храните CONSOLE_TOKEN_SECRET в безопасном месте (password manager)

---

## 📊 Какой способ выбрать?

| Ситуация | Рекомендуемый способ |
|----------|---------------------|
| Много пользователей | GitHub OAuth |
| 1-5 пользователей | create-jitsu-user.js + DATABASE_URL |
| Одноразовое добавление | generate-password-hash.js + SQL вручную |
| Нет доступа к серверу | Отправьте SQL администратору |
| Автоматизация | Используйте скрипт с DATABASE_URL в CI/CD |

---

## 🔍 Проверка созданного пользователя

```sql
-- В PostgreSQL выполните:
SELECT
  u.id,
  u.email,
  u.name,
  u.admin,
  u."loginProvider",
  CASE WHEN p.hash IS NOT NULL THEN '✓ Есть' ELSE '✗ Нет' END as password
FROM "UserProfile" u
LEFT JOIN "UserPassword" p ON u.id = p."userId"
WHERE u.email = 'user@example.com';
```

---

## 🎯 Быстрый старт

**Для одного пользователя (самый быстрый способ):**

```bash
# 1. Перейдите в директорию jitsu
cd /home/user/jitsu

# 2. Загрузите переменные из .env
cd docker && source .env && cd ..

# 3. Создайте пользователя
node create-jitsu-user.js "newuser@example.com" "New User" "password123"

# 4. Скопируйте SQL и выполните в PostgreSQL
docker exec -it jitsu-postgres-1 psql -U postgres -d postgres
# Вставьте SQL команды из вывода скрипта
```

---

## 📚 Дополнительные ресурсы

- **Issue о проблеме с приглашениями**: https://github.com/jitsucom/jitsu/issues/1131
- **Документация Jitsu**: https://docs.jitsu.com/self-hosting/
- **GitHub OAuth настройка**: https://docs.github.com/en/developers/apps/building-oauth-apps

---

## 🆘 Решение проблем

### "Password hash не работает"

**Проблема:** Пароль не принимается при входе

**Решение:**
1. Проверьте CONSOLE_TOKEN_SECRET на сервере
2. Пересоздайте хеш с правильным SECRET
3. Обновите запись в UserPassword

### "Пользователь уже существует"

**Проблема:** Ошибка при создании пользователя

**Решение:**
```sql
-- Проверьте существующих пользователей
SELECT email, "loginProvider" FROM "UserProfile" WHERE email = 'user@example.com';

-- Если нужно, удалите старого пользователя
DELETE FROM "UserPassword" WHERE "userId" = (SELECT id FROM "UserProfile" WHERE email = 'user@example.com');
DELETE FROM "UserProfile" WHERE email = 'user@example.com';
```

### "Permission denied на ./data/"

**Проблема:** Docker не может писать в bind mount

**Решение:** Используйте Named Volumes вместо bind mounts (см. README.md)

---

Удачи! 🚀
