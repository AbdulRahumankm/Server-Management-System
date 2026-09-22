module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Integration tests share one real Postgres and some well-known fixture
  // rows (e.g. operator@example.com/viewer@example.com). Jest's default
  // parallel-worker-per-file execution lets one file's afterAll delete rows
  // another file's still-running tests depend on. Force serial execution.
  maxWorkers: 1,
};
