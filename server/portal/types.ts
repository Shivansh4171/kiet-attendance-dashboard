import type { BrowserContext, Page } from "playwright";
import type { DashboardData } from "../../src/types.js";

export type PortalDiagnostics = {
  capturedAt: string;
  finalUrl: string;
  attendanceApi: {
    requestObserved: boolean;
    cookieSent: boolean;
    authHeaderNames: string[];
    responseStatus?: number;
  };
};

export type PortalSession = {
  id: string;
  context: BrowserContext;
  page: Page;
  createdAt: number;
  lastUsedAt: number;
  credentialsCleared: boolean;
  stage: "login" | "otp" | "authenticated";
  data?: DashboardData;
  diagnostics?: PortalDiagnostics;
  attendanceAuthHeaders?: Record<string, string>;
  attendanceRequest?: {
    observed: boolean;
    cookieSent: boolean;
    authHeaderNames: string[];
  };
};
