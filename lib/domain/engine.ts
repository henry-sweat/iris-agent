import { expandRule } from "./recurrence";
import { type ISODate, occurrenceId, type StoreData } from "./types";

// Deterministic occurrence generation. Only code calls these; no agent tool inserts occurrences.

/**
 * Inserts any missing pending occurrences of active recurring tasks in [from, to].
 * Idempotent: occurrence ids are `${taskId}@${date}`, so existing rows are never duplicated
 * or touched. Returns the number of rows inserted.
 */
export function ensureOccurrences(draft: StoreData, from: ISODate, to: ISODate): number {
  const existing = new Set(draft.occurrences.map((o) => o.id));
  let inserted = 0;
  for (const task of draft.tasks) {
    if (!task.active || !task.rrule) continue;
    for (const date of expandRule(task.rrule, task.startDate, from, to)) {
      const id = occurrenceId(task.id, date);
      if (existing.has(id)) continue;
      existing.add(id);
      draft.occurrences.push({ id, taskId: task.id, scheduledFor: date, status: "pending" });
      inserted += 1;
    }
  }
  return inserted;
}

/**
 * Past pending occurrences of `skip` tasks become skipped; `carry` ones stay pending (overdue).
 * Returns the number of rows changed.
 */
export function resolveMisses(draft: StoreData, today: ISODate): number {
  const skipTasks = new Set(draft.tasks.filter((t) => t.missPolicy === "skip").map((t) => t.id));
  let changed = 0;
  for (const occurrence of draft.occurrences) {
    if (occurrence.status === "pending" && occurrence.scheduledFor < today && skipTasks.has(occurrence.taskId)) {
      occurrence.status = "skipped";
      changed += 1;
    }
  }
  return changed;
}
