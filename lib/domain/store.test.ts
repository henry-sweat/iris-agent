import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { goals as seedGoals, tasks as seedTasks } from "./seed";
import { createStore } from "./store";

describe("v1 → v2 migration", () => {
  it("turns todos into ad hoc tasks with one occurrence each and adds the seed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "todo-agent-"));
    const file = path.join(dir, "todo.json");
    const created = Date.parse("2026-09-28T02:00:00Z"); // Sep 27, 10pm in New York
    const updated = Date.parse("2026-09-29T15:00:00Z");
    await writeFile(
      file,
      JSON.stringify([
        { id: "call-reed", description: "Call Reed", status: "blocked", status_note: "Out of town", created_at: created, updated_at: updated },
        { id: "chili", description: "Make chili", status: "done", status_note: null, created_at: created, updated_at: updated },
      ]),
    );

    const data = await createStore(file, "America/New_York").read();
    expect(data.goals).toEqual(seedGoals);
    expect(data.tasks).toHaveLength(seedTasks.length + 2);
    expect(data.tasks.find((t) => t.id === "call-reed")).toMatchObject({
      title: "Call Reed",
      goalIds: [],
      startDate: "2026-09-27",
      missPolicy: "carry",
      active: true,
    });
    expect(data.occurrences).toEqual([
      { id: "call-reed@2026-09-27", taskId: "call-reed", scheduledFor: "2026-09-27", status: "pending", note: "Out of town" },
      {
        id: "chili@2026-09-27",
        taskId: "chili",
        scheduledFor: "2026-09-27",
        status: "done",
        completedAt: "2026-09-29T15:00:00.000Z",
      },
    ]);
    // Written back as v2.
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(2);
  });
});

describe("missing data file", () => {
  it("creates the parent directory and file on the first write", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "todo-agent-"));
    const file = path.join(dir, "nested", "data", "todo.json");
    const store = createStore(file, "America/New_York");

    expect(await store.read()).toEqual({ version: 2, goals: [], tasks: [], occurrences: [] });
    await store.mutate(() => ({ changed: true, result: undefined }));
    expect(JSON.parse(await readFile(file, "utf8")).version).toBe(2);
  });
});
