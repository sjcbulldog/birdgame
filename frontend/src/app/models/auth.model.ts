export interface User {
  id: string;
  username?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  userType?: string;
  iconId?: string; // Icon selected by the user
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginRequest {
  usernameOrEmail: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface RegisterResponse {
  message: string;
  email: string;
}

export interface VerifyEmailResponse {
  message: string;
}
