// Smoke test: key + model reachable. Run: node --env-file=.env scripts/openai-smoke.mjs
import OpenAI from "openai";

const client = new OpenAI();
const model = process.env.OPENAI_MODEL ?? "gpt-6.2-sol";
const t0 = Date.now();
const r = await client.responses.create({
  model,
  input: "Reply with exactly: pong",
  reasoning: { effort: "low" },
});
console.log(JSON.stringify({ model: r.model, status: r.status, text: r.output_text, ms: Date.now() - t0, usage: r.usage }));
