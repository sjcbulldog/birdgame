import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SocketService } from '../services/socket.service';

export const authGuard = () => {
  const authService = inject(AuthService);
  const socketService = inject(SocketService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    // Connect socket if we have a token and user stored but socket is not connected
    const token = authService.getToken();
    const user = authService.getStoredUser();
    if (token && user && !socketService.isConnected()) {
      socketService.connect(token, user.id);
    }
    return true;
  }

  router.navigate(['/login']);
  return false;
};
