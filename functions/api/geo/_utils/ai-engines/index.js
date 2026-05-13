// Dispatcher cho 3 AI engine: chatgpt, gemini, meta_ai (Workers AI proxy).

import { queryOpenAI }    from "./openai.js";
import { queryGemini }    from "./gemini.js";
import { queryWorkersAI } from "./workers-ai.js";

export const ENGINES = ["chatgpt", "gemini", "meta_ai"];

export async function queryEngine(engine, query, env) {
  switch (engine) {
    case "chatgpt": return queryOpenAI(query, env);
    case "gemini":  return queryGemini(query, env);
    case "meta_ai": return queryWorkersAI(query, env);
    default: throw new Error(`Unknown engine: ${engine}`);
  }
}

// Chạy song song 3 engine. Engine fail → vẫn trả entry với error.
export async function queryAllEngines(query, env) {
  const results = await Promise.allSettled(
    ENGINES.map(e => queryEngine(e, query, env))
  );

  const map = {};
  for (let i = 0; i < ENGINES.length; i++) {
    const eng = ENGINES[i];
    const r = results[i];
    if (r.status === "fulfilled") {
      map[eng] = r.value;
    } else {
      map[eng] = {
        engine: eng,
        model: "unknown",
        response_text: "",
        citations: [],
        tokens_input: 0,
        tokens_output: 0,
        cost_usd: 0,
        raw_json: null,
        error: r.reason?.message || String(r.reason),
      };
    }
  }
  return map;
}
