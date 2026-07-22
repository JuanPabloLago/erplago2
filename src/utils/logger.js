/**
 * Logger simple para ERP LAGO
 * En producción solo muestra warn y error
 * En desarrollo muestra todo
 */
const isDev = process.env.NODE_ENV !== 'production';

const logger = {
    info: (...args) => isDev && console.log('ℹ️ ', ...args),
    success: (...args) => isDev && console.log('✅', ...args),
    warn: (...args) => console.log('⚠️ ', ...args),
    error: (...args) => console.error('❌', ...args),
    debug: (...args) => isDev && console.log('🔍', ...args)
};

module.exports = logger;
