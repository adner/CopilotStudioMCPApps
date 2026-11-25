/**
 * Background UI generation with OpenAI.
 *
 * create_ui starts a job and returns at once (Copilot Studio cancels tool
 * calls after 120 s); the app polls get_ui_progress for the streamed
 * generateSandboxedUi arguments.
 */
import OpenAI from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATE_SANDBOXED_UI_DESCRIPTION, GENERATE_SANDBOXED_UI_PARAMETERS } from "./copilotkit-contract.js";
import { INSTRUCTIONS } from "./prompt.js";

const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GENERATED_DIR = path.join(ROOT_DIR, "generated");

export type JobStatus = "thinking" | "streaming" | "done" | "error";

export interface Job {
  id: string;
  request: string;
  /** uiId of the UI this one modifies (create_ui with uiId). */
  basedOn?: string;
  model: string;
  status: JobStatus;
  /** Raw streamed JSON arguments of the generateSandboxedUi call. */
  raw: string;
  startedAt: number;
  firstDeltaAt?: number;
  /** When css was complete (the "html" field started): the preview can appear from here. */
  cssDoneAt?: number;
  finishedAt?: number;
  error?: string;
  usage?: unknown;
}

const jobs = new Map<string, Job>();
let client: OpenAI | undefined;

const safeId = (id: string) => id.replace(/[^a-z0-9]/gi, "");

/** In-memory job, else the saved file in generated/ (survives restarts). */
export async function loadJob(id: string): Promise<Job | undefined> {
  const mem = jobs.get(id);
  if (mem) return mem;
  try {
    const job = JSON.parse(await fs.readFile(path.join(GENERATED_DIR, `${safeId(id)}.json`), "utf-8")) as Job;
    jobs.set(job.id, job);
    return job;
  } catch {
    return undefined;
  }
}

export async function listJobs(limit: number) {
  let files: string[] = [];
  try {
    files = (await fs.readdir(GENERATED_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    /* none yet */
  }
  const all = await Promise.all(files.map((f) => loadJob(f.replace(/\.json$/, ""))));
  for (const j of jobs.values()) if (!all.some((a) => a?.id === j.id)) all.push(j);
  return all
    .filter((j): j is Job => !!j)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit)
    .map((j) => ({ id: j.id, request: j.request, status: j.status, startedAt: j.startedAt, basedOn: j.basedOn ?? null }));
}

export async function startJob(request: string, baseUiId?: string): Promise<Job> {
  const base = baseUiId ? await loadJob(baseUiId) : undefined;
  const id = Math.random().toString(36).slice(2, 8);
  const job: Job = {
    id,
    request,
    basedOn: base?.status === "done" ? base.id : undefined,
    model: process.env.OPENAI_MODEL ?? "gpt-6.2-sol",
    status: "thinking",
    raw: "",
    startedAt: Date.now(),
  };
  jobs.set(id, job);
  void run(job, job.basedOn ? base : undefined);
  return job;
}

async function run(job: Job, base?: Job) {
  console.log(
    `[genui] ${job.id} start model=${job.model}${job.basedOn ? ` basedOn=${job.basedOn}` : ""} request=${JSON.stringify(job.request)}`,
  );
  // A change request gets the current UI and returns a complete updated one.
  const input = base
    ? `Here is the current UI, as the arguments of its generateSandboxedUi call:\n${base.raw}\n\n` +
      `Apply this change and return the complete updated UI (keep everything else that works): ${job.request}`
    : job.request;
  try {
    client ??= new OpenAI();
    const stream = await client.responses.create({
      model: job.model,
      instructions: INSTRUCTIONS,
      input,
      reasoning: { effort: (process.env.OPENAI_REASONING_EFFORT as "medium") ?? "medium" },
      tools: [
        {
          type: "function",
          name: "generateSandboxedUi",
          description: GENERATE_SANDBOXED_UI_DESCRIPTION,
          parameters: GENERATE_SANDBOXED_UI_PARAMETERS as unknown as Record<string, unknown>,
          strict: true,
        },
      ],
      tool_choice: { type: "function", name: "generateSandboxedUi" },
      stream: true,
    });
    for await (const event of stream) {
      if (event.type === "response.function_call_arguments.delta") {
        if (!job.firstDeltaAt) {
          job.firstDeltaAt = Date.now();
          job.status = "streaming";
        }
        job.raw += event.delta;
        if (!job.cssDoneAt && job.raw.includes('"html":')) job.cssDoneAt = Date.now();
      } else if (event.type === "response.completed") {
        job.usage = event.response.usage;
      } else if (event.type === "response.failed" || event.type === "error") {
        throw new Error(JSON.stringify("response" in event ? event.response.error : event));
      }
    }
    job.status = "done";
  } catch (e) {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
  }
  job.finishedAt = Date.now();
  const secs = (ms?: number) => (ms ? ((ms - job.startedAt) / 1000).toFixed(1) : "-");
  console.log(
    `[genui] ${job.id} ${job.status} total=${secs(job.finishedAt)}s firstDelta=${secs(job.firstDeltaAt)}s cssDone=${secs(job.cssDoneAt)}s ` +
      `chars=${job.raw.length} usage=${JSON.stringify(job.usage ?? null)}${job.error ? ` error=${job.error}` : ""}`,
  );
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  await fs.writeFile(path.join(GENERATED_DIR, `${job.id}.json`), JSON.stringify(job, null, 2));
}
