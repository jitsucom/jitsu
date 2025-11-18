#!/usr/bin/env node

/**
 * Скрипт для создания пользователя в Jitsu (без зависимостей от Prisma)
 *
 * Использование:
 *   DATABASE_URL="postgresql://..." node create-jitsu-user.js email@example.com "User Name" "password123"
 *
 * Или с переменными из .env:
 *   cd docker && source .env && node ../create-jitsu-user.js email@example.com "User Name" "password123"
 */

const crypto = require('crypto');

// ============================================================================
// Функции хеширования (из juava/security.ts)
// ============================================================================

const defaultSeed = "dea42a58-acf4-45af-85bb-e77e94bd5025";

const globalSeed = (
  process.env.GLOBAL_HASH_SECRET ||
  process.env.CONSOLE_TOKEN_SECRET ||
  process.env.ROTOR_TOKEN_SECRET ||
  defaultSeed
).split(",").map(s => s.trim())[0];

function hash(algorithm, value) {
  const h = crypto.createHash(algorithm);
  h.update(value);
  return h.digest('hex');
}

function createHash(secret) {
  const randomSeed = crypto.randomBytes(16).toString('hex');
  const hashValue = hash('sha512', secret + randomSeed + globalSeed);
  return `${randomSeed}.${hashValue}`;
}

function toId(email) {
  return hash('sha256', email.toLowerCase().trim());
}

// ============================================================================
// Парсинг аргументов
// ============================================================================

const [email, name, password, isAdmin] = process.argv.slice(2);

if (!email || !name || !password) {
  console.error('\n❌ Ошибка: недостаточно параметров\n');
  console.log('Использование:');
  console.log('  node create-jitsu-user.js EMAIL NAME PASSWORD [ADMIN]\n');
  console.log('Примеры:');
  console.log('  node create-jitsu-user.js user@example.com "John Doe" "password123"');
  console.log('  node create-jitsu-user.js admin@example.com "Admin User" "secure123" true\n');
  console.log('С DATABASE_URL:');
  console.log('  DATABASE_URL="postgresql://postgres:password@localhost:5432/postgres" \\');
  console.log('    node create-jitsu-user.js user@example.com "User" "pass123"\n');
  console.log('С переменными из .env:');
  console.log('  cd docker && source .env && node ../create-jitsu-user.js email "Name" "pass"\n');
  process.exit(1);
}

// ============================================================================
// Генерация данных
// ============================================================================

const passwordHash = createHash(password);
const externalId = toId(email);
const admin = isAdmin === 'true' || isAdmin === '1';

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('👤 Создание пользователя Jitsu');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('Данные пользователя:');
console.log(`  Email:        ${email}`);
console.log(`  Name:         ${name}`);
console.log(`  Admin:        ${admin}`);
console.log(`  External ID:  ${externalId}`);
console.log(`  Password:     ${'*'.repeat(password.length)}`);
console.log(`  Hash:         ${passwordHash.substring(0, 20)}...${passwordHash.substring(passwordHash.length - 10)}\n`);

// Проверяем SECRET
const usingDefaultSeed = globalSeed === defaultSeed;
if (usingDefaultSeed) {
  console.log('⚠️  ВНИМАНИЕ: Используется дефолтный GLOBAL_HASH_SECRET!');
  console.log('   Если на сервере кастомный CONSOLE_TOKEN_SECRET, пароль не сработает.\n');
} else {
  console.log('✅ Используется кастомный CONSOLE_TOKEN_SECRET\n');
}

// ============================================================================
// SQL команды
// ============================================================================

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📋 SQL команды для выполнения:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const sql = `
-- 1. Проверить, существует ли пользователь
SELECT id, email, "loginProvider" FROM "UserProfile" WHERE email = '${email}';

-- Если пользователь НЕ существует, выполните следующие команды:

-- 2. Создать UserProfile
INSERT INTO "UserProfile" (
  id, name, email, admin, "loginProvider", "externalId", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid()::text,
  '${name.replace(/'/g, "''")}',
  '${email}',
  ${admin},
  'credentials',
  '${externalId}',
  NOW(),
  NOW()
);

-- 3. Добавить пароль
INSERT INTO "UserPassword" ("userId", hash, "changeAtNextLogin", "createdAt", "updatedAt")
SELECT
  id,
  '${passwordHash}',
  true,
  NOW(),
  NOW()
FROM "UserProfile"
WHERE email = '${email}' AND "loginProvider" = 'credentials';

-- 4. Проверить создание
SELECT
  u.id,
  u.email,
  u.name,
  u.admin,
  CASE WHEN p.hash IS NOT NULL THEN '✓ Установлен' ELSE '✗ Отсутствует' END as password_status
FROM "UserProfile" u
LEFT JOIN "UserPassword" p ON u.id = p."userId"
WHERE u.email = '${email}';
`;

console.log(sql);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔧 Как выполнить:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('Через Docker:');
console.log('  docker exec -it jitsu-postgres-1 psql -U postgres -d postgres\n');

console.log('Через psql напрямую:');
console.log('  psql "postgresql://postgres:YOUR_PASSWORD@localhost:5432/postgres"\n');

console.log('Скопируйте SQL команды выше и выполните их в psql.\n');

// ============================================================================
// Попытка подключения к БД (опционально, если есть pg модуль)
// ============================================================================

if (process.env.DATABASE_URL) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔌 Автоматическое создание пользователя');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const { Client } = require('pg');

    (async () => {
      const client = new Client({
        connectionString: process.env.DATABASE_URL,
      });

      try {
        await client.connect();
        console.log('✅ Подключено к базе данных\n');

        // Проверяем существование пользователя
        console.log('Проверка существующего пользователя...');
        const checkResult = await client.query(
          'SELECT id, email FROM "UserProfile" WHERE email = $1',
          [email]
        );

        if (checkResult.rows.length > 0) {
          console.log(`❌ Пользователь с email ${email} уже существует!`);
          console.log(`   ID: ${checkResult.rows[0].id}\n`);
          process.exit(1);
        }

        console.log('✓ Пользователь не найден, создаем...\n');

        // Создаем UserProfile
        const userResult = await client.query(`
          INSERT INTO "UserProfile" (
            id, name, email, admin, "loginProvider", "externalId", "createdAt", "updatedAt"
          ) VALUES (
            gen_random_uuid()::text, $1, $2, $3, 'credentials', $4, NOW(), NOW()
          ) RETURNING id
        `, [name, email, admin, externalId]);

        const userId = userResult.rows[0].id;
        console.log(`✅ UserProfile создан, ID: ${userId}`);

        // Создаем пароль
        await client.query(`
          INSERT INTO "UserPassword" ("userId", hash, "changeAtNextLogin", "createdAt", "updatedAt")
          VALUES ($1, $2, true, NOW(), NOW())
        `, [userId, passwordHash]);

        console.log('✅ Пароль установлен\n');

        // Проверяем результат
        const verifyResult = await client.query(`
          SELECT
            u.id,
            u.email,
            u.name,
            u.admin,
            CASE WHEN p.hash IS NOT NULL THEN true ELSE false END as has_password
          FROM "UserProfile" u
          LEFT JOIN "UserPassword" p ON u.id = p."userId"
          WHERE u.id = $1
        `, [userId]);

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ Пользователь успешно создан!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log('Данные пользователя:');
        console.log(`  ID:           ${verifyResult.rows[0].id}`);
        console.log(`  Email:        ${verifyResult.rows[0].email}`);
        console.log(`  Name:         ${verifyResult.rows[0].name}`);
        console.log(`  Admin:        ${verifyResult.rows[0].admin}`);
        console.log(`  Password:     ${verifyResult.rows[0].has_password ? '✓ Установлен' : '✗ Отсутствует'}`);
        console.log('\nПользователь может войти по адресу:');
        console.log(`  ${process.env.JITSU_PUBLIC_URL || 'http://localhost:3000'}/signin`);
        console.log(`  Email:    ${email}`);
        console.log(`  Password: ${password}`);
        console.log('\n⚠️  Рекомендуется сменить пароль при первом входе!\n');

      } catch (err) {
        console.error('❌ Ошибка при работе с базой данных:', err.message);
        console.log('\nИспользуйте SQL команды выше для ручного создания пользователя.\n');
        process.exit(1);
      } finally {
        await client.end();
      }
    })();

  } catch (err) {
    console.log('⚠️  Модуль pg не установлен, используйте SQL команды выше');
    console.log('   Для автоматического создания установите: npm install pg\n');
  }
} else {
  console.log('💡 Для автоматического создания пользователя установите DATABASE_URL:\n');
  console.log('   DATABASE_URL="postgresql://postgres:password@localhost:5432/postgres" \\');
  console.log('     node create-jitsu-user.js email "Name" "password"\n');
}
