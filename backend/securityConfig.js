function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

function getOptionalEnv(name) {
  const value = String(process.env[name] || '').trim();
  return value || null;
}

function loadSecurityConfig() {
  const jwtSecret = getRequiredEnv('JWT_SECRET');
  const ownerEmail = getOptionalEnv('OWNER_EMAIL');
  const ownerPassword = getOptionalEnv('OWNER_PASSWORD');
  const ownerAuthEnabled = Boolean(ownerEmail && ownerPassword);

  return { jwtSecret, ownerEmail, ownerPassword, ownerAuthEnabled };
}

module.exports = {
  getRequiredEnv,
  getOptionalEnv,
  loadSecurityConfig,
};
