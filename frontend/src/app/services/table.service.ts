import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Table, Position } from '../models/table.model';

@Injectable({
  providedIn: 'root',
})
export class TableService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000/api/tables';

  getTables(): Observable<Table[]> {
    return this.http.get<Table[]>(this.apiUrl);
  }

  joinTable(tableId: string, position: Position): Observable<any> {
    return this.http.post(`${this.apiUrl}/${tableId}/join`, { position }).pipe(
      catchError((error) => {
        return throwError(() => error);
      })
    );
  }

  leaveTable(tableId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${tableId}/leave`, {});
  }

  watchTable(tableId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${tableId}/watch`, {});
  }

  unwatchTable(tableId: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${tableId}/watch`);
  }

  startGame(tableId: string): Observable<{ success: boolean; gameId: string }> {
    return this.http.post<{ success: boolean; gameId: string }>(`${this.apiUrl}/${tableId}/start-game`, {});
  }

  getPreferences(): Observable<{ tableCount: number; dealAnimationTime: number }> {
    return this.http.get<{ tableCount: number; dealAnimationTime: number }>(`${this.apiUrl}/preferences`);
  }

  setPreferences(preferences: { tableCount: number; dealAnimationTime: number }): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/preferences`, preferences);
  }
}
