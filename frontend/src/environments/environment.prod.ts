// Production environment configuration
export const environment = {
  production: true,
  // In production, use the SERVER_BASE from backend .env
  // This should be configured via environment variable injection during build
  apiUrl: 'https://www.thebirdgame.net/',
  wsUrl: 'https://www.thebirdgame.net/'
};
