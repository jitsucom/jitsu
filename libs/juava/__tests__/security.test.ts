import { createHash, checkToken, createAuthorized } from "../src/security";

test("security", () => {
  const password = "secretPassword";
  const hashResult = createHash(password);
  console.log("Hash result = " + hashResult);
  expect(checkToken(hashResult, password)).toBe(true);
  expect(checkToken(hashResult.substring(2), password)).toBe(false);
});

test("authorizer", () => {
  const hashedSecret = "215ef940-8f78-42bf-ab36-185090b9b62e";
  const plaintextSecret = "af0e7958-5a10-4264-af4e-2516a630b602";
  const secrets = `${plaintextSecret},${createHash(hashedSecret)}`;
  const auth = createAuthorized(secrets);
  expect(auth(plaintextSecret)).toBe(true);
  expect(auth(hashedSecret)).toBe(true);
  expect(auth("wrong")).toBe(false);
});
