import crypto from "node:crypto";
import { chromium, type Locator, type Page } from "playwright";
import type { DashboardData } from "../../src/types.js";
import { normalizeAttendanceApiResponse } from "./normalizer.js";
import type { PortalDiagnostics, PortalSession } from "./types.js";

const PORTAL_URL = process.env.KIET_PORTAL_URL ?? "https://kiet.cybervidya.net/";
const ATTENDANCE_API_PATH = "/api/attendance/course/component/student";
const SESSION_TTL_MS = 30 * 60 * 1000;
const OTP_INPUT_SELECTOR = "#generate-otp app-generate-otp input.otp-input";
const OTP_VERIFY_SELECTOR = "#generate-otp app-generate-otp button[type='submit']";

const sessions = new Map<string, PortalSession>();

const touch = (session: PortalSession) => { session.lastUsedAt = Date.now(); };

const isAuthHeader = (name: string) => name === "authorization" || name === "uid" || /(?:token|auth|csrf|session|jwt)/i.test(name);

const captureAttendanceRequest = (session: PortalSession, page: Page) => {
  page.on("request", (request) => {
    try {
      const url = new URL(request.url());
      if (request.method() !== "GET" || !url.pathname.endsWith("/attendance/course/component/student")) return;
      const headers = request.headers();
      const authHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => isAuthHeader(name)));
      session.attendanceAuthHeaders = authHeaders;
      session.attendanceRequest = {
        observed: true,
        cookieSent: Boolean(headers.cookie),
        authHeaderNames: Object.keys(authHeaders).sort(),
      };
    } catch {
      // Network diagnostics must never interfere with authentication.
    }
  });
};

const throwIfPortalBlocked = async (page: Page) => {
  const text = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (text.includes("captcha")) throw new Error("The official portal is asking for a CAPTCHA. Complete it on the official portal, then retry.");
  if (text.includes("service unavailable") || text.includes("site cannot be reached")) throw new Error("The KIET portal is currently unavailable.");
};

const findOtpInputs = async (page: Page) => {
  const inputs = page.locator(OTP_INPUT_SELECTOR);
  await inputs.first().waitFor({ state: "visible", timeout: 15_000 });
  const count = await inputs.count();
  if (count !== 6) throw new Error(`The official portal returned an unexpected OTP layout (${count} fields found).`);
  return inputs;
};

const findOtpVerifyButton = async (page: Page) => {
  const buttons = page.locator(OTP_VERIFY_SELECTOR).filter({ hasText: /^\s*Verify\s*$/i });
  await buttons.first().waitFor({ state: "visible", timeout: 15_000 });
  return buttons.first();
};

const readOtpState = async (page: Page) => {
  const inputs = page.locator(OTP_INPUT_SELECTOR);
  const buttons = page.locator(OTP_VERIFY_SELECTOR).filter({ hasText: /^\s*Verify\s*$/i });
  return {
    inputCount: await inputs.count(),
    inputs: await inputs.evaluateAll(String.raw`(elements) => elements.map((element) => {
      const input = element;
      return {
        id: element.id,
        filled: Boolean(input.value),
        valueLength: input.value.length,
        maxLength: input.maxLength,
        disabled: input.disabled,
      };
    })`),
    verifyButtons: await buttons.evaluateAll(String.raw`(elements) => elements.map((element) => {
      const button = element;
      return ({
        disabled: button.disabled,
        className: element.className,
        ariaDisabled: element.getAttribute("aria-disabled"),
      });
    })`),
  };
};

const waitForOtpButtonEnabled = async (page: Page, button: Locator) => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await button.isEnabled().catch(() => false)) return;
    await page.waitForTimeout(100);
  }
  const state = await readOtpState(page);
  throw new Error(`The official portal did not enable Verify after the six OTP digits were entered. State: ${JSON.stringify(state)}`);
};

const enterOtpLikeAUser = async (page: Page, otpValue: string) => {
  const inputs = await findOtpInputs(page);
  for (let index = 0; index < otpValue.length; index += 1) {
    const input = inputs.nth(index);
    await input.click();
    await input.press("Control+A").catch(() => undefined);
    await input.press("Backspace").catch(() => undefined);
    await input.pressSequentially(otpValue[index], { delay: 60, timeout: 5_000 });
  }
  const verify = await findOtpVerifyButton(page);
  await waitForOtpButtonEnabled(page, verify);
  return verify;
};

const fetchAttendanceApi = async (session: PortalSession, origin: string) => {
  const response = await session.page.request.get(`${origin}${ATTENDANCE_API_PATH}`, {
    headers: session.attendanceAuthHeaders ?? {},
  });
  if (session.diagnostics) session.diagnostics.attendanceApi.responseStatus = response.status();
  if (!response.ok()) {
    if (response.status() === 401 || response.status() === 403) throw new Error("The authenticated CyberVidya attendance API rejected the current session.");
    throw new Error(`The CyberVidya attendance API returned HTTP ${response.status()}.`);
  }
  const payload = await response.json().catch(() => undefined);
  if (payload === undefined) throw new Error("The CyberVidya attendance API returned an unreadable response.");
  return payload;
};

export class PortalSessionManager {
  private browserPromise?: ReturnType<typeof chromium.launch>;

  async start(username: string, password: string) {
    if (!username.trim() || !password) throw new Error("Enter both your ERP username and password.");
    this.browserPromise ??= chromium.launch({ headless: process.env.HEADLESS !== "false" });
    const browser = await this.browserPromise;
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    const id = crypto.randomUUID();
    const session: PortalSession = { id, context, page, createdAt: Date.now(), lastUsedAt: Date.now(), credentialsCleared: false, stage: "login" };
    sessions.set(id, session);
    captureAttendanceRequest(session, page);
    try {
      await page.goto(PORTAL_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.locator("#username").fill(username);
      await page.locator("#password").fill(password);
      await page.locator("#submitLogin").click();
      session.credentialsCleared = true;
      await page.waitForTimeout(1_000);
      await throwIfPortalBlocked(page);
      const otpInputs = page.locator(OTP_INPUT_SELECTOR);
      await otpInputs.first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
      if (await otpInputs.count() === 6 && await otpInputs.first().isVisible().catch(() => false)) {
        session.stage = "otp";
        touch(session);
        return { id, stage: session.stage };
      }
      if (page.url().includes("login")) throw new Error("The portal did not accept the login details. Check your username and password.");
      session.stage = "authenticated";
      session.data = await this.collect(session);
      return { id, stage: session.stage, data: session.data };
    } catch (error) {
      await this.destroy(id);
      throw error instanceof Error ? error : new Error("Could not start the KIET portal session.");
    } finally {
      username = "";
      password = "";
    }
  }

  async verify(id: string, otpValue: string) {
    const session = this.get(id);
    if (session.stage !== "otp") throw new Error("This sign-in step has expired. Start again.");
    if (!/^\d{4,8}$/.test(otpValue.trim())) throw new Error("Enter the numeric OTP sent by the official portal.");
    const verify = await enterOtpLikeAUser(session.page, otpValue.trim());
    await verify.click();
    await session.page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 }).catch(() => undefined);
    await session.page.locator("app-dashboard, app-navbar, app-sidebar, .wrapper").first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => undefined);
    await session.page.waitForTimeout(1_500);
    await throwIfPortalBlocked(session.page);
    if (session.page.url().includes("login")) throw new Error("That OTP was not accepted. Check it and try again.");
    session.stage = "authenticated";
    try {
      session.data = await this.collect(session);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      console.error(`[portal] post-verification attendance collection failed: ${message}`);
      throw error;
    }
    touch(session);
    return session.data;
  }

  getData(id: string) {
    const session = this.get(id);
    if (session.stage !== "authenticated" || !session.data) throw new Error("Your portal session is not ready.");
    touch(session);
    return session.data;
  }

  getDiagnostics(id: string) {
    const session = this.get(id);
    if (session.stage !== "authenticated" || !session.diagnostics) throw new Error("Your portal diagnostics are not ready.");
    touch(session);
    return session.diagnostics;
  }

  async destroy(id: string) {
    const session = sessions.get(id);
    sessions.delete(id);
    if (session?.context) await session.context.close().catch(() => undefined);
  }

  private get(id: string) {
    const session = sessions.get(id);
    if (!session || Date.now() - session.lastUsedAt > SESSION_TTL_MS) {
      if (session) void this.destroy(id);
      throw new Error("Your portal session expired. Please sign in again.");
    }
    return session;
  }

  private async collect(session: PortalSession): Promise<DashboardData> {
    const origin = new URL(PORTAL_URL).origin;
    await session.page.goto(`${origin}/main/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await session.page.waitForTimeout(1_800);
    await throwIfPortalBlocked(session.page);

    const dashboardText = await session.page.locator("body").innerText().catch(() => "");
    session.diagnostics = {
      capturedAt: new Date().toISOString(),
      finalUrl: session.page.url(),
      attendanceApi: {
        requestObserved: session.attendanceRequest?.observed ?? false,
        cookieSent: session.attendanceRequest?.cookieSent ?? false,
        authHeaderNames: session.attendanceRequest?.authHeaderNames ?? [],
      },
    };
    const payload = await fetchAttendanceApi(session, origin);
    const data = normalizeAttendanceApiResponse(payload, dashboardText);
    if (!data.subjects.length) throw new Error("The CyberVidya attendance API returned no subject records.");
    return data;
  }
}

export const portalSessions = new PortalSessionManager();
