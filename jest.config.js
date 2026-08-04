module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\.tsx?$': 'ts-jest',
  },
  testMatch: ['**/src/**/*.test.ts'],
};