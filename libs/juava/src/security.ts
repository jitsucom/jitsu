const crypto = require("crypto");

const defaultSeed = "dea42a58-acf4-45af-85bb-e77e94bd5025";

const globalSeed: string[] = (process.env.GLOBAL_HASH_SECRET || defaultSeed).split(",").map(s => s.trim());

function hashInternal(secret: string, randomSeed: string, globalSeed: string) {
  return `${randomSeed}.${hash("sha512", secret + randomSeed + globalSeed)}`;
}

export function hash(algorithm: string, value: string): string {
  const hash = crypto.createHash(algorithm);
  hash.update(value);
  return hash.digest("hex");
}

export function hint(key: string) {
  return key.substring(0, 3) + "*" + key.substring(key.length - 3);
}

export function createHash(secret: string): string {
  const randomSeed = crypto.randomBytes(16).toString("hex");
  return hashInternal(secret, randomSeed, globalSeed[0]);
}

export function checkToken(hashOrPlain: string, secret: string): boolean {
  if (secret === hashOrPlain) {
    return true;
  }
  if (hashOrPlain.indexOf(".") >= 0) {
    return checkHash(hashOrPlain, secret);
  }
  return false;
}

export function checkHash(hash: string, secret: string): boolean {
  const [randomSeed] = hash.split(".");
  return globalSeed.find(seed => hash === hashInternal(secret, randomSeed, seed)) !== undefined;
}

export function isValidSecret(secret: string): boolean {
  return secret.length >= 8 && /^[a-zA-Z0-9-_]+$/.test(secret);
}

export type Authorizer = (secret: string) => boolean;

/**
 * Creates an authorizer against a string that contains a comma separated list of
 * tokens. Each token can be a plain string or a hash of a string. The hash is
 * something that contains '.'.
 */
export function createAuthorized(tokens: string): Authorizer {
  const authorizers = tokens
    .split(",")
    .map(tok => tok.trim())
    .map(hashOrPlain => (secret: string) => checkToken(hashOrPlain, secret));
  return (secret: string) => authorizers.find(auth => auth(secret)) !== undefined;
}

export function encrypt(secret: string, iv: string, value: string): string {
  const cipher = crypto.createCipheriv("aes-256-ctr", Buffer.from(secret), Buffer.from(iv));
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return encrypted.toString("hex");
}

export function decrypt(secret: string, iv: string, value: string): string {
  const decipher = crypto.createDecipheriv("aes-256-ctr", Buffer.from(secret), Buffer.from(iv));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(value, "hex")), decipher.final()]);
  return decrypted.toString();
}
