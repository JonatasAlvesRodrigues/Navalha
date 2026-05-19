const test = require('node:test');
const assert = require('node:assert/strict');
const { getRequiredEnv, loadSecurityConfig } = require('../backend/securityConfig');

test('getRequiredEnv retorna valor quando presente', () => {
  process.env.JWT_SECRET = 'abc123';
  assert.equal(getRequiredEnv('JWT_SECRET'), 'abc123');
});

test('getRequiredEnv falha quando variavel ausente', () => {
  delete process.env.OWNER_EMAIL;
  assert.throws(() => getRequiredEnv('OWNER_EMAIL'), /OWNER_EMAIL/);
});

test('loadSecurityConfig exige todos os segredos', () => {
  process.env.JWT_SECRET = 'jwt-secret';
  process.env.OWNER_EMAIL = 'owner@example.com';
  process.env.OWNER_PASSWORD = 'strong-password';

  const config = loadSecurityConfig();
  assert.equal(config.jwtSecret, 'jwt-secret');
  assert.equal(config.ownerEmail, 'owner@example.com');
  assert.equal(config.ownerPassword, 'strong-password');
});
