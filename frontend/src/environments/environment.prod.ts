// Production environment configuration
export const environment = {
  production: true,
  // In production, use the SERVER_BASE from backend .env
  // This should be configured via environment variable injection during build
  apiUrl: 'http://192.168.1.12:3000',
  wsUrl: 'http://192.168.1.12:3000'
};
