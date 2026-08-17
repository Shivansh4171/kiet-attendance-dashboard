# Orbit · KIET attendance dashboard

Orbit is a React + Vite attendance-only frontend backed by an Express/Playwright CyberVidya session service. After the official username/password and OTP flow, the server calls CyberVidya’s authenticated attendance API and normalizes only overall and subject-wise attendance.

## Run locally

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:5173`.

## Portal integration

The server keeps the authenticated CyberVidya page session in memory. It fills the observed login selectors (`#username`, `#password`, `#submitLogin`), waits for the official OTP step, and types the OTP through real keyboard events so Angular enables Verify. Credentials and OTP values are cleared and never logged.

After verification, the adapter requests only:

`GET /api/attendance/course/component/student`

The request observer captures the current portal request’s auth-header names and reuses the auth mechanism in memory without exposing header values. The API response is normalized into overall attendance and expandable subject records containing course code, course name, component, present, total, percentage, and API-provided faculty/status when available.

No calendar, timetable, marks, CGPA, registered-course scraping, or demo data is used.

## Production build

```bash
npm run build
NODE_ENV=production npm start
```

Use HTTPS in front of the Express server so its session cookie is secure.
