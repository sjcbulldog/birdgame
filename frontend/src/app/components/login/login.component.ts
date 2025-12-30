import { Component, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss']
})
export class LoginComponent {
  loginForm: FormGroup;
  errorMessage = '';
  isLoading = false;
  needsVerification = false;
  userEmail = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    this.loginForm = this.fb.group({
      usernameOrEmail: ['', [Validators.required]],
      password: ['', [Validators.required]]
    });
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.needsVerification = false;

    this.authService.login(this.loginForm.value).subscribe({
      next: () => {
        this.isLoading = false;
        this.router.navigate(['/home']);
      },
      error: (error) => {
        console.error('Login error:', error);
        console.error('Error structure:', JSON.stringify(error, null, 2));
        
        // Try multiple ways to extract the error message
        let message = '';
        if (error.error && typeof error.error === 'object' && error.error.message) {
          message = error.error.message;
        } else if (error.message) {
          message = error.message;
        } else if (typeof error.error === 'string') {
          message = error.error;
        }
        
        const lowerMessage = message.toLowerCase();
        const hasVerify = lowerMessage.includes('verify');
        const hasEmail = lowerMessage.includes('email');
        
        if (hasVerify && hasEmail) {
          this.needsVerification = true;
          this.userEmail = this.loginForm.value.usernameOrEmail;
          this.errorMessage = 'Please verify your email address before logging in.';
          this.cdr.detectChanges();
        } else {
          this.errorMessage = message || 'Login failed. Please check your credentials.';
        }
        this.isLoading = false;
        this.cdr.detectChanges()
        this.isLoading = false;
      },
      complete: () => {
        // Ensure loading is always set to false
        if (this.isLoading) {
          this.isLoading = false;
        }
      }
    });
  }

  resendVerification(): void {
    this.isLoading = true;
    this.errorMessage = '';
    
    this.authService.resendVerification(this.userEmail).subscribe({
      next: (response) => {
        // Show success message briefly
        this.errorMessage = response.message || 'Verification email sent! Please check your inbox.';
        this.needsVerification = false;
        this.isLoading = false;
        this.cdr.detectChanges();
        
        // Refresh the form after 2 seconds
        setTimeout(() => {
          this.loginForm.reset();
          this.errorMessage = '';
          this.userEmail = '';
          this.cdr.detectChanges();
        }, 2000);
      },
      error: (error) => {
        console.error('Resend verification error:', error);
        this.errorMessage = error.error?.message || error.message || 'Failed to resend verification email.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  get usernameOrEmail() { return this.loginForm.get('usernameOrEmail'); }
  get password() { return this.loginForm.get('password'); }
}
