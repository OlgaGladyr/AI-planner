// This file runs only on Vercel's servers — never in the visitor's browser.
// Your ANTHROPIC_API_KEY is read from Vercel's private environment variables
// (Project Settings → Environment Variables), so it's never exposed to anyone
// visiting the site.
//
// Uses Claude's "tool use" feature (function calling): instead of asking
// Claude to reply with JSON and hoping it listens exactly, we hand it a
// strict form (the "tool" below) and require it to fill that out.
//
// This does three jobs at once:
//  1. SPLITTING — a raw note may bundle several distinct plans together
//     (typed without pressing Enter between them, or spoken in one breath
//     with no line breaks at all). Each distinct plan becomes its own entry.
//  2. SEQUENCING — when one plan's time is only implied by another
//     ("breakfast at 8 for 30 min, then clean the room"), the model works
//     out the implied start time from what came before, and can work out a
//     duration from a stated end boundary ("...until lunch at 12:30").
//  3. MATCHING — given a short list of what's already on the schedule, the
//     model can recognize when a note is actually editing or cancelling an
//     existing plan ("actually move my 9am call to 10") rather than
//     creating a brand new, contradictory one.

const MAX_TOTAL_CHARS = 6000; // defense in depth — the app also caps a single dictation/typing chunk client-side at 2,000

const PARSE_TOOL = {
  name: "record_parsed_tasks",
  description:
    "Records structured to-do tasks extracted from a person's raw braindump notes, including whether each is a new plan, an edit to an existing one, or a cancellation.",
  input_schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "One entry per distinct, actionable plan found across all the raw notes — may be more or fewer entries than raw notes given.",
        items: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["create", "update", "delete"],
              description:
                "'create' for a brand new plan. 'update' if this note clearly changes something already on the schedule (matched via task_id). 'delete' if this note clearly cancels/removes something already on the schedule (matched via task_id). Default to 'create' unless there is a confident match.",
            },
            task_id: {
              type: ["string", "null"],
              description: "The id of the matching existing scheduled task, from the list provided. Required (non-null) for 'update' and 'delete'. Null for 'create'.",
            },
            text: {
              type: "string",
              description: "A short, clean description of just this one task (e.g. 'Call the dentist'), not the whole original sentence if it contained multiple plans. For 'update', this is the task's resulting description (may be unchanged from before).",
            },
            date: {
              type: ["string", "null"],
              description:
                "The specific calendar date this task refers to, as YYYY-MM-DD, resolved relative to today's date. Null if no day is stated or clearly implied.",
            },
            time: {
              type: ["string", "null"],
              description:
                "A specific clock time in 24-hour HH:MM format. Set this if stated directly, clearly implied (e.g. 'lunchtime' -> 12:00), OR implied by sequence — if this plan is described as happening after another plan in the same note (words like 'then', 'after that', 'next', 'followed by', or simply listed right after another timed plan), set this to that prior plan's start time plus its duration. Null only if there is truly no way to infer a time.",
            },
            duration_minutes: {
              type: ["number", "null"],
              description:
                "Set this if a duration is explicitly stated (e.g. 'for an hour' -> 60), OR if an explicit end boundary is given (e.g. 'work on the deck until lunch at 12:30' with a 10:30 start -> 120). Null otherwise.",
            },
            priority: {
              type: "string",
              enum: ["high", "med", "low"],
              description:
                "'high' for urgent/ASAP/important language, 'low' for vague/someday language ('maybe', 'sometime', 'someday'), otherwise 'med'.",
            },
          },
          required: ["action", "task_id", "text", "date", "time", "duration_minutes", "priority"],
        },
      },
    },
    required: ["tasks"],
  },
};

function buildSystemPrompt(today, existingTasks) {
  const scheduleBlock = existingTasks.length
    ? existingTasks.map((t) => `- id: ${t.id} | "${t.text}" | ${t.date}${t.time ? " at " + t.time : ""}`).join("\n")
    : "(nothing currently scheduled)";

  return `You read a person's raw, casually written braindump notes and turn them into a clean list of separate, actionable to-do tasks. Today's date is ${today} (YYYY-MM-DD, this year is real). The notes may be written in any language (this app's interface is in Ukrainian, so Ukrainian is common) — always write each task's "text" in the SAME language the person used, never translate it into a different language.

You will receive a numbered list of raw notes. Three things to handle carefully:

1. SPLITTING: a single raw note may contain more than one distinct plan bundled together — joined by "and", separated by commas, or simply run one after another with no separator at all (common with dictated speech, which has no line breaks). Split any such note into multiple separate task entries, one per distinct actionable plan. Do not merge multiple distinct plans into one task, and do not split a single plan into more than one task.

2. SEQUENCING: when a plan's timing depends on another plan mentioned just before it in the same note (e.g. "eat breakfast at 8 for 30 minutes, then clean my room" — the cleaning has no stated time, but clearly starts right after breakfast ends, i.e. 8:30), work out that implied start time yourself rather than leaving it blank. Likewise, if a plan gives an explicit end boundary instead of a duration (e.g. "work on the presentation until lunch at 12:30"), compute duration_minutes from the gap between its start and that end time.

3. MATCHING EXISTING PLANS: here is what the person already has on their schedule —
${scheduleBlock}
If a note clearly refers to changing or cancelling one of these (phrases like "actually", "instead", "move X to Y", "cancel the dentist thing", "delete that meeting", "push my Y back"), output that as action "update" or "delete" with the matching task_id from the list above. Only do this when the match is clear and confident — if a note is at all ambiguous about which existing item (or none) it refers to, default to "create" instead of guessing.

Call the record_parsed_tasks tool exactly once with the full resulting list of tasks.`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: "Server is missing ANTHROPIC_API_KEY. Add it in Vercel → Project Settings → Environment Variables, then redeploy.",
    });
    return;
  }

  const { thoughts, referenceDate, existingTasks } = req.body || {};
  if (!Array.isArray(thoughts) || thoughts.length === 0) {
    res.status(400).json({ error: "Expected a non-empty 'thoughts' array of strings." });
    return;
  }
  const totalChars = thoughts.reduce((sum, t) => sum + String(t || "").length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    res.status(400).json({ error: `That's too much text in one go (limit ~${MAX_TOTAL_CHARS} characters) — try sending it in smaller chunks.` });
    return;
  }

  const today = referenceDate || new Date().toISOString().slice(0, 10);
  const safeExistingTasks = Array.isArray(existingTasks)
    ? existingTasks
        .filter((t) => t && typeof t.id === "string" && typeof t.text === "string")
        .slice(0, 200) // keep the context list bounded
        .map((t) => ({ id: t.id, text: t.text, date: typeof t.date === "string" ? t.date : null, time: typeof t.time === "string" ? t.time : null }))
    : [];
  const knownIds = new Set(safeExistingTasks.map((t) => t.id));

  const system = buildSystemPrompt(today, safeExistingTasks);

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1536,
        temperature: 0,
        system,
        tools: [PARSE_TOOL],
        tool_choice: { type: "tool", name: "record_parsed_tasks" }, // force this exact tool call
        messages: [
          {
            role: "user",
            content: thoughts.map((t, i) => `${i + 1}. ${t}`).join("\n"),
          },
        ],
      }),
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text();
      res.status(anthropicRes.status).json({ error: "Anthropic API error", detail });
      return;
    }

    const data = await anthropicRes.json();
    const toolUse = (data.content || []).find((block) => block.type === "tool_use" && block.name === "record_parsed_tasks");

    if (!toolUse || !Array.isArray(toolUse.input?.tasks) || toolUse.input.tasks.length === 0) {
      res.status(502).json({ error: "Model did not return the expected structured data.", raw: data });
      return;
    }

    const results = toolUse.input.tasks.map((p) => {
      const action = ["create", "update", "delete"].includes(p?.action) ? p.action : "create";
      // Defense in depth: only honor an update/delete if it points at an ID we
      // actually sent as existing-schedule context. Anything else quietly
      // becomes a plain "create" instead of risking touching the wrong task.
      const taskIdValid = typeof p?.task_id === "string" && knownIds.has(p.task_id);
      return {
        text: typeof p?.text === "string" && p.text.trim() ? p.text.trim() : "Untitled plan",
        date: typeof p?.date === "string" ? p.date : null,
        time: typeof p?.time === "string" ? p.time : null,
        duration: typeof p?.duration_minutes === "number" ? p.duration_minutes : null,
        priority: ["high", "med", "low"].includes(p?.priority) ? p.priority : "med",
        action: taskIdValid ? action : "create",
        task_id: taskIdValid ? p.task_id : null,
      };
    });

    res.status(200).json({ results });
  } catch (err) {
    res.status(500).json({ error: "Request to Anthropic failed", detail: String(err) });
  }
}
