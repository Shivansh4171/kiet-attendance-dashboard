export type AttendanceStatus = "healthy" | "warning" | "danger";

export type AttendanceSummary = {
  percentage: number;
  present?: number;
  total?: number;
};

export type Subject = {
  courseCode: string;
  courseName: string;
  component: string;
  faculty: string;
  percentage: number;
  present?: number;
  total?: number;
  status?: string;
};

export type DashboardData = {
  attendance: AttendanceSummary;
  subjects: Subject[];
  source: "portal";
  fetchedAt: string;
};

export type AuthStage = "login" | "otp" | "loading" | "authenticated";
