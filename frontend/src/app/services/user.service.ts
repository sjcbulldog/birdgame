import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { environment } from '../../environments/environment';

export interface UserIcon {
  id: string;
  name: string;
  url: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  userType: string;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  private readonly defaultIcon: UserIcon = {
    id: 'default',
    name: 'Default User',
    url: '/assets/icons/default-user.svg'
  };

  /**
   * Gets the icon associated with a user.
   * Currently returns the default icon for all users.
   * In the future, this will fetch the user's selected icon from the backend.
   * 
   * @param userId - The ID of the user
   * @returns Observable of the user's icon
   */
  getUserIcon(userId: string): Observable<UserIcon> {
    // TODO: In the future, fetch the user's selected icon from the backend
    // return this.http.get<UserIcon>(`${this.apiUrl}/users/${userId}/icon`);
    return of(this.defaultIcon);
  }

  /**
   * Gets all available icons that users can choose from.
   * Currently returns only the default icon.
   * In the future, this will fetch all available icons from the backend.
   * 
   * @returns Observable of available user icons
   */
  getAvailableIcons(): Observable<UserIcon[]> {
    // TODO: In the future, fetch all available icons from the backend
    // return this.http.get<UserIcon[]>(`${this.apiUrl}/icons`);
    return of([this.defaultIcon]);
  }

  /**
   * Updates the user's selected icon.
   * Currently not implemented as users cannot change icons yet.
   * In the future, this will update the user's icon selection in the backend.
   * 
   * @param userId - The ID of the user
   * @param iconId - The ID of the selected icon
   * @returns Observable of the updated icon
   */
  updateUserIcon(userId: string, iconId: string): Observable<UserIcon> {
    // TODO: In the future, update the user's icon in the backend
    // return this.http.put<UserIcon>(`${this.apiUrl}/users/${userId}/icon`, { iconId });
    throw new Error('Icon selection not yet implemented');
  }

  /**
   * Gets all users (admin only)
   */
  getAllUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${this.apiUrl}/users`);
  }

  /**
   * Updates a user's type (admin only)
   */
  updateUserType(userId: string, userType: string): Observable<User> {
    return this.http.put<User>(`${this.apiUrl}/users/${userId}/user-type`, { userType });
  }
}
