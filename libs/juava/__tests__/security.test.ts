import { createHash, createAuthorized, checkHash, checkRawToken } from "../src/security";

test("security", () => {
  const password = "secretPassword";
  const hashResult = createHash(password);
  console.log("Hash result = " + hashResult);
  expect(checkHash(hashResult, password)).toBe(true);
  expect(checkHash(hashResult.substring(2), password)).toBe(false);
});

test("authorizer", () => {
  const hashedSecret = "215ef940-8f78-42bf-ab36-185090b9b62e";
  const plaintextSecret = "af0e7958-5a10-4264-af4e-2516a630b602";
  let auth = createAuthorized(createHash(hashedSecret), checkHash);
  expect(auth(plaintextSecret)).toBe(false);
  expect(auth(hashedSecret)).toBe(true);
  expect(auth("wrong")).toBe(false);

  auth = createAuthorized(plaintextSecret, checkRawToken);
  expect(auth(plaintextSecret)).toBe(true);
  expect(auth(hashedSecret)).toBe(false);
  expect(auth("wrong")).toBe(false);
});
