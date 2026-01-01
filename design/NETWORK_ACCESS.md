# Network Access Configuration

## The Problem Fixed

Previously, the application was hardcoded to use `localhost:3000`, which only works on the same machine. When trying to access from a different machine, you would get "0 Unknown error" because the frontend couldn't connect to the backend.

## Solution

The application now automatically detects the server's IP address and uses it for API and WebSocket connections.

## How to Access from Different Machines

### 1. Start the Backend Server

From the `backend` directory:
```bash
npm run start:dev
```

The server will display:
```
Application is running on: http://localhost:3000
Network access: http://<your-ip>:3000
```

### 2. Find Your Machine's IP Address

**Windows:**
```bash
ipconfig
```
Look for "IPv4 Address" (typically something like `192.168.1.x`)

**Linux/Mac:**
```bash
ifconfig
# or
ip addr
```

### 3. Start the Frontend

From the `frontend` directory:
```bash
npm start
```

### 4. Access from Other Machines

From any machine on the same network, open a browser and go to:
```
http://<server-ip>:4200
```

For example: `http://192.168.1.100:4200`

The frontend will automatically use the correct IP address to connect to the backend on port 3000.

## Firewall Configuration

Make sure your firewall allows incoming connections on ports:
- **3000** - Backend API and WebSocket
- **4200** - Frontend (Angular dev server)

**Windows Firewall:**
```powershell
# Allow port 3000
New-NetFirewallRule -DisplayName "Birds Backend" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow

# Allow port 4200
New-NetFirewallRule -DisplayName "Birds Frontend" -Direction Inbound -LocalPort 4200 -Protocol TCP -Action Allow
```

## How It Works

### Frontend Changes

1. **Environment Configuration** (`frontend/src/environments/environment.ts`):
   - Uses `window.location.hostname` to automatically detect the server IP
   - No more hardcoded `localhost`

2. **Service Updates**:
   - `auth.service.ts` - Uses environment config
   - `socket.service.ts` - Uses environment config
   - `table.service.ts` - Uses environment config

### Backend Changes

1. **CORS Configuration** (`backend/src/main.ts`):
   - Changed `origin` to `true` to allow all origins in development
   - Enables `credentials: true` for cookie/auth support

2. **Network Binding**:
   - Server now listens on `0.0.0.0` (all network interfaces)
   - Previously only listened on `127.0.0.1` (localhost only)

## Troubleshooting

### "0 Unknown error" still appears

1. **Check firewall** - Ensure ports 3000 and 4200 are open
2. **Check network** - Ensure both machines are on the same network
3. **Check IP** - Use the correct IP address (not localhost)
4. **Check backend** - Ensure backend is running and accessible

### Test backend connectivity

From the client machine:
```bash
curl http://<server-ip>:3000/auth/login
```

Should return a validation error (not a connection error).

### Test frontend serving

The Angular dev server binds to `localhost` by default. To allow network access:

```bash
ng serve --host 0.0.0.0
```

Or update `package.json`:
```json
{
  "scripts": {
    "start": "ng serve --host 0.0.0.0"
  }
}
```

## Production Deployment

For production, you would:
1. Build the frontend: `npm run build`
2. Serve it from the backend (already configured in `app.module.ts`)
3. Access via single URL (backend serves everything)
4. Configure proper domain name and HTTPS
