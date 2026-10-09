export default {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest'
  },
  testPathIgnorePatterns: ['/node_modules/', '/.yalc/'],
  transformIgnorePatterns: ['node_modules/(?!(pear-apps-utils-validator)/)'],
  setupFilesAfterEnv: ['./jest.setup.js'],
  testEnvironmentOptions: {
    customExportConditions: ['node', 'node-addons']
  },
  moduleNameMapper: {
    '^lockwright-lib-utils/generate-unique-id$':
      '<rootDir>/test-stubs/pear-apps-utils-generate-unique-id.js',
    '^lockwright-lib-utils/validator$':
      '<rootDir>/test-stubs/pear-apps-utils-validator.js',
    '^lockwright-lib-constants$':
      '<rootDir>/test-stubs/pearpass-lib-constants.js'
  }
}
