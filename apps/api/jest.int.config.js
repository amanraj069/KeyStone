// Integration tests: need the FalkorDB and Redis containers running
// (`docker compose up -d`). Files: test/**/*.int-spec.ts
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testRegex: '\\.int-spec\\.ts$',
  setupFiles: ['<rootDir>/test/load-env.ts'],
  testTimeout: 20000,
};
