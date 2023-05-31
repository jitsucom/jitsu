/** @type {import("ts-jest").JestConfigWithTsJest} */
module.exports = {
  //preset: "ts-jest",
  preset: "ts-jest",
  testEnvironment: "node",
  runner: "jest-runner",
  rootDir: "./__tests__/node/",
  globals: {
    'ts-jest': {
      tsConfig: 'tsconfig.test.json'
    }
  }
};
