import { DATA_FILE, MAX_RANGE_DAYS, TIME_ZONE } from "./config";
import { dateIn, daysBetween, parseDate } from "./dates";
import { ensureOccurrences, resolveMisses } from "./engine";
import { slugify, uniqueId } from "./ids";
import { validateRule } from "./recurrence";
import { createStore, type Store } from "./store";
import {
  DomainError,
  type Goal,
  type GoalStatus,
  type ISODate,
  type MissPolicy,
  type Occurrence,
  type OccurrenceStatus,
  occurrenceId,
  type Pillar,
  PILLARS,
  type StoreData,
  type Task,
} from "./types";

// The one code path behind both the agent tools and the web app's API routes.

export type AgendaItem = {
  occurrenceId: string;
  taskId: string;
  title: string;
  scheduledFor: ISODate;
  status: OccurrenceStatus;
  completedAt?: string;
  note?: string;
  /** Pending and scheduled before today. */
  overdue: boolean;
  recurring: boolean;
  dueAt?: ISODate;
  /** From the task's goals, else its fallback pillar; empty = unaligned. */
  pillars: Pillar[];
  goals: { id: string; title: string; pillar: Pillar }[];
};

export type Agenda = { today: ISODate; from: ISODate; to: ISODate; items: AgendaItem[] };

export type Counts = { done: number; skipped: number; pending: number };

export type PillarSummary = {
  from: ISODate;
  to: ISODate;
  pillars: Record<Pillar, Counts>;
  goals: ({ goalId: string; title: string; pillar: Pillar } & Counts)[];
  /** Occurrences of tasks with no goal and no pillar. */
  unaligned: Counts;
  /** Active tasks with no goal and no pillar. */
  unalignedTaskCount: number;
};

export type GoalListItem = Goal & { childIds: string[]; taskCount: number };

export type CreateTaskInput = {
  title: string;
  rrule?: string;
  startDate?: string;
  dueAt?: string;
  goalIds?: string[];
  pillar?: Pillar;
  missPolicy?: MissPolicy;
};

/** `null` clears an optional field; `undefined` leaves it unchanged. */
export type UpdateTaskInput = {
  title?: string;
  rrule?: string | null;
  startDate?: string;
  dueAt?: string | null;
  goalIds?: string[];
  pillar?: Pillar | null;
  missPolicy?: MissPolicy;
  active?: boolean;
};

export type CreateGoalInput = {
  pillar: Pillar;
  title: string;
  parentId?: string;
  status?: GoalStatus;
  targetDate?: string;
};

export type UpdateGoalInput = {
  pillar?: Pillar;
  title?: string;
  parentId?: string | null;
  status?: GoalStatus;
  targetDate?: string | null;
};

export type ListTasksInput = { active?: boolean; goalId?: string; pillar?: Pillar };

const zeroCounts = (): Counts => ({ done: 0, skipped: 0, pending: 0 });

export function taskPillars(task: Task, goalsById: Map<string, Goal>): Pillar[] {
  const pillars = new Set<Pillar>();
  for (const id of task.goalIds) {
    const goal = goalsById.get(id);
    if (goal) pillars.add(goal.pillar);
  }
  if (pillars.size === 0 && task.pillar) pillars.add(task.pillar);
  return PILLARS.filter((p) => pillars.has(p));
}

const isUnaligned = (task: Task) => task.goalIds.length === 0 && !task.pillar;

function find<T extends { id: string }>(items: T[], id: string, kind: string): T {
  const item = items.find((i) => i.id === id);
  if (!item) throw new DomainError("NOT_FOUND", `No ${kind} with id "${id}"`);
  return item;
}

export function createServices({
  store,
  timeZone,
  now = () => new Date(),
}: {
  store: Store;
  timeZone: string;
  now?: () => Date;
}) {
  const today = () => dateIn(timeZone, now());
  const timestamp = () => now().toISOString();

  function checkRange(from: string, to: string): { from: ISODate; to: ISODate } {
    const range = { from: parseDate(from, "from"), to: parseDate(to, "to") };
    const days = daysBetween(range.from, range.to) + 1;
    if (days < 1) throw new DomainError("INVALID_DATE", "`to` must not be before `from`");
    if (days > MAX_RANGE_DAYS) {
      throw new DomainError("RANGE_TOO_LARGE", `Range is ${days} days; the maximum is ${MAX_RANGE_DAYS}`);
    }
    return range;
  }

  /** The PRD read path: generate missing rows, then resolve misses. Returns whether anything changed. */
  function heal(draft: StoreData, from: ISODate, to: ISODate): boolean {
    const inserted = ensureOccurrences(draft, from, to);
    return inserted + resolveMisses(draft, today()) > 0;
  }

  function itemBuilder(draft: StoreData) {
    const goalsById = new Map(draft.goals.map((g) => [g.id, g]));
    const tasksById = new Map(draft.tasks.map((t) => [t.id, t]));
    const t = today();
    return (o: Occurrence): AgendaItem => {
      const task = tasksById.get(o.taskId)!;
      const goals = task.goalIds.flatMap((id) => {
        const goal = goalsById.get(id);
        return goal ? [{ id: goal.id, title: goal.title, pillar: goal.pillar }] : [];
      });
      return {
        occurrenceId: o.id,
        taskId: task.id,
        title: task.title,
        scheduledFor: o.scheduledFor,
        status: o.status,
        ...(o.completedAt ? { completedAt: o.completedAt } : {}),
        ...(o.note ? { note: o.note } : {}),
        overdue: o.status === "pending" && o.scheduledFor < t,
        recurring: Boolean(task.rrule),
        ...(task.dueAt ? { dueAt: task.dueAt } : {}),
        pillars: taskPillars(task, goalsById),
        goals,
      };
    };
  }

  function checkGoalIds(draft: StoreData, goalIds: string[]) {
    const known = new Set(draft.goals.map((g) => g.id));
    const unknown = goalIds.filter((id) => !known.has(id));
    if (unknown.length > 0) throw new DomainError("UNKNOWN_GOAL", `Unknown goal id(s): ${unknown.join(", ")}`);
  }

  function checkGoalParent(draft: StoreData, goalId: string | undefined, pillar: Pillar, parentId: string | undefined) {
    if (parentId === undefined) return;
    const parent = find(draft.goals, parentId, "parent goal");
    if (parent.pillar !== pillar) {
      throw new DomainError(
        "GOAL_PILLAR_MISMATCH",
        `Parent goal "${parent.id}" is in ${parent.pillar}, but this goal is in ${pillar}`,
      );
    }
    const byId = new Map(draft.goals.map((g) => [g.id, g]));
    for (let cursor: Goal | undefined = parent; cursor; cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined) {
      if (cursor.id === goalId) throw new DomainError("GOAL_CYCLE", `Making "${parentId}" the parent of "${goalId}" creates a cycle`);
    }
  }

  function setOccurrenceStatus(id: string, status: OccurrenceStatus, note: string | undefined): Promise<AgendaItem> {
    return store.mutate((draft) => {
      const occurrence = find(draft.occurrences, id, "occurrence");
      const before = JSON.stringify(occurrence);
      if (status === "done") {
        if (occurrence.status !== "done") occurrence.completedAt = timestamp();
      } else {
        delete occurrence.completedAt;
      }
      occurrence.status = status;
      if (note !== undefined) occurrence.note = note;
      return { changed: JSON.stringify(occurrence) !== before, result: itemBuilder(draft)(occurrence) };
    });
  }

  /**
   * Edits a task. Schedule changes (rrule, startDate, dueAt, active) delete only pending rows
   * from today on (any date for ad hoc tasks, whose single row moves); done/skipped history is
   * never touched. A new rule without a new startDate is anchored at today so it doesn't
   * backfill past days as overdue.
   */
  async function updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
    const rrule = patch.rrule == null ? patch.rrule : validateRule(patch.rrule);
    const startDate = patch.startDate === undefined ? undefined : parseDate(patch.startDate, "startDate");
    const dueAt = patch.dueAt == null ? patch.dueAt : parseDate(patch.dueAt, "dueAt");
    const title = patch.title?.trim();
    if (title === "") throw new DomainError("INVALID_INPUT", "title must not be empty");

    return store.mutate((draft) => {
      const index = draft.tasks.findIndex((t) => t.id === id);
      if (index === -1) throw new DomainError("NOT_FOUND", `No task with id "${id}"`);
      const old = draft.tasks[index];
      if (patch.goalIds) checkGoalIds(draft, patch.goalIds);
      const t = today();

      const next: Task = { ...old, updatedAt: timestamp() };
      if (title !== undefined) next.title = title;
      if (patch.goalIds) next.goalIds = patch.goalIds;
      if (patch.missPolicy) next.missPolicy = patch.missPolicy;
      if (patch.active !== undefined) next.active = patch.active;
      if (patch.pillar === null) delete next.pillar;
      else if (patch.pillar) next.pillar = patch.pillar;
      if (rrule === null) delete next.rrule;
      else if (rrule !== undefined) next.rrule = rrule;
      if (dueAt === null) delete next.dueAt;
      else if (dueAt !== undefined) next.dueAt = dueAt;
      if (next.rrule && next.dueAt) {
        // Converting to recurring drops a stale due date; setting one explicitly is an error.
        if (dueAt) throw new DomainError("INVALID_INPUT", "dueAt is only for ad hoc tasks (no rrule)");
        delete next.dueAt;
      }

      const ruleChanged = (old.rrule ?? null) !== (next.rrule ?? null);
      const reactivated = !old.active && next.active;
      if (startDate !== undefined) next.startDate = startDate;
      else if ((ruleChanged || reactivated) && old.startDate < t) next.startDate = t;

      const scheduleChanged =
        ruleChanged ||
        next.startDate !== old.startDate ||
        (next.dueAt ?? null) !== (old.dueAt ?? null) ||
        next.active !== old.active;

      if (scheduleChanged) {
        const before = draft.occurrences.length;
        draft.occurrences = draft.occurrences.filter(
          (o) => o.taskId !== id || o.status !== "pending" || (old.rrule ? o.scheduledFor < t : false),
        );
        const removedPending = draft.occurrences.length < before;
        if (!next.rrule && next.active && (removedPending || old.rrule || reactivated)) {
          const scheduledFor = next.dueAt ?? next.startDate;
          const oid = occurrenceId(id, scheduledFor);
          if (!draft.occurrences.some((o) => o.id === oid)) {
            draft.occurrences.push({ id: oid, taskId: id, scheduledFor, status: "pending" });
          }
        }
      }

      draft.tasks[index] = next;
      return { changed: true, result: next };
    });
  }

  return {
    today,

    /** Occurrences in [from, to], plus overdue pending rows from before `from` when `from` ≤ today. */
    async getAgenda(from: string, to: string): Promise<Agenda> {
      const range = checkRange(from, to);
      return store.mutate((draft) => {
        const changed = heal(draft, range.from, range.to);
        const t = today();
        const includeOverdue = range.from <= t;
        const taskOrder = new Map(draft.tasks.map((task, i) => [task.id, i]));
        const items = draft.occurrences
          .filter(
            (o) =>
              (o.scheduledFor >= range.from && o.scheduledFor <= range.to) ||
              (includeOverdue && o.status === "pending" && o.scheduledFor < range.from),
          )
          .sort(
            (a, b) =>
              a.scheduledFor.localeCompare(b.scheduledFor) || taskOrder.get(a.taskId)! - taskOrder.get(b.taskId)!,
          )
          .map(itemBuilder(draft));
        return { changed, result: { today: t, ...range, items } };
      });
    },

    /** Marks done and stamps completedAt; idempotent. Works on past and skipped rows (backfill). */
    completeOccurrence: (id: string, note?: string) => setOccurrenceStatus(id, "done", note),
    skipOccurrence: (id: string, note?: string) => setOccurrenceStatus(id, "skipped", note),
    /** Back to pending, e.g. to undo an accidental check-off. */
    reopenOccurrence: (id: string) => setOccurrenceStatus(id, "pending", undefined),

    async createTask(input: CreateTaskInput): Promise<{ task: Task; occurrence?: Occurrence }> {
      const rrule = input.rrule === undefined ? undefined : validateRule(input.rrule);
      const startDate = input.startDate === undefined ? today() : parseDate(input.startDate, "startDate");
      const dueAt = input.dueAt === undefined ? undefined : parseDate(input.dueAt, "dueAt");
      if (rrule && dueAt) throw new DomainError("INVALID_INPUT", "dueAt is only for ad hoc tasks (no rrule)");
      const title = input.title.trim();
      if (!title) throw new DomainError("INVALID_INPUT", "title is required");

      return store.mutate<{ task: Task; occurrence?: Occurrence }>((draft) => {
        const goalIds = input.goalIds ?? [];
        checkGoalIds(draft, goalIds);
        const stamp = timestamp();
        const task: Task = {
          id: uniqueId(`task-${slugify(title)}`, new Set(draft.tasks.map((t) => t.id))),
          title,
          goalIds,
          ...(input.pillar ? { pillar: input.pillar } : {}),
          ...(rrule ? { rrule } : {}),
          startDate,
          ...(dueAt ? { dueAt } : {}),
          missPolicy: input.missPolicy ?? "carry",
          active: true,
          createdAt: stamp,
          updatedAt: stamp,
        };
        draft.tasks.push(task);
        if (rrule) return { changed: true, result: { task } };
        const scheduledFor = dueAt ?? startDate;
        const occurrence: Occurrence = {
          id: occurrenceId(task.id, scheduledFor),
          taskId: task.id,
          scheduledFor,
          status: "pending",
        };
        draft.occurrences.push(occurrence);
        return { changed: true, result: { task, occurrence } };
      });
    },

    updateTask,

    /** Stops new occurrences and removes not-yet-due pending ones; history stays. */
    archiveTask(id: string): Promise<Task> {
      return updateTask(id, { active: false });
    },

    async listTasks({ active, goalId, pillar }: ListTasksInput = {}): Promise<(Task & { pillars: Pillar[] })[]> {
      const data = await store.read();
      const goalsById = new Map(data.goals.map((g) => [g.id, g]));
      return data.tasks
        .map((task) => ({ ...task, pillars: taskPillars(task, goalsById) }))
        .filter(
          (task) =>
            (active === undefined || task.active === active) &&
            (goalId === undefined || task.goalIds.includes(goalId)) &&
            (pillar === undefined || task.pillars.includes(pillar)),
        );
    },

    /** Every occurrence of active ad hoc tasks, whatever its date (they're never generated lazily). */
    async listAdHocItems(): Promise<{ today: ISODate; items: AgendaItem[] }> {
      const data = await store.read();
      const adHoc = new Set(data.tasks.filter((t) => t.active && !t.rrule).map((t) => t.id));
      const toItem = itemBuilder(data);
      return { today: today(), items: data.occurrences.filter((o) => adHoc.has(o.taskId)).map(toItem) };
    },

    async listUnalignedTasks(): Promise<Task[]> {
      const data = await store.read();
      return data.tasks.filter((t) => t.active && isUnaligned(t));
    },

    async createGoal(input: CreateGoalInput): Promise<Goal> {
      const targetDate = input.targetDate === undefined ? undefined : parseDate(input.targetDate, "targetDate");
      const title = input.title.trim();
      if (!title) throw new DomainError("INVALID_INPUT", "title is required");
      return store.mutate((draft) => {
        checkGoalParent(draft, undefined, input.pillar, input.parentId);
        const stamp = timestamp();
        const goal: Goal = {
          id: uniqueId(`goal-${slugify(title)}`, new Set(draft.goals.map((g) => g.id))),
          pillar: input.pillar,
          title,
          ...(input.parentId ? { parentId: input.parentId } : {}),
          status: input.status ?? "active",
          ...(targetDate ? { targetDate } : {}),
          createdAt: stamp,
          updatedAt: stamp,
        };
        draft.goals.push(goal);
        return { changed: true, result: goal };
      });
    },

    /** Pausing or achieving a goal does not affect its tasks; archiving is per task. */
    async updateGoal(id: string, patch: UpdateGoalInput): Promise<Goal> {
      const targetDate = patch.targetDate == null ? patch.targetDate : parseDate(patch.targetDate, "targetDate");
      const title = patch.title?.trim();
      if (title === "") throw new DomainError("INVALID_INPUT", "title must not be empty");
      return store.mutate((draft) => {
        const index = draft.goals.findIndex((g) => g.id === id);
        if (index === -1) throw new DomainError("NOT_FOUND", `No goal with id "${id}"`);
        const next: Goal = { ...draft.goals[index], updatedAt: timestamp() };
        if (title !== undefined) next.title = title;
        if (patch.pillar) next.pillar = patch.pillar;
        if (patch.status) next.status = patch.status;
        if (patch.parentId === null) delete next.parentId;
        else if (patch.parentId !== undefined) next.parentId = patch.parentId;
        if (targetDate === null) delete next.targetDate;
        else if (targetDate !== undefined) next.targetDate = targetDate;

        checkGoalParent(draft, id, next.pillar, next.parentId);
        const strayChild = draft.goals.find((g) => g.parentId === id && g.pillar !== next.pillar);
        if (strayChild) {
          throw new DomainError(
            "GOAL_PILLAR_MISMATCH",
            `Child goal "${strayChild.id}" is in ${strayChild.pillar}; move or re-parent it first`,
          );
        }
        draft.goals[index] = next;
        return { changed: true, result: next };
      });
    },

    async listGoals({ pillar, status }: { pillar?: Pillar; status?: GoalStatus } = {}): Promise<GoalListItem[]> {
      const data = await store.read();
      return data.goals
        .filter((g) => (pillar === undefined || g.pillar === pillar) && (status === undefined || g.status === status))
        .map((g) => ({
          ...g,
          childIds: data.goals.filter((c) => c.parentId === g.id).map((c) => c.id),
          taskCount: data.tasks.filter((t) => t.active && t.goalIds.includes(g.id)).length,
        }));
    },

    /** done/skipped/pending per pillar and per goal over [from, to] (runs the read path first). */
    async getPillarSummary(from: string, to: string): Promise<PillarSummary> {
      const range = checkRange(from, to);
      return store.mutate((draft) => {
        const changed = heal(draft, range.from, range.to);
        const goalsById = new Map(draft.goals.map((g) => [g.id, g]));
        const tasksById = new Map(draft.tasks.map((t) => [t.id, t]));
        const pillars = Object.fromEntries(PILLARS.map((p) => [p, zeroCounts()])) as Record<Pillar, Counts>;
        const goals = new Map(draft.goals.map((g) => [g.id, zeroCounts()]));
        const unaligned = zeroCounts();
        for (const o of draft.occurrences) {
          if (o.scheduledFor < range.from || o.scheduledFor > range.to) continue;
          const task = tasksById.get(o.taskId)!;
          for (const p of taskPillars(task, goalsById)) pillars[p][o.status] += 1;
          for (const g of task.goalIds) {
            const counts = goals.get(g);
            if (counts) counts[o.status] += 1;
          }
          if (isUnaligned(task)) unaligned[o.status] += 1;
        }
        return {
          changed,
          result: {
            ...range,
            pillars,
            goals: draft.goals.map((g) => ({ goalId: g.id, title: g.title, pillar: g.pillar, ...goals.get(g.id)! })),
            unaligned,
            unalignedTaskCount: draft.tasks.filter((t) => t.active && isUnaligned(t)).length,
          },
        };
      });
    },
  };
}

export type Services = ReturnType<typeof createServices>;

/** The app-wide instance used by API routes and agent tools. */
export const services = createServices({ store: createStore(DATA_FILE, TIME_ZONE), timeZone: TIME_ZONE });
