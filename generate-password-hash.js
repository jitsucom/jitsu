#!/usr/bin/env node

/**
 * Генератор хешей паролей для Jitsu
 *
 * Использование:
 *   node generate-password-hash.js "your-password"
 *
 * Или с кастомным CONSOLE_TOKEN_SECRET:
 *   CONSOLE_TOKEN_SECRET="your-secret" node generate-password-hash.js "your-password"
 */

const crypto = require('crypto');

// ВАЖНО: Должен совпадать с CONSOLE_TOKEN_SECRET на сервере!
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

// Основная логика
const password = process.argv[2];

if (!password) {
  console.error('\n❌ Ошибка: пароль не указан\n');
  console.log('Использование:');
  console.log('  node generate-password-hash.js "your-password"\n');
  console.log('С кастомным secret:');
  console.log('  CONSOLE_TOKEN_SECRET="your-secret" node generate-password-hash.js "your-password"\n');
  process.exit(1);
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📝 Генератор хешей паролей для Jitsu');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Проверяем, используется ли дефолтный seed
const usingDefaultSeed = globalSeed === defaultSeed;

if (usingDefaultSeed) {
  console.log('⚠️  ВНИМАНИЕ: Используется дефолтный GLOBAL_HASH_SECRET');
  console.log('   Если на сервере установлен кастомный CONSOLE_TOKEN_SECRET,');
  console.log('   хеш НЕ БУДЕТ РАБОТАТЬ!\n');
  console.log('   Установите переменную окружения:');
  console.log('   CONSOLE_TOKEN_SECRET="ваш-секрет" node generate-password-hash.js "пароль"\n');
} else {
  console.log('✅ Используется кастомный GLOBAL_HASH_SECRET');
  console.log(`   Secret: ${globalSeed.substring(0, 8)}...${globalSeed.substring(globalSeed.length - 4)}\n`);
}

const passwordHash = createHash(password);

console.log('📋 Результат:\n');
console.log('Password Hash:');
console.log(`  ${passwordHash}\n`);

// Показываем пример использования
const exampleEmail = 'user@example.com';
const externalId = toId(exampleEmail);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📖 Пример SQL для создания пользователя:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log(`-- 1. Создать UserProfile`);
console.log(`INSERT INTO "UserProfile" (`);
console.log(`  id, name, email, admin, "loginProvider", "externalId", "createdAt", "updatedAt"`);
console.log(`) VALUES (`);
console.log(`  gen_random_uuid()::text,`);
console.log(`  'User Name',`);
console.log(`  '${exampleEmail}',`);
console.log(`  false,`);
console.log(`  'credentials',`);
console.log(`  '${externalId}',`);
console.log(`  NOW(),`);
console.log(`  NOW()`);
console.log(`);\n`);

console.log(`-- 2. Добавить пароль`);
console.log(`INSERT INTO "UserPassword" ("userId", hash, "changeAtNextLogin", "createdAt", "updatedAt")`);
console.log(`SELECT`);
console.log(`  id,`);
console.log(`  '${passwordHash}',`);
console.log(`  true,`);
console.log(`  NOW(),`);
console.log(`  NOW()`);
console.log(`FROM "UserProfile"`);
console.log(`WHERE email = '${exampleEmail}';\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
