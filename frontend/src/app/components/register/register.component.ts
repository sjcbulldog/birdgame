import { Component, computed, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterModule],
  templateUrl: './register.component.html',
  styleUrls: ['./register.component.scss']
})
export class RegisterComponent {
  registerForm: FormGroup;
  errorMessage = '';
  successMessage = '';
  isLoading = false;

  // Password requirement signals
  passwordValue = signal('');
  hasMinLength = computed(() => this.passwordValue().length >= 12);
  hasLowerCase = computed(() => /[a-z]/.test(this.passwordValue()));
  hasUpperCase = computed(() => /[A-Z]/.test(this.passwordValue()));
  hasNumber = computed(() => /[0-9]/.test(this.passwordValue()));
  hasSymbol = computed(() => /[^A-Za-z0-9]/.test(this.passwordValue()));

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.registerForm = this.fb.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, this.passwordValidator.bind(this)]],
      confirmPassword: ['', [Validators.required]],
      firstName: [''],
      lastName: ['']
    }, { validators: this.passwordMatchValidator });

    // Subscribe to password changes
    this.registerForm.get('password')?.valueChanges.subscribe(value => {
      this.passwordValue.set(value || '');
    });
  }

  passwordValidator(control: AbstractControl): ValidationErrors | null {
    const value = control.value || '';
    const errors: ValidationErrors = {};

    if (value.length < 12) {
      errors['minLength'] = true;
    }
    if (!/[a-z]/.test(value)) {
      errors['lowercase'] = true;
    }
    if (!/[A-Z]/.test(value)) {
      errors['uppercase'] = true;
    }
    if (!/[0-9]/.test(value)) {
      errors['number'] = true;
    }
    if (!/[^A-Za-z0-9]/.test(value)) {
      errors['symbol'] = true;
    }

    return Object.keys(errors).length > 0 ? errors : null;
  }

  passwordMatchValidator(g: FormGroup) {
    const password = g.get('password')?.value;
    const confirmPassword = g.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { mismatch: true };
  }

  onSubmit(): void {
    if (this.registerForm.invalid) {
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';

    const { username, email, password, firstName, lastName } = this.registerForm.value;

    this.authService.register({ username, email, password, firstName, lastName }).subscribe({
      next: (response) => {
        this.successMessage = response.message;
        this.isLoading = false;
        this.registerForm.reset();
        
        // Redirect to login after 3 seconds
        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 3000);
      },
      error: (error) => {
        this.errorMessage = error.error?.message || 'Registration failed. Please try again.';
        this.isLoading = false;
      }
    });
  }

  get username() { return this.registerForm.get('username'); }
  get email() { return this.registerForm.get('email'); }
  get password() { return this.registerForm.get('password'); }
  get confirmPassword() { return this.registerForm.get('confirmPassword'); }
}
