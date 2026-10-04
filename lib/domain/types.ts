import { z } from "zod";

export const PILLARS = ["health", "wealth", "happiness"] as const;
export const Pillar = z.enum(PILLARS);
export type Pillar = z.infer<typeof Pillar>;

/** 'YYYY-MM-DD', a calendar date in the user's time zone. */
export const ISODate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Invalid calendar date");
export type ISODate = string;
/** Full ISO 8601 timestamp with offset. */
export type ISODateTime = string;

export const GOAL_STATUSES = ["active", "paused", "achieved"] as const;
export const GoalStatus = z.enum(GOAL_STATUSES);
export type GoalStatus = z.infer<typeof GoalStatus>;

export const Goal = z.object({
  id: z.string(),
  pillar: Pillar,
  title: z.string(),
  parentId: z.string().optional(),
  status: GoalStatus,
  targetDate: ISODate.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Goal = z.infer<typeof Goal>;

export const MissPolicy = z.enum(["skip", "carry"]);
export type MissPolicy = z.infer<typeof MissPolicy>;

export const Task = z.object({
  id: z.string(),
  title: z.string(),
  /** Alignment; the task's pillar is derived from its goals. */
  goalIds: z.array(z.string()),
  /** Fallback when the task serves a pillar but no specific goal. */
  pillar: Pillar.optional(),
  /** RFC 5545 rule body without DTSTART, e.g. 'FREQ=DAILY'; absent = ad hoc. */
  rrule: z.string().optional(),
  /** DTSTART anchor for the rrule; creation date for ad hoc. */
  startDate: ISODate,
  /** Ad hoc only. */
  dueAt: ISODate.optional(),
  missPolicy: MissPolicy,
  /** false = archived; no new occurrences. */
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof Task>;

export const OCCURRENCE_STATUSES = ["pending", "done", "skipped"] as const;
export const OccurrenceStatus = z.enum(OCCURRENCE_STATUSES);
export type OccurrenceStatus = z.infer<typeof OccurrenceStatus>;

export const Occurrence = z.object({
  /** Deterministic `${taskId}@${scheduledFor}`, so (taskId, scheduledFor) is unique by construction. */
  id: z.string(),
  taskId: z.string(),
  scheduledFor: ISODate,
  status: OccurrenceStatus,
  completedAt: z.string().optional(),
  note: z.string().optional(),
});
export type Occurrence = z.infer<typeof Occurrence>;

export const StoreData = z.object({
  version: z.literal(2),
  goals: z.array(Goal),
  tasks: z.array(Task),
  occurrences: z.array(Occurrence),
});
export type StoreData = z.infer<typeof StoreData>;

export const occurrenceId = (taskId: string, scheduledFor: ISODate) => `${taskId}@${scheduledFor}`;

export type DomainErrorCode =
  | "INVALID_RRULE"
  | "NOT_FOUND"
  | "INVALID_DATE"
  | "RANGE_TOO_LARGE"
  | "UNKNOWN_GOAL"
  | "GOAL_PILLAR_MISMATCH"
  | "GOAL_CYCLE"
  | "INVALID_INPUT";

/** An expected, user-facing failure with a machine-readable code. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
