import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './verify-email.component.html',
  styleUrls: ['./verify-email.component.scss']
})
export class VerifyEmailComponent implements OnInit {
  isVerifying = true;
  isSuccess = false;
  message = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    
    if (!token) {
      this.isVerifying = false;
      this.message = 'Invalid verification link.';
      return;
    }

    this.authService.verifyEmail(token).subscribe({
      next: (response) => {
        this.isVerifying = false;
        this.isSuccess = true;
        this.message = response.message;
        
        // Redirect to login after 3 seconds
        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 3000);
      },
      error: (error) => {
        this.isVerifying = false;
        this.isSuccess = false;
        this.message = error.error?.message || 'Verification failed. The link may be invalid or expired.';
      }
    });
  }
}
