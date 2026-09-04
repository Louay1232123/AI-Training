/**
 * Test environment. Must be imported BEFORE anything that pulls in
 * src/config.js: ESM evaluates imports before the importing module's body, so
 * setting process.env at the top of a test file would be too late.
 */
process.env.DATABASE_FILE = ':memory:';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.NODE_ENV = 'test';
process.env.MAX_VOTES_PER_IP_PER_POLL = '1000';
