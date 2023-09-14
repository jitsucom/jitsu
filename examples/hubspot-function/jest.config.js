/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
  //preset: "ts-jest",
  preset: "ts-jest",
  testMatch: ["**/__tests__/**/*.test.ts"],
  testEnvironment: "node",
  runner: "jest-runner",
  testMatch: ["**/__tests__/**/*.test.ts"],
};
