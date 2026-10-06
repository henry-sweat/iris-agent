import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AppointmentCalendar } from "@/lib/calendar/appointments";
import { addDays } from "./dates";
import { createServices } from "./service";
import { createStore } from "./store";
import { DomainError, type Goal, type StoreData, type Task } from "./types";

const TZ = "America/New_York";
const STAMP = "2026-10-01T12:00:00-04:00";

async function setup(today: string, data: Partial<StoreData> = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "todo-agent-"));
  const file = path.join(dir, "todo.json");
  await writeFile(file, JSON.stringify({ version: 2, goals: [], tasks: [], occurrences: [], ...data }));
  const clock = { today };
  const store = createStore(file, TZ);
  // Noon in New York on clock.today.
  const services = createServices({ store, timeZone: TZ, now: () => new Date(`${clock.today}T16:00:00Z`) });
  return { services, store, file, clock };
}

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    goalIds: [],
    startDate: "2026-10-01",
    missPolicy: "carry",
    active: true,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...fields,
  };
}

function goal(id: string, fields: Partial<Goal> = {}): Goal {
  return { id, pillar: "health", title: id, status: "active", createdAt: STAMP, updatedAt: STAMP, ...fields };
}

const datesOf = (items: { taskId: string; scheduledFor: string }[], taskId: string) =>
  items.filter((i) => i.taskId === taskId).map((i) => i.scheduledFor);

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e) => e instanceof DomainError && e.code === code);
}

describe("getAgenda / ensureOccurrences", () => {
  it("generates 7 daily occurrences over 7 days, and none on a repeat call", async () => {
    const { services, store } = await setup("2026-10-01", { tasks: [task("daily", { rrule: "FREQ=DAILY" })] });
    const first = await services.getAgenda("2026-10-01", "2026-10-07");
    expect(first.items).toHaveLength(7);
    await services.getAgenda("2026-10-01", "2026-10-07");
    expect((await store.read()).occurrences).toHaveLength(7);
  });

  it.each([
    [
      "FREQ=WEEKLY;BYDAY=MO,WE",
      (d: Date) => d.getUTCDay() === 1 || d.getUTCDay() === 3,
    ],
    ["FREQ=MONTHLY;BYMONTHDAY=1", (d: Date) => d.getUTCDate() === 1],
    ["FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=15", (d: Date) => d.getUTCMonth() === 2 && d.getUTCDate() === 15],
  ])("expands %s to exactly the expected dates over a year", async (rrule, matches) => {
    const from = "2027-01-01";
    const to = "2027-12-31";
    const { services } = await setup("2027-01-01", { tasks: [task("t", { rrule, startDate: "2026-12-01" })] });
    const expected: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (matches(new Date(`${d}T00:00:00Z`))) expected.push(d);
    const agenda = await services.getAgenda(from, to);
    expect(datesOf(agenda.items, "t")).toEqual(expected);
  });

  it("respects INTERVAL relative to startDate", async () => {
    const { services } = await setup("2026-10-10", {
      tasks: [task("golf", { rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA", startDate: "2026-10-10" })],
    });
    const agenda = await services.getAgenda("2026-10-01", "2026-11-10");
    expect(datesOf(agenda.items, "golf")).toEqual(["2026-10-10", "2026-10-24", "2026-11-07"]);
  });

  it("does not create duplicates under concurrent reads", async () => {
    const { services, store } = await setup("2026-10-01", { tasks: [task("daily", { rrule: "FREQ=DAILY" })] });
    await Promise.all([
      services.getAgenda("2026-10-01", "2026-10-31"),
      services.getAgenda("2026-10-01", "2026-10-31"),
      services.getAgenda("2026-10-15", "2026-11-15"),
    ]);
    const ids = (await store.read()).occurrences.map((o) => o.id);
    expect(ids).toHaveLength(46);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips past pending rows of skip tasks and carries carry tasks as overdue", async () => {
    const { services, clock } = await setup("2026-10-01", {
      tasks: [task("skipper", { rrule: "FREQ=DAILY", missPolicy: "skip" }), task("carrier", { rrule: "FREQ=DAILY" })],
    });
    await services.getAgenda("2026-10-01", "2026-10-01");
    clock.today = "2026-10-02";
    const agenda = await services.getAgenda("2026-10-02", "2026-10-02");
    // Yesterday's carry row is overdue; the skip row is gone from today's view.
    expect(agenda.items.map((i) => [i.occurrenceId, i.status, i.overdue])).toEqual([
      ["carrier@2026-10-01", "pending", true],
      ["skipper@2026-10-02", "pending", false],
      ["carrier@2026-10-02", "pending", false],
    ]);
    const past = await services.getAgenda("2026-10-01", "2026-10-01");
    expect(past.items.find((i) => i.taskId === "skipper")?.status).toBe("skipped");
  });

  it("shows every missed day of a carry task, and none for a future range", async () => {
    const { services, clock } = await setup("2026-10-01", { tasks: [task("carrier", { rrule: "FREQ=DAILY" })] });
    await services.getAgenda("2026-10-01", "2026-10-03");
    clock.today = "2026-10-04";
    const today = await services.getAgenda("2026-10-04", "2026-10-04");
    expect(today.items.filter((i) => i.overdue)).toHaveLength(3);
    const future = await services.getAgenda("2026-10-05", "2026-10-05");
    expect(future.items).toHaveLength(1);
  });

  it("keeps dates stable across the DST change", async () => {
    // US DST ends 2026-11-01 in America/New_York.
    const { services } = await setup("2026-10-30", { tasks: [task("daily", { rrule: "FREQ=DAILY" })] });
    const agenda = await services.getAgenda("2026-10-30", "2026-11-03");
    expect(datesOf(agenda.items, "daily")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
  });

  it("computes today in the configured zone, not UTC", async () => {
    const { store } = await setup("2026-10-01");
    // 11pm in New York on Oct 1 is already Oct 2 in UTC.
    const late = createServices({ store, timeZone: TZ, now: () => new Date("2026-10-02T03:00:00Z") });
    expect(late.today()).toBe("2026-10-01");
  });

  it("rejects ranges over 366 days and inverted ranges", async () => {
    const { services } = await setup("2026-10-01");
    await expectCode(services.getAgenda("2026-01-01", "2027-01-02"), "RANGE_TOO_LARGE");
    await expectCode(services.getAgenda("2026-10-02", "2026-10-01"), "INVALID_DATE");
    await expectCode(services.getAgenda("2026-02-30", "2026-03-01"), "INVALID_DATE");
  });

  it("joins goal titles and derives pillars", async () => {
    const { services } = await setup("2026-10-01", {
      goals: [goal("g-wealth", { pillar: "wealth", title: "Get rich" })],
      tasks: [
        task("aligned", { rrule: "FREQ=DAILY", goalIds: ["g-wealth"], pillar: "health" }),
        task("pillar-only", { rrule: "FREQ=DAILY", pillar: "happiness" }),
        task("loose", { rrule: "FREQ=DAILY" }),
      ],
    });
    const { items } = await services.getAgenda("2026-10-01", "2026-10-01");
    expect(items.map((i) => [i.taskId, i.pillars, i.goals.map((g) => g.title)])).toEqual([
      ["aligned", ["wealth"], ["Get rich"]],
      ["pillar-only", ["happiness"], []],
      ["loose", [], []],
    ]);
  });
});

describe("occurrence status", () => {
  it("completes idempotently, backfills skipped rows, and reopens", async () => {
    const { services, clock } = await setup("2026-10-01", { tasks: [task("daily", { rrule: "FREQ=DAILY" })] });
    await services.getAgenda("2026-10-01", "2026-10-01");
    const id = "daily@2026-10-01";
    const done = await services.completeOccurrence(id, "felt good");
    expect(done).toMatchObject({ status: "done", note: "felt good" });
    clock.today = "2026-10-03";
    const again = await services.completeOccurrence(id);
    expect(again.completedAt).toBe(done.completedAt);

    await services.skipOccurrence(id);
    const backfilled = await services.completeOccurrence(id);
    expect(backfilled.status).toBe("done");

    const reopened = await services.reopenOccurrence(id);
    expect(reopened).toMatchObject({ status: "pending", overdue: true });
    expect(reopened.completedAt).toBeUndefined();
  });

  it("returns NOT_FOUND for unknown occurrences", async () => {
    const { services } = await setup("2026-10-01");
    await expectCode(services.completeOccurrence("nope@2026-10-01"), "NOT_FOUND");
  });
});

describe("tasks", () => {
  it("creates exactly one occurrence for an ad hoc task on dueAt, else startDate", async () => {
    const { services, store } = await setup("2026-10-01");
    const due = await services.createTask({ title: "Call Reed", dueAt: "2026-10-05" });
    const undated = await services.createTask({ title: "Fix dirtbike" });
    expect(due.task).toMatchObject({ id: "task-call-reed", startDate: "2026-10-01", dueAt: "2026-10-05", missPolicy: "carry" });
    expect(due.occurrence?.scheduledFor).toBe("2026-10-05");
    expect(undated.occurrence?.scheduledFor).toBe("2026-10-01");
    expect((await store.read()).occurrences).toHaveLength(2);
    // Reads never add rows for ad hoc tasks.
    await services.getAgenda("2026-10-01", "2026-10-31");
    expect((await store.read()).occurrences).toHaveLength(2);
  });

  it("rejects an invalid rrule with INVALID_RRULE and stores nothing", async () => {
    const { services, file } = await setup("2026-10-01");
    const before = await readFile(file, "utf8");
    for (const rrule of ["FREQ=BOGUS", "BYDAY=MO", "DTSTART:20260101T000000Z\nRRULE:FREQ=DAILY", "FREQ=HOURLY", ""]) {
      await expectCode(services.createTask({ title: "x", rrule }), "INVALID_RRULE");
    }
    expect(await readFile(file, "utf8")).toBe(before);
  });

  it("rejects unknown goals", async () => {
    const { services } = await setup("2026-10-01");
    await expectCode(services.createTask({ title: "x", goalIds: ["missing"] }), "UNKNOWN_GOAL");
  });

  it("changing the rrule removes only future pending rows and regenerates from the new rule", async () => {
    const { services, store, clock } = await setup("2026-10-01", { tasks: [task("t", { rrule: "FREQ=DAILY" })] });
    await services.getAgenda("2026-10-01", "2026-10-14");
    clock.today = "2026-10-05";
    await services.completeOccurrence("t@2026-10-02");
    await services.skipOccurrence("t@2026-10-03");
    // Oct 1 and Oct 4 stay pending (past); Oct 5+ are future pending and get removed.
    const updated = await services.updateTask("t", { rrule: "FREQ=WEEKLY;BYDAY=MO" });
    expect(updated.startDate).toBe("2026-10-05");
    const rows = (await store.read()).occurrences.map((o) => `${o.scheduledFor}:${o.status}`);
    expect(rows).toEqual(["2026-10-01:pending", "2026-10-02:done", "2026-10-03:skipped", "2026-10-04:pending"]);

    const agenda = await services.getAgenda("2026-10-01", "2026-10-14");
    expect(datesOf(agenda.items, "t")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-12"]);
  });

  it("moves an ad hoc task's pending occurrence when its due date changes", async () => {
    const { services, store, clock } = await setup("2026-10-01");
    const { task: t } = await services.createTask({ title: "Fix dirtbike" });
    clock.today = "2026-10-04";
    await services.updateTask(t.id, { dueAt: "2026-10-10" });
    expect((await store.read()).occurrences.map((o) => o.id)).toEqual([`${t.id}@2026-10-10`]);
  });

  it("archiving stops new occurrences and keeps past rows", async () => {
    const { services, store, clock } = await setup("2026-10-01", { tasks: [task("t", { rrule: "FREQ=DAILY" })] });
    await services.getAgenda("2026-10-01", "2026-10-10");
    clock.today = "2026-10-04";
    await services.completeOccurrence("t@2026-10-02");
    const archived = await services.archiveTask("t");
    expect(archived.active).toBe(false);
    await services.getAgenda("2026-10-01", "2026-10-31");
    const rows = (await store.read()).occurrences.map((o) => `${o.scheduledFor}:${o.status}`);
    expect(rows).toEqual(["2026-10-01:pending", "2026-10-02:done", "2026-10-03:pending"]);
  });

  it("lists ad hoc items regardless of date, excluding archived and recurring tasks", async () => {
    const { services } = await setup("2026-10-01", { tasks: [task("daily", { rrule: "FREQ=DAILY" })] });
    await services.getAgenda("2026-10-01", "2026-10-01");
    const later = await services.createTask({ title: "Later", dueAt: "2026-12-01" });
    const dropped = await services.createTask({ title: "Dropped" });
    await services.archiveTask(dropped.task.id);
    const { items } = await services.listAdHocItems();
    expect(items.map((i) => i.occurrenceId)).toEqual([later.occurrence!.id]);
  });

  it("lists unaligned tasks", async () => {
    const { services } = await setup("2026-10-01", {
      tasks: [task("loose"), task("pillar", { pillar: "wealth" }), task("archived", { active: false })],
    });
    expect((await services.listUnalignedTasks()).map((t) => t.id)).toEqual(["loose"]);
  });
});

describe("goals", () => {
  it("enforces same-pillar parents and rejects cycles", async () => {
    const { services } = await setup("2026-10-01", {
      goals: [goal("a"), goal("b", { parentId: "a" }), goal("w", { pillar: "wealth" })],
    });
    await expectCode(services.createGoal({ pillar: "health", title: "c", parentId: "w" }), "GOAL_PILLAR_MISMATCH");
    await expectCode(services.updateGoal("a", { parentId: "b" }), "GOAL_CYCLE");
    await expectCode(services.updateGoal("a", { parentId: "a" }), "GOAL_CYCLE");
    await expectCode(services.updateGoal("a", { pillar: "wealth" }), "GOAL_PILLAR_MISMATCH");
    const child = await services.createGoal({ pillar: "health", title: "Milestone", parentId: "a" });
    expect(child).toMatchObject({ id: "goal-milestone", parentId: "a", status: "active" });
    const listed = await services.listGoals({ pillar: "health" });
    expect(listed.find((g) => g.id === "a")?.childIds).toEqual(["b", "goal-milestone"]);
  });
});

describe("getPillarSummary", () => {
  it("matches a hand-built fixture", async () => {
    const { services } = await setup("2026-10-03", {
      goals: [goal("g-health"), goal("g-wealth", { pillar: "wealth" })],
      tasks: [
        task("lift", { goalIds: ["g-health"] }),
        task("leetcode", { goalIds: ["g-wealth"] }),
        task("dog", { pillar: "happiness" }),
        task("loose"),
      ],
      occurrences: [
        { id: "lift@2026-10-01", taskId: "lift", scheduledFor: "2026-10-01", status: "done" },
        { id: "lift@2026-10-02", taskId: "lift", scheduledFor: "2026-10-02", status: "skipped" },
        { id: "leetcode@2026-10-01", taskId: "leetcode", scheduledFor: "2026-10-01", status: "done" },
        { id: "leetcode@2026-10-02", taskId: "leetcode", scheduledFor: "2026-10-02", status: "done" },
        { id: "dog@2026-10-03", taskId: "dog", scheduledFor: "2026-10-03", status: "pending" },
        { id: "loose@2026-10-02", taskId: "loose", scheduledFor: "2026-10-02", status: "pending" },
        // Outside the range.
        { id: "lift@2026-09-30", taskId: "lift", scheduledFor: "2026-09-30", status: "done" },
      ],
    });
    const summary = await services.getPillarSummary("2026-10-01", "2026-10-03");
    expect(summary.pillars).toEqual({
      health: { done: 1, skipped: 1, pending: 0 },
      wealth: { done: 2, skipped: 0, pending: 0 },
      happiness: { done: 0, skipped: 0, pending: 1 },
    });
    expect(summary.goals).toEqual([
      { goalId: "g-health", title: "g-health", pillar: "health", done: 1, skipped: 1, pending: 0 },
      { goalId: "g-wealth", title: "g-wealth", pillar: "wealth", done: 2, skipped: 0, pending: 0 },
    ]);
    expect(summary.unaligned).toEqual({ done: 0, skipped: 0, pending: 1 });
    expect(summary.unalignedTaskCount).toBe(1);
  });
});

describe("appointments", () => {
  function fakeCalendar() {
    const calls: string[] = [];
    let next = 1;
    let failing = false;
    const calendar: AppointmentCalendar = {
      async upsert({ taskId, title, date, appointment }) {
        if (failing) throw new DomainError("CALENDAR_UNAVAILABLE", "Google Calendar request failed: offline");
        const id = appointment.eventId ?? `evt-${next++}`;
        calls.push(`upsert ${id} ${taskId} ${title} ${date} ${appointment.start}-${appointment.end}`);
        return id;
      },
      async remove(eventId) {
        calls.push(`remove ${eventId}`);
      },
    };
    return { calendar, calls, fail: (value: boolean) => (failing = value) };
  }

  async function setupWithCalendar() {
    const base = await setup("2026-10-05");
    const fake = fakeCalendar();
    const services = createServices({
      store: base.store,
      timeZone: TZ,
      now: () => new Date("2026-10-05T16:00:00Z"),
      calendar: fake.calendar,
    });
    return { ...base, ...fake, services };
  }

  const slot = { start: "15:00", end: "16:00", location: "Main St" };

  it("creates the event and stores its id on the task", async () => {
    const { services, calls } = await setupWithCalendar();
    const { task, calendarError } = await services.createTask({ title: "Dentist", dueAt: "2026-10-07", appointment: slot });
    expect(calendarError).toBeUndefined();
    expect(task.appointment).toEqual({ ...slot, eventId: "evt-1" });
    expect(calls).toEqual(["upsert evt-1 task-dentist Dentist 2026-10-07 15:00-16:00"]);
    const agenda = await services.getAgenda("2026-10-07", "2026-10-07");
    expect(agenda.items[0].appointment).toEqual(slot);
  });

  it("updates the event on rename and reschedule, but not on archive", async () => {
    const { services, calls } = await setupWithCalendar();
    const { task } = await services.createTask({ title: "Dentist", dueAt: "2026-10-07", appointment: slot });
    await services.updateTask(task.id, { dueAt: "2026-10-08" });
    await services.updateTask(task.id, { title: "Dentist cleaning" });
    await services.updateTask(task.id, { appointment: { start: "09:00", end: "09:30" } });
    const archived = await services.archiveTask(task.id);
    expect(archived.appointment).toEqual({ start: "09:00", end: "09:30", eventId: "evt-1" });
    expect(calls).toEqual([
      "upsert evt-1 task-dentist Dentist 2026-10-07 15:00-16:00",
      "upsert evt-1 task-dentist Dentist 2026-10-08 15:00-16:00",
      "upsert evt-1 task-dentist Dentist cleaning 2026-10-08 15:00-16:00",
      "upsert evt-1 task-dentist Dentist cleaning 2026-10-08 09:00-09:30",
    ]);
  });

  it("deletes the event when the appointment is cleared", async () => {
    const { services, calls } = await setupWithCalendar();
    const { task } = await services.createTask({ title: "Dentist", dueAt: "2026-10-07", appointment: slot });
    const updated = await services.updateTask(task.id, { appointment: null });
    expect(updated.appointment).toBeUndefined();
    expect(calls.at(-1)).toBe("remove evt-1");
  });

  it("keeps the task when the calendar fails, and retries on the next update", async () => {
    const { services, calls, fail } = await setupWithCalendar();
    fail(true);
    const created = await services.createTask({ title: "Dentist", dueAt: "2026-10-07", appointment: slot });
    expect(created.calendarError).toMatch(/offline.*retry/);
    expect(created.task.appointment?.eventId).toBeUndefined();
    fail(false);
    const retried = await services.updateTask(created.task.id, {});
    expect(retried.calendarError).toBeUndefined();
    expect(retried.appointment?.eventId).toBe("evt-1");
    expect(calls).toHaveLength(1);
  });

  it("rejects appointments that aren't a same-day slot on a dated ad hoc task", async () => {
    const { services } = await setupWithCalendar();
    const code = (p: Promise<unknown>) => p.then(() => "ok", (e: DomainError) => e.code);
    expect(await code(services.createTask({ title: "x", appointment: slot }))).toBe("INVALID_INPUT");
    expect(await code(services.createTask({ title: "x", rrule: "FREQ=DAILY", appointment: slot }))).toBe("INVALID_INPUT");
    expect(await code(services.createTask({ title: "x", dueAt: "2026-10-07", appointment: { start: "10:00", end: "09:00" } })))
      .toBe("INVALID_INPUT");
    expect(await code(services.createTask({ title: "x", dueAt: "2026-10-07", appointment: { start: "3pm", end: "4pm" } })))
      .toBe("INVALID_INPUT");
    const { task } = await services.createTask({ title: "Dentist", dueAt: "2026-10-07", appointment: slot });
    expect(await code(services.updateTask(task.id, { dueAt: null }))).toBe("INVALID_INPUT");
    expect(await code(services.updateTask(task.id, { rrule: "FREQ=DAILY" }))).toBe("INVALID_INPUT");
  });

  it("are unavailable without a calendar", async () => {
    const { services } = await setup("2026-10-05");
    await expect(services.createTask({ title: "x", dueAt: "2026-10-07", appointment: slot })).rejects.toMatchObject({
      code: "CALENDAR_UNAVAILABLE",
    });
  });
});
