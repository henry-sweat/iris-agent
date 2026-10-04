import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { dateIn } from "./dates";
import { goals as seedGoals, tasks as seedTasks } from "./seed";
import { type Occurrence, occurrenceId, StoreData, type Task } from "./types";

export type Store = {
  /** Snapshot of the current data; never mutate it. */
  read(): Promise<StoreData>;
  /**
   * Serialized read-modify-write. `fn` may mutate the draft in place; it is written back
   * only when `fn` reports a change, so pure reads stay cheap.
   */
  mutate<T>(fn: (draft: StoreData) => { changed: boolean; result: T }): Promise<T>;
};

const EMPTY: StoreData = { version: 2, goals: [], tasks: [], occurrences: [] };

// One queue per file per process. Kept on globalThis so HMR or separate route bundles
// can't create a second queue writing the same file.
const queues: Map<string, Promise<unknown>> = ((globalThis as { __todoStoreQueues?: Map<string, Promise<unknown>> })
  .__todoStoreQueues ??= new Map());

export function createStore(file: string, timeZone: string): Store {
  async function load(): Promise<StoreData> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(EMPTY);
      throw error;
    }
    if (Array.isArray(raw)) {
      const migrated = migrateV1(raw, timeZone);
      await save(migrated);
      return migrated;
    }
    return StoreData.parse(raw);
  }

  async function save(data: StoreData): Promise<void> {
    // The data directory is gitignored, so it may not exist yet on a fresh clone.
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
    await rename(tmp, file);
  }

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = (queues.get(file) ?? Promise.resolve()).then(job);
    queues.set(
      file,
      run.catch(() => {}),
    );
    return run;
  }

  return {
    read: () => enqueue(load),
    mutate: (fn) =>
      enqueue(async () => {
        const draft = await load();
        const { changed, result } = fn(draft);
        if (changed) await save(draft);
        return result;
      }),
  };
}

// ── v1 → v2 migration ────────────────────────────────────────────────────────

const V1Todo = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(["open", "in_progress", "blocked", "done"]),
  status_note: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

/**
 * v1 was a flat array of todos. Each becomes an unaligned ad hoc task with one occurrence on
 * its creation date (done stays done; open/in_progress/blocked become pending), and the seed
 * goals and tasks are added.
 */
export function migrateV1(raw: unknown[], timeZone: string): StoreData {
  const todos = z.array(V1Todo).parse(raw);
  const tasks: Task[] = [];
  const occurrences: Occurrence[] = [];
  for (const todo of todos) {
    const startDate = dateIn(timeZone, todo.created_at);
    tasks.push({
      id: todo.id,
      title: todo.description,
      goalIds: [],
      startDate,
      missPolicy: "carry",
      active: true,
      createdAt: new Date(todo.created_at).toISOString(),
      updatedAt: new Date(todo.updated_at).toISOString(),
    });
    const done = todo.status === "done";
    occurrences.push({
      id: occurrenceId(todo.id, startDate),
      taskId: todo.id,
      scheduledFor: startDate,
      status: done ? "done" : "pending",
      ...(done ? { completedAt: new Date(todo.updated_at).toISOString() } : {}),
      ...(todo.status_note ? { note: todo.status_note } : {}),
    });
  }
  const taken = new Set(tasks.map((t) => t.id));
  return {
    version: 2,
    goals: structuredClone(seedGoals),
    tasks: [...structuredClone(seedTasks).filter((t) => !taken.has(t.id)), ...tasks],
    occurrences,
  };
}
