import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { portalSessions } from "./portal/session.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);
const isProduction = process.env.NODE_ENV === "production";

app.use(express.json({ limit: "16kb" }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

const sessionCookie = (res: express.Response, id: string) => res.cookie("kiet_session", id, {
  httpOnly: true,
  sameSite: "lax",
  secure: isProduction,
  maxAge: 30 * 60 * 1000,
});

const sessionId = (req: express.Request) => {
  const header = req.headers.cookie?.match(/(?:^|; )kiet_session=([^;]+)/)?.[1];
  return header ? decodeURIComponent(header) : "";
};

const handleError = (res: express.Response, error: unknown) => {
  const message = error instanceof Error ? error.message : "Something went wrong while connecting to KIET.";
  res.status(400).json({ error: message });
};

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/start", async (req, res) => {
  try {
    const { username, password } = req.body as { username?: string; password?: string };
    const result = await portalSessions.start(username ?? "", password ?? "");
    sessionCookie(res, result.id);
    res.json({ stage: result.stage, data: result.data });
  } catch (error) { handleError(res, error); }
});

app.post("/api/auth/verify", async (req, res) => {
  try {
    const { otp } = req.body as { otp?: string };
    const data = await portalSessions.verify(sessionId(req), otp ?? "");
    res.json({ stage: "authenticated", data });
  } catch (error) { handleError(res, error); }
});

app.get("/api/dashboard", (req, res) => {
  try { res.json({ data: portalSessions.getData(sessionId(req)) }); }
  catch (error) { handleError(res, error); }
});

app.get("/api/debug/portal", (req, res) => {
  try { res.json({ diagnostics: portalSessions.getDiagnostics(sessionId(req)) }); }
  catch (error) { handleError(res, error); }
});

app.post("/api/auth/logout", async (req, res) => {
  await portalSessions.destroy(sessionId(req));
  res.clearCookie("kiet_session");
  res.status(204).end();
});

if (isProduction) {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const clientRoot = path.join(root, "../../dist");
  app.use(express.static(clientRoot));
  app.use((_req, res) => res.sendFile(path.join(clientRoot, "index.html")));
}

app.listen(port, () => console.log(`KIET attendance server listening on http://localhost:${port}`));
