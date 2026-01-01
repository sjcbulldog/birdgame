// Development environment configuration
export const environment = {
  production: false,
  // Use the SERVER_BASE from backend .env file
  // This ensures consistent API URL across all environments
  apiUrl: 'http://192.168.1.12:3000',
  wsUrl: 'http://192.168.1.12:3000'
};
