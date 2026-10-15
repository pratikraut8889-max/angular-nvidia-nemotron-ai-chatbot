/** Shared JWT configuration. Production must provide a strong secret via env. */
export function getJwtSecret(): string {
  const secret = process.env['JWT_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set to a random value of at least 32 characters.');
  }
  return secret;
}
