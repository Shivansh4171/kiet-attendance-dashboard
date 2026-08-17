import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import type { AttendanceStatus, AuthStage, DashboardData, Subject } from "./types";

const STATUS_CONFIG: Record<AttendanceStatus, { label: string; tone: string; bar: string }> = {
  healthy: { label: "On track", tone: "green", bar: "var(--green)" },
  warning: { label: "Keep an eye", tone: "amber", bar: "var(--amber)" },
  danger: { label: "Needs attention", tone: "red", bar: "var(--red)" },
};

const getStatus = (percentage: number): AttendanceStatus => percentage >= 75 ? "healthy" : percentage >= 60 ? "warning" : "danger";

const api = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, { headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Something went wrong. Please try again.");
  return body as T;
};

function App() {
  const [stage, setStage] = useState<AuthStage>("login");
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api<{ data: DashboardData }>("/api/dashboard").then((result) => { setData(result.data); setStage("authenticated"); }).catch(() => undefined);
  }, []);

  const startLogin = async (username: string, password: string) => {
    setError(""); setNotice(""); setStage("loading");
    try {
      const result = await api<{ stage: AuthStage; data?: DashboardData }>("/api/auth/start", { method: "POST", body: JSON.stringify({ username, password }) });
      if (result.data) setData(result.data);
      setStage(result.stage);
      if (result.stage === "authenticated") setNotice("Your attendance is ready.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not connect to the KIET portal."); setStage("login"); }
  };

  const verifyOtp = async (otp: string) => {
    setError(""); setStage("loading");
    try {
      const result = await api<{ data: DashboardData }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ otp }) });
      setData(result.data); setStage("authenticated"); setNotice("Your attendance is ready.");
    } catch (err) { setError(err instanceof Error ? err.message : "That OTP was not accepted."); setStage("otp"); }
  };

  const logout = async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => undefined); setData(null); setStage("login"); setNotice(""); };
  const refreshData = async () => {
    try { const result = await api<{ data: DashboardData }>("/api/dashboard"); setData(result.data); setNotice("Updated from the current portal session."); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not refresh portal data."); }
  };

  if (stage !== "authenticated" || !data) return <AuthScreen stage={stage} error={error} onStart={startLogin} onVerify={verifyOtp} />;
  return <Dashboard data={data} notice={notice} onLogout={logout} onRefresh={refreshData} />;
}

function AuthScreen({ stage, error, onStart, onVerify }: { stage: AuthStage; error: string; onStart: (username: string, password: string) => void; onVerify: (otp: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const isLoading = stage === "loading";
  return <main className="auth-page">
    <div className="auth-ambient auth-ambient-one" /><div className="auth-ambient auth-ambient-two" />
    <section className="auth-card">
      <div className="auth-story">
        <div className="brand-mark brand-mark-light"><BookOpen size={20} /><span>orbit</span></div>
        <div className="story-content">
          <div className="eyebrow light-eyebrow"><Sparkles size={14} /> Your week, in view</div>
          <h1>Make every<br /><em>class count.</em></h1>
          <p>A quieter way to keep up with attendance, subjects, and the week ahead at KIET.</p>
          <div className="story-stats"><div><strong>01</strong><span>One secure portal session</span></div><div><strong>02</strong><span>Attendance, simplified</span></div></div>
        </div>
        <div className="story-footer"><ShieldCheck size={16} /> Credentials stay between you and the official KIET portal.</div>
      </div>
      <div className="auth-form-wrap">
        {stage === "otp" ? <>
          <button className="back-link" onClick={() => window.location.reload()}><ArrowLeft size={15} /> Start over</button>
          <div className="auth-form-heading"><div className="form-icon"><ShieldCheck size={20} /></div><div><div className="eyebrow">Step 02 / Verify</div><h2>Check your phone</h2></div></div>
          <p className="form-copy">The official KIET portal sent a one-time code. Enter it here to finish signing in.</p>
          <form onSubmit={(event) => { event.preventDefault(); onVerify(otp); }}>
            <label htmlFor="otp">One-time password</label><input id="otp" inputMode="numeric" autoComplete="one-time-code" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••••" autoFocus required />
            {error && <ErrorNotice message={error} />}
            <button className="primary-button" disabled={isLoading || otp.length < 4}>{isLoading ? <><span className="spinner" /> Verifying…</> : <>Verify code <ArrowRight size={17} /></>}</button>
          </form>
          <div className="privacy-note"><CircleHelp size={15} /><span>Codes are used once and never stored.</span></div>
        </> : <>
          <div className="brand-mark brand-mark-dark"><BookOpen size={20} /><span>orbit</span></div>
          <div className="auth-form-heading"><div><div className="eyebrow">KIET / CyberVidya</div><h2>Welcome back.</h2></div></div>
          <p className="form-copy">Sign in through the official portal to see your personal academic data.</p>
          <form onSubmit={(event) => { event.preventDefault(); onStart(username, password); }}>
            <label htmlFor="username">ERP username</label><input id="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your registration number" autoComplete="username" required disabled={isLoading} />
            <label htmlFor="password">Password</label><input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your ERP password" autoComplete="current-password" required disabled={isLoading} />
            {error && <ErrorNotice message={error} />}
            <button className="primary-button" disabled={isLoading}>{isLoading ? <><span className="spinner" /> Connecting to KIET…</> : <>Continue <ArrowRight size={17} /></>}</button>
          </form>
          <div className="privacy-note"><ShieldCheck size={15} /><span>Password is sent only to the official portal and cleared after sign-in.</span></div>
        </>}
      </div>
    </section>
    <p className="auth-disclaimer">Orbit is a companion interface. Your academic data remains in the KIET / CyberVidya portal.</p>
  </main>;
}

function ErrorNotice({ message }: { message: string }) { return <div className="error-notice"><TriangleAlert size={16} /><span>{message}</span></div>; }

function Dashboard({ data, notice, onLogout, onRefresh }: { data: DashboardData; notice: string; onLogout: () => void; onRefresh: () => void }) {
  const attendanceStatus = getStatus(data.attendance.percentage);
  return <main className="main-content attendance-only">
    <header className="topbar"><div className="breadcrumb"><strong>Attendance</strong></div><div className="topbar-actions"><button className="icon-button" onClick={onRefresh} title="Refresh attendance"><RefreshCw size={17} /></button><button className="icon-button" onClick={onLogout} title="Log out"><LogOut size={17} /></button></div></header>
    <div className="content-inner">{notice && <div className="success-banner"><Check size={16} /> {notice}</div>}<AttendanceView data={data} status={attendanceStatus} /></div>
  </main>;
}

function ProgressBar({ percentage, status, compact = false }: { percentage: number; status: AttendanceStatus; compact?: boolean }) { const config = STATUS_CONFIG[status]; return <div className={`progress-track ${compact ? "progress-compact" : ""}`}><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, percentage))}%`, background: config.bar }} /></div>; }

function AttendanceView({ data, status }: { data: DashboardData; status: AttendanceStatus }) {
  const config = STATUS_CONFIG[status];
  return <div className="attendance-view">
    <section className="summary-grid attendance-summary"><div className="overall-card"><div className="card-kicker"><span className="kicker-icon"><Sparkles size={15} /></span> Overall attendance <span className={`status-pill ${config.tone}`}>{config.label}</span></div><div className="overall-main"><div><div className="big-number">{data.attendance.percentage}<span>%</span></div><p>{data.attendance.present !== undefined ? <>{data.attendance.present} present out of {data.attendance.total} classes</> : "Based on the latest portal update"}</p></div><div className="attendance-ring" style={{ background: `conic-gradient(${config.bar} ${data.attendance.percentage * 3.6}deg, #e9ede8 0deg)` }}><div><strong>{data.attendance.percentage}%</strong><span>current</span></div></div></div><ProgressBar percentage={data.attendance.percentage} status={status} /></div></section>
    <div className="section-heading"><div><div className="eyebrow">Subject-wise attendance</div><h2>Subjects</h2></div><span className="subject-count">{data.subjects.length} subjects</span></div>
    {data.subjects.length ? <div className="subject-grid">{data.subjects.map((subject) => <SubjectCard key={`${subject.courseCode}-${subject.component}`} subject={subject} />)}</div> : <EmptyState title="No attendance records found" copy="The authenticated attendance API did not return any subjects." />}
  </div>;
}

function SubjectCard({ subject }: { subject: Subject }) {
  const [expanded, setExpanded] = useState(false); const status = getStatus(subject.percentage); const config = STATUS_CONFIG[status];
  return <article className={`subject-card ${expanded ? "expanded" : ""}`}><button className="subject-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}><div className="subject-marker" style={{ background: config.bar }} /><div className="subject-title"><strong>{subject.courseName || "Unnamed subject"}</strong><span>{subject.courseCode || "Course code unavailable"}</span></div><div className="subject-percent" style={{ color: config.bar }}>{subject.percentage}<small>%</small></div><ChevronDown size={18} className="chevron" /></button><div className="subject-progress"><ProgressBar percentage={subject.percentage} status={status} compact /></div>{expanded && <div className="subject-details"><div className="detail-list"><div><span>Course code</span><strong>{subject.courseCode || "—"}</strong></div><div><span>Component</span><strong>{subject.component || "—"}</strong></div><div><span>Present</span><strong>{subject.present ?? "—"}</strong></div><div><span>Total</span><strong>{subject.total ?? "—"}</strong></div>{subject.faculty && <div><span>Faculty</span><strong>{subject.faculty}</strong></div>}{subject.status && <div><span>Status</span><strong className={`status-text ${config.tone}`}>{subject.status}</strong></div>}</div><div className="attendance-detail"><div><span>Attendance</span><strong>{subject.percentage}%</strong></div><ProgressBar percentage={subject.percentage} status={status} /></div></div>}</article>;
}

function EmptyState({ title, copy }: { title: string; copy: string }) { return <div className="empty-state"><div className="empty-icon"><BookOpen size={22} /></div><h3>{title}</h3><p>{copy}</p></div>; }

export default App;
