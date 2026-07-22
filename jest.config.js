module.exports = {
    testEnvironment: 'node',
    coveragePathIgnorePatterns: ['/node_modules/'],
    testMatch: [
        '**/tests/**/*.test.js',
        '**/__tests__/**/*.test.js'
    ],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/mi_erpConTesoreria100Funcional/'
    ],
    modulePathIgnorePatterns: [
        '/mi_erpConTesoreria100Funcional/'
    ],
    collectCoverageFrom: [
        'controllers/**/*.js',
        '!node_modules/**'
    ],
    testTimeout: 10000
};
