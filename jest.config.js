export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest'
  },
  testPathIgnorePatterns: ['/node_modules/', '/.yalc/'],
  transformIgnorePatterns: [
    'node_modules/(?!(pear-apps-utils-validator|pear-apps-utils-pattern-search)/)'
  ],
  setupFilesAfterEnv: ['./jest.setup.js'],
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons']
  },
  moduleNameMapper: {
    '^lockwright-utils-generate-unique-id$':
      '<rootDir>/test-stubs/pear-apps-utils-generate-unique-id.js',
    '^lockwright-utils-validator$':
      '<rootDir>/test-stubs/pear-apps-utils-validator.js',
    '^lockwright-utils-pattern-search$':
      '<rootDir>/test-stubs/pear-apps-utils-pattern-search.js',
    '^lockwright-lib-constants$':
      '<rootDir>/test-stubs/pearpass-lib-constants.js'
  }
}
