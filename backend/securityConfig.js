function getRequiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
}

function loadSecurityConfig() {
  const jwtSecret = getRequiredEnv('JWT_SECRET');
  const ownerEmail = getRequiredEnv('OWNER_EMAIL');
  const ownerPassword = getRequiredEnv('OWNER_PASSWORD');

  return { jwtSecret, ownerEmail, ownerPassword };
}

module.exports = {
  getRequiredEnv,
  loadSecurityConfig,
};
