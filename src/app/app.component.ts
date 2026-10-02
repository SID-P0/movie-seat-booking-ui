import { Component, OnInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { HttpHeaders } from '@angular/common/http';

export const API_BASE_URL = ''; // E.g., 'http://12.34.56.78:8080' for GCP deployment

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  shows: any[] = [];
  selectedShow: any = null;
  seats: string[] = [];
  seatMap: { [key: string]: string } = {};
  selectedSeats: Set<string> = new Set<string>();
  
  myReservations: any[] = [];
  
  userId: string = '';
  token: string = '';
  
  showAdminForm = false;
  newShowName = '';
  newShowPrice = 1500;
  newShowSeats = 30;

  showUserForm = false;
  newUserEmail = '';
  currentUserEmail = '';
  
  toastMessage = '';
  toastType: 'success' | 'error' = 'success';
  
  eventSource?: EventSource;

  constructor(private http: HttpClient, private ngZone: NgZone) {}

  ngOnInit() {
    this.registerUser();
    this.fetchShows();
  }

  registerUser() {
    const cachedToken = localStorage.getItem('token');
    const cachedUserId = localStorage.getItem('userId');
    const cachedEmail = localStorage.getItem('email');
    if (cachedToken && cachedUserId) {
       this.token = cachedToken;
       this.userId = cachedUserId;
       this.currentUserEmail = cachedEmail || 'user_' + cachedUserId.substring(0, 5) + '@example.com';
       return;
    }
    const email = 'user_' + Math.floor(Math.random() * 1000) + '@example.com';
    this.http.post<any>(API_BASE_URL + '/users/register', { email })
      .subscribe({
        next: (res) => {
          this.token = res.token;
          this.userId = res.user_id;
          this.currentUserEmail = res.email;
          localStorage.setItem('token', this.token);
          localStorage.setItem('userId', this.userId);
          localStorage.setItem('email', res.email);
        },
        error: (err) => console.error('Registration failed', err)
      });
  }

  toggleUserForm() {
    this.showUserForm = !this.showUserForm;
  }

  showToast(message: string, type: 'success' | 'error') {
    this.toastMessage = message;
    this.toastType = type;
    setTimeout(() => {
      this.toastMessage = '';
    }, 4000);
  }

  createUser() {
    if (!this.newUserEmail) return;
    this.http.post<any>(API_BASE_URL + '/users/register', { email: this.newUserEmail })
      .subscribe({
        next: (res) => {
          this.token = res.token;
          this.userId = res.user_id;
          this.currentUserEmail = res.email;
          localStorage.setItem('token', this.token);
          localStorage.setItem('userId', this.userId);
          localStorage.setItem('email', res.email);
          this.showUserForm = false;
          this.newUserEmail = '';
          this.showToast('User created & logged in: ' + res.email, 'success');
          
          if (this.selectedShow) {
            this.selectShow(this.selectedShow.showId); // Re-fetch to update reservations and UI
          }
        },
        error: (err) => this.showToast('Failed to register: ' + (err.error?.error || err.message), 'error')
      });
  }

  fetchShows() {
    this.http.get<any[]>(API_BASE_URL + '/shows').subscribe({
      next: (res) => {
        this.shows = res;
      },
      error: (err) => console.error('Failed to fetch shows', err)
    });
  }

  toggleAdmin() {
    this.showAdminForm = !this.showAdminForm;
  }

  createShow() {
    if (!this.newShowName) return;
    
    // Generate simple seat layout (A1..A10, B1..B10, etc) based on total seats
    const newSeats = [];
    let row = 'A';
    let seatNum = 1;
    for (let i = 0; i < this.newShowSeats; i++) {
      newSeats.push(row + seatNum);
      seatNum++;
      if (seatNum > 10) {
        seatNum = 1;
        row = String.fromCharCode(row.charCodeAt(0) + 1);
      }
    }

    const headers = new HttpHeaders({
      'Authorization': 'Bearer super-secret-admin-token'
    });

    const payload = {
      name: this.newShowName,
      seats: newSeats,
      price: this.newShowPrice * 100, // Convert INR to paise for backend
      perUserLimit: 4
    };

    this.http.post(API_BASE_URL + '/shows', payload, { headers }).subscribe({
      next: (res: any) => {
        this.shows.push({ showId: res.showId, name: res.name });
        this.showAdminForm = false;
        this.newShowName = '';
        this.selectShow(res.showId);
        this.showToast('Show created successfully!', 'success');
      },
      error: (err) => {
        this.showToast('Failed to create show: ' + (err.error?.message || err.message), 'error');
      }
    });
  }

  selectShow(showId: string) {
    if (this.eventSource) {
      this.eventSource.close();
    }
    this.selectedSeats.clear();
    
    this.http.get<any>(API_BASE_URL + '/shows/' + showId).subscribe({
      next: (res) => {
        this.selectedShow = res;
        this.seatMap = res.seatMap;
        this.seats = Object.keys(this.seatMap).sort((a, b) => {
          const rowA = a.match(/[a-zA-Z]+/)?.[0] || '';
          const numA = parseInt(a.match(/\d+/)?.[0] || '0', 10);
          const rowB = b.match(/[a-zA-Z]+/)?.[0] || '';
          const numB = parseInt(b.match(/\d+/)?.[0] || '0', 10);
          if (rowA !== rowB) return rowA.localeCompare(rowB);
          return numA - numB;
        });
        
        this.connectSSE(showId);

        // Fetch my reservations for this show to restore cross-tab state
        if (this.token) {
          const headers = new HttpHeaders({
            'Authorization': 'Bearer ' + this.token
          });
          this.http.get<any[]>(API_BASE_URL + '/shows/' + showId + '/reservations/mine', { headers }).subscribe({
            next: (reservations) => {
              this.myReservations = reservations;
            },
            error: (err) => console.error('Failed to fetch my reservations', err)
          });
        }
      },
      error: (err) => console.error('Failed to fetch show details', err)
    });
  }

  connectSSE(showId: string) {
    this.eventSource = new EventSource(API_BASE_URL + '/shows/' + showId + '/stream');
    this.eventSource.addEventListener('seat_update', (event: any) => {
      this.ngZone.run(() => {
        const data = JSON.parse(event.data);
        this.seatMap = {
          ...this.seatMap,
          [data.seatId]: data.status
        };
      });
    });
    this.eventSource.onerror = (error) => {
      console.error('SSE Error:', error);
    };
  }

  get selectedSeatsArray() {
    return Array.from(this.selectedSeats);
  }

  toggleSeat(seatId: string) {
    if (this.seatMap[seatId] !== 'available' && !this.selectedSeats.has(seatId)) return;
    
    if (this.selectedSeats.has(seatId)) {
      this.selectedSeats.delete(seatId);
    } else {
      if (this.selectedSeats.size >= this.selectedShow.perUserLimit) {
        this.showToast('You can only select up to ' + this.selectedShow.perUserLimit + ' seats', 'error');
        return;
      }
      this.selectedSeats.add(seatId);
    }
  }

  proceedToCheckout() {
    if (this.selectedSeats.size === 0) return;

    const idempotencyKey = crypto.randomUUID();
    const headers = new HttpHeaders({
      'Authorization': 'Bearer ' + this.token
    });

    const seatsArray = Array.from(this.selectedSeats);

    this.http.post(API_BASE_URL + '/shows/' + this.selectedShow.showId + '/reserve', 
      { 
        seats: seatsArray,
        idempotencyKey: idempotencyKey
      }, 
      { headers }
    ).subscribe({
      next: (res: any) => {
         this.showToast('Seats successfully held for 10 minutes!', 'success');
         
         // Store the reservation to allow confirming or cancelling
         this.myReservations.push(res);
         
         // Update local state immediately to avoid race conditions with SSE connection
         const updatedMap = { ...this.seatMap };
         seatsArray.forEach(seatId => {
           updatedMap[seatId] = 'held';
         });
         this.seatMap = updatedMap;
         
         this.selectedSeats.clear();
      },
      error: (err) => {
         console.error('Booking failed', err);
         const errorMsg = err.error?.message || err.error?.error || err.message;
         this.showToast('Failed to hold seats: ' + errorMsg, 'error');
         this.selectShow(this.selectedShow.showId); // Refresh map if conflict
      }
    });
  }

  runBurstTest() {
    if (!this.selectedShow) return;
    this.showToast('Initiating 20,000 requests. This will take a moment...', 'success');
    this.http.post(API_BASE_URL + '/test/burst/' + this.selectedShow.showId + '?count=20000', {}, { responseType: 'text' })
      .subscribe({
        next: (res) => this.showToast(res, 'success'),
        error: (err) => this.showToast('Failed to initialize burst: ' + err.message, 'error')
      });
  }

  cancelReservation(reservationId: string) {
    const headers = new HttpHeaders({
      'Authorization': 'Bearer ' + this.token
    });

    this.http.post(API_BASE_URL + '/reservations/' + reservationId + '/cancel', 
      {}, 
      { headers }
    ).subscribe({
      next: (res: any) => {
        this.showToast('Successfully cancelled booking ' + res.seats.join(', '), 'success');
        // Remove from list
        this.myReservations = this.myReservations.filter(r => r.reservationId !== reservationId);
        
        // Optimistically update map to available if we're on the same show
        if (this.selectedShow && this.selectedShow.showId === res.showId) {
          const updatedMap = { ...this.seatMap };
          res.seats.forEach((s: string) => updatedMap[s] = 'available');
          this.seatMap = updatedMap;
        }
      },
      error: (err) => {
        const errorMsg = err.error?.message || err.error?.error || err.message;
        this.showToast('Failed to cancel: ' + errorMsg, 'error');
      }
    });
  }

  hasHeldSeats(): boolean {
    return this.myReservations.some(r => r.status === 'held' && this.selectedShow && r.showId === this.selectedShow.showId);
  }

  placeOrder() {
    const heldRes = this.myReservations.filter(r => r.status === 'held' && this.selectedShow && r.showId === this.selectedShow.showId);
    
    if (heldRes.length === 0) return;

    const headers = new HttpHeaders({
      'Authorization': 'Bearer ' + this.token
    });

    heldRes.forEach(res => {
      this.http.post(API_BASE_URL + '/reservations/' + res.reservationId + '/confirm', 
        {}, 
        { headers }
      ).subscribe({
        next: (confirmedRes: any) => {
          this.showToast('Order placed successfully for ' + confirmedRes.seats.join(', '), 'success');
          // Update status in list
          res.status = 'confirmed';
          
          // Update map locally
          const updatedMap = { ...this.seatMap };
          confirmedRes.seats.forEach((s: string) => updatedMap[s] = 'confirmed');
          this.seatMap = updatedMap;
        },
        error: (err) => {
          const errorMsg = err.error?.message || err.error?.error || err.message;
          this.showToast('Failed to place order: ' + errorMsg, 'error');
        }
      });
    });
  }
}
