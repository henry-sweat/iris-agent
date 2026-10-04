import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createServices } from "@/lib/domain/service";
import { createStore } from "@/lib/domain/store";
import { createTodoTools, MUTATING_TOOLS } from "./tools";

async function tools() {
  const file = path.join(await mkdtemp(path.join(tmpdir(), "todo-agent-")), "todo.json");
  await writeFile(file, JSON.stringify({ version: 2, goals: [], tasks: [], occurrences: [] }));
  return createTodoTools(createServices({ store: createStore(file, "America/New_York"), timeZone: "America/New_York" }));
}

describe("agent tools", () => {
  it("expose no way to insert occurrences directly", async () => {
    const names = (await tools()).map((t) => t.name);
    expect(names.filter((n) => /occurrence/i.test(n)).sort()).toEqual([
      "completeOccurrence",
      "reopenOccurrence",
      "skipOccurrence",
    ]);
    expect(names.some((n) => /ensure|insert|generate/i.test(n))).toBe(false);
    for (const name of MUTATING_TOOLS) expect(names).toContain(name);
  });

  it("return a machine-readable error code", async () => {
    const createTask = (await tools()).find((t) => t.name === "createTask")!;
    // The tool list is heterogeneous, so its handler args are an intersection; cast for the test.
    const result = await (createTask.handler as (args: unknown, extra: unknown) => ReturnType<typeof createTask.handler>)(
      { title: "x", rrule: "FREQ=NOPE" },
      undefined,
    );
    expect(result.isError).toBe(true);
    const text = result.content[0].type === "text" ? result.content[0].text : "";
    expect(JSON.parse(text)).toMatchObject({ code: "INVALID_RRULE" });
  });
});
