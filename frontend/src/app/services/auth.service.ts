import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, catchError, throwError } from 'rxjs';
import { 
  User, 
  RegisterRequest, 
  LoginRequest, 
  AuthResponse, 
  RegisterResponse,
  VerifyEmailResponse 
} from '../models/auth.model';
import { SocketService } from './socket.service';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/auth`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();
  private socketService = inject(SocketService);

  constructor(private http: HttpClient) {
    // Check if user is already logged in
    const token = this.getToken();
    const user = this.getStoredUser();
    if (token && user) {
      this.currentUserSubject.next(user);
      // Don't auto-connect socket here - it will be connected after successful login
      // or when the app validates the token is still valid
    }
  }

  register(data: RegisterRequest): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${this.apiUrl}/register`, data);
  }

  login(data: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.apiUrl}/login`, data).pipe(
      tap(response => {
        this.setToken(response.accessToken);
        this.setUser(response.user);
        this.currentUserSubject.next(response.user);
        this.socketService.connect(response.accessToken, response.user.id);
      }),
      catchError(error => {
        console.error('AuthService login error:', error);
        return throwError(() => error);
      })
    );
  }

  verifyEmail(token: string): Observable<VerifyEmailResponse> {
    return this.http.get<VerifyEmailResponse>(`${this.apiUrl}/verify-email?token=${token}`);
  }

  resendVerification(usernameOrEmail: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/resend-verification`, { usernameOrEmail });
  }

  checkUsernameAvailability(username: string): Observable<{ available: boolean; username: string }> {
    return this.http.get<{ available: boolean; username: string }>(`${this.apiUrl}/check-username?username=${encodeURIComponent(username)}`);
  }

  logout(): void {
    this.socketService.disconnect();
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    this.currentUserSubject.next(null);
  }

  getToken(): string | null {
    return localStorage.getItem('accessToken');
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  private setToken(token: string): void {
    localStorage.setItem('accessToken', token);
  }

  private setUser(user: User): void {
    localStorage.setItem('user', JSON.stringify(user));
  }

  getStoredUser(): User | null {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  }
}
