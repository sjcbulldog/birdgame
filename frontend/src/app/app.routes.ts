import { Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { RegisterComponent } from './components/register/register.component';
import { VerifyEmailComponent } from './components/verify-email/verify-email.component';
import { HomeComponent } from './components/home/home.component';
import { GameComponent } from './components/game/game.component';
import { WatcherComponent } from './components/watcher/watcher.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'verify-email', component: VerifyEmailComponent },
  { path: 'home', component: HomeComponent, canActivate: [authGuard] },
  { path: 'game/:gameId', component: GameComponent, canActivate: [authGuard] },
  { path: 'watch/:gameId', component: WatcherComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '/login' }
];
