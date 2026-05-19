const test = require('node:test');
const assert = require('node:assert/strict');
const { getRequiredEnv, loadSecurityConfig } = require('../backend/securityConfig');

test('getRequiredEnv retorna valor quando presente', () => {
  process.env.JWT_SECRET = 'abc123';
  assert.equal(getRequiredEnv('JWT_SECRET'), 'abc123');
});

test('getRequiredEnv falha quando variavel ausente', () => {
  delete process.env.JWT_SECRET;
  assert.throws(() => getRequiredEnv('JWT_SECRET'), /JWT_SECRET/);
});

test('loadSecurityConfig exige JWT e habilita owner auth quando OWNER_* existe', () => {
  process.env.JWT_SECRET = 'jwt-secret';
  process.env.OWNER_EMAIL = 'owner@example.com';
  process.env.OWNER_PASSWORD = 'strong-password';

  const config = loadSecurityConfig();
  assert.equal(config.jwtSecret, 'jwt-secret');
  assert.equal(config.ownerEmail, 'owner@example.com');
  assert.equal(config.ownerPassword, 'strong-password');
  assert.equal(config.ownerAuthEnabled, true);
});

test('loadSecurityConfig desabilita owner auth quando OWNER_* ausente', () => {
  process.env.JWT_SECRET = 'jwt-secret';
  delete process.env.OWNER_EMAIL;
  delete process.env.OWNER_PASSWORD;

  const config = loadSecurityConfig();
  assert.equal(config.jwtSecret, 'jwt-secret');
  assert.equal(config.ownerEmail, null);
  assert.equal(config.ownerPassword, null);
  assert.equal(config.ownerAuthEnabled, false);
});
