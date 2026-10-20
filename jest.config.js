/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: true,
          skipLibCheck: true,
          target: 'ES2021',
          types: ['jest', 'node'],
          useDefineForClassFields: false,
        },
      },
    ],
  },
  reporters: ['default'],
  maxWorkers: 1,
  testTimeout: 180000,
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
