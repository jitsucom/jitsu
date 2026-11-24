import crypto from "crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createHash, createAuthorized, checkHash, checkRawToken, safeEqual } from "../src/security";

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

// A token that is compared with === leaks, through the time the compare takes, how many leading characters were right.
describe("constant time compares", () => {
  afterEach(() => vi.restoreAllMocks());

  test("safeEqual says whether two strings are equal, whatever their length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("abcd", "abc")).toBe(false);
    expect(safeEqual("abc", "")).toBe(false);
    expect(safeEqual("päss", "päss")).toBe(true);
    expect(safeEqual("päss", "pass")).toBe(false);
  });

  test("checkRawToken compares through crypto.timingSafeEqual", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    expect(checkRawToken("plain-token-1", "plain-token-1")).toBe(true);
    expect(checkRawToken("plain-token-1", "plain-token-2")).toBe(false);
    expect(checkRawToken("plain-token-1", "short")).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  test("checkHash compares through crypto.timingSafeEqual", () => {
    const hashed = createHash("a-secret");
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    expect(checkHash(hashed, "a-secret")).toBe(true);
    expect(checkHash(hashed, "another-secret")).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  test("an empty secret matches nothing but an empty token", () => {
    expect(checkRawToken("plain-token-1", "")).toBe(false);
    expect(checkHash(createHash("a-secret"), "")).toBe(false);
  });
});
