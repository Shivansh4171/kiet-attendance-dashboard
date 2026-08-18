import type { DashboardData, Subject } from "../../src/types.js";

type ApiRecord = Record<string, unknown>;

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const keyName = (value: string) => value.replace(/[^a-z0-9]/gi, "").toLowerCase();

const aliases = {
  code: new Set(["coursecode", "subjectcode", "subjectid", "code", "courseid"]),
  name: new Set(["coursename", "coursedescription", "subjectname", "subject", "course", "name"]),
  component: new Set(["component", "componentname", "componenttype", "coursetype", "type"]),
  faculty: new Set(["faculty", "facultyname", "teacher", "teachername", "instructor"]),
  present: new Set(["present", "presentcount", "numberofpresent", "presentlecture", "presentlectures", "presentperiods", "classespresent", "classesattended", "attended", "attendedclasses", "attendedlectures"]),
  total: new Set(["total", "totalcount", "numberofperiods", "totalclasses", "totallecture", "totallectures", "totalperiods", "classestotal", "classesconducted", "conducted", "conductedclasses"]),
  presentTotal: new Set(["presenttotal", "attendancetotal", "lecturecount", "lectures"]),
  percentage: new Set(["percentage", "attendancepercentage", "attendancepercent", "percent", "attendance", "presentpercentage", "presentpercentagewith"]),
  status: new Set(["status", "attendancestatus"]),
  overall: new Set(["overallattendance", "overallattendancepercentage", "overallattendancepercent", "overallpercentage", "totalattendancepercentage"]),
} as const;

const valueFor = (record: ApiRecord, names: Set<string>) => {
  const entry = Object.entries(record).find(([key]) => names.has(keyName(key)));
  return entry?.[1];
};

const numberFrom = (value: unknown) => {
  const match = clean(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
};

const percentageFrom = (value: unknown) => {
  const parsed = numberFrom(value);
  if (parsed === undefined) return undefined;
  return Math.max(0, Math.min(100, parsed));
};

const countPairFrom = (value: unknown) => {
  const match = clean(value).match(/(\d+(?:\.\d+)?)\s*(?:\/|of)\s*(\d+(?:\.\d+)?)/i);
  return match ? { present: Number(match[1]), total: Number(match[2]) } : undefined;
};

const isRecord = (value: unknown): value is ApiRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);

type Identity = { code: string; name: string };

// The real CyberVidya payload nests attendance numbers one level below the
// course identity: a course record carries courseCode/courseName plus a
// child array of per-component records (componentName/numberOfPresent/
// numberOfPeriods/presentPercentage), and the child records carry no course
// identity of their own. So identity has to be read on the way down and
// carried into whichever descendant actually looks like a component.
const identityOf = (record: ApiRecord): Identity => ({
  code: clean(valueFor(record, aliases.code)),
  name: clean(valueFor(record, aliases.name)),
});

const hasIdentity = (identity: Identity) => Boolean(identity.code || identity.name);

const looksLikeComponent = (record: ApiRecord) => {
  const component = valueFor(record, aliases.component);
  const attendance = valueFor(record, aliases.percentage);
  const present = valueFor(record, aliases.present);
  const total = valueFor(record, aliases.total);
  return Boolean(clean(component) || attendance !== undefined || present !== undefined || total !== undefined);
};

const subjectFromRecord = (record: ApiRecord, identity: Identity): Subject | null => {
  if (!hasIdentity(identity)) return null;
  const pair = countPairFrom(valueFor(record, aliases.presentTotal));
  const present = numberFrom(valueFor(record, aliases.present)) ?? pair?.present;
  const total = numberFrom(valueFor(record, aliases.total)) ?? pair?.total;
  const explicitPercentage = percentageFrom(valueFor(record, aliases.percentage));
  const percentage = explicitPercentage ?? (present !== undefined && total ? Math.round((present / total) * 100) : undefined);
  return {
    courseCode: identity.code,
    courseName: identity.name,
    component: clean(valueFor(record, aliases.component)),
    faculty: clean(valueFor(record, aliases.faculty)),
    present,
    total,
    percentage: percentage ?? 0,
    ...(clean(valueFor(record, aliases.status)) ? { status: clean(valueFor(record, aliases.status)) } : {}),
  };
};

const collectSubjects = (value: unknown, subjects: Subject[], seen: Set<ApiRecord>, inherited?: Identity) => {
  if (Array.isArray(value)) {
    for (const item of value) collectSubjects(item, subjects, seen, inherited);
    return;
  }
  if (!isRecord(value) || seen.has(value)) return;
  seen.add(value);

  const own = identityOf(value);
  const identity = hasIdentity(own) ? own : inherited;

  // A record only becomes a subject once it has BOTH an identity (its own,
  // or inherited from a parent course record) and component-shaped
  // attendance numbers. A course record alone (identity, no numbers) or a
  // component record alone (numbers, no identity) is skipped here and
  // resolved once the two combine on the way down/up the tree.
  if (identity && hasIdentity(identity) && looksLikeComponent(value)) {
    const subject = subjectFromRecord(value, identity);
    if (subject) subjects.push(subject);
  }

  for (const child of Object.values(value)) collectSubjects(child, subjects, seen, identity);
};

const findOverallPercentage = (value: unknown, seen: Set<ApiRecord>): number | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOverallPercentage(item, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value) || seen.has(value)) return undefined;
  seen.add(value);
  const direct = percentageFrom(valueFor(value, aliases.overall));
  if (direct !== undefined) return direct;
  for (const child of Object.values(value)) {
    const found = findOverallPercentage(child, seen);
    if (found !== undefined) return found;
  }
  return undefined;
};

const firstPercentageFromText = (text: string) => {
  const match = text.match(/Overall\s*Attendance[^\d]*(\d+(?:\.\d+)?\s*%)/i);
  return match ? percentageFrom(match[1]) : undefined;
};

const weightedPercentage = (subjects: Subject[]) => {
  const counted = subjects.filter((subject) => subject.present !== undefined && subject.total !== undefined && subject.total > 0);
  const total = counted.reduce((sum, subject) => sum + (subject.total ?? 0), 0);
  return total ? Math.round((counted.reduce((sum, subject) => sum + (subject.present ?? 0), 0) / total) * 100) : 0;
};

export const normalizeAttendanceApiResponse = (payload: unknown, fallbackOverallText = ""): DashboardData => {
  const subjects: Subject[] = [];
  collectSubjects(payload, subjects, new Set<ApiRecord>());
  const apiOverall = findOverallPercentage(payload, new Set<ApiRecord>());
  const overallPercentage = apiOverall ?? firstPercentageFromText(fallbackOverallText) ?? weightedPercentage(subjects);
  const present = subjects.reduce((sum, subject) => sum + (subject.present ?? 0), 0);
  const total = subjects.reduce((sum, subject) => sum + (subject.total ?? 0), 0);
  return {
    attendance: { percentage: overallPercentage, ...(total ? { present, total } : {}) },
    subjects,
    source: "portal",
    fetchedAt: new Date().toISOString(),
  };
};
