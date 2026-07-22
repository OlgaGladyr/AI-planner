// This file runs only on Vercel's servers — never in the visitor's browser.
// Your ANTHROPIC_API_KEY is read from Vercel's private environment variables
// (Project Settings → Environment Variables), so it's never exposed to anyone
// visiting the site.
//
// This uses Claude's "tool use" feature (also called function calling):
// instead of just asking Claude to reply with JSON and hoping it listens
// exactly, we hand it a strict form (the "tool" below) and require it to
// fill that out. This is a stronger guarantee of getting back exactly the
// shape of data our app expects, every time.

const PARSE_TOOL = {
  name: "record_parsed_thoughts",
  description:
    "Records structured scheduling data extracted from a list of short, casually-written personal to-do thoughts.",
  input_schema: {
    type: "object",
    properties: {
      thoughts: {
        type: "array",
        description: "One entry per input thought, in the exact same order they were given.",
        items: {
          type: "object",
          properties: {
            date: {
              type: ["string", "null"],
              description:
                "The specific calendar date the thought refers to, as YYYY-MM-DD, resolved relative to today's date. Null if no day is stated or clearly implied.",
            },
            time: {
              type: ["string", "null"],
              description:
                "A specific clock time in 24-hour HH:MM format, only if one is stated or clearly implied (e.g. 'lunchtime' -> 12:00). Null otherwise.",
            },
            duration_minutes: {
              type: ["number", "null"],
              description: "Only set if a duration is explicitly stated (e.g. 'for an hour' -> 60). Null otherwise.",
            },
            priority: {
              type: "string",
              enum: ["high", "med", "low"],
              description:
                "'high' for urgent/ASAP/important language, 'low' for vague/someday language ('maybe', 'sometime', 'someday'), otherwise 'med'.",
            },
          },
          required: ["date", "time", "duration_minutes", "priority"],
        },
      },
    },
    required: ["thoughts"],
  },
};

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

  const { thoughts, referenceDate } = req.body || {};
  if (!Array.isArray(thoughts) || thoughts.length === 0) {
    res.status(400).json({ error: "Expected a non-empty 'thoughts' array of strings." });
    return;
  }

  const today = referenceDate || new Date().toISOString().slice(0, 10);
  const system = `You extract scheduling data from short, casually written personal to-do thoughts. Today's date is ${today} (YYYY-MM-DD, this year is real). You will receive a numbered list of thoughts. Call the record_parsed_thoughts tool exactly once, with one entry per thought, in the same order they were given.`;

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
        max_tokens: 1024,
        temperature: 0,
        system,
        tools: [PARSE_TOOL],
        tool_choice: { type: "tool", name: "record_parsed_thoughts" }, // force this exact tool call
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
    const toolUse = (data.content || []).find((block) => block.type === "tool_use" && block.name === "record_parsed_thoughts");

    if (!toolUse || !Array.isArray(toolUse.input?.thoughts)) {
      res.status(502).json({ error: "Model did not return the expected structured data.", raw: data });
      return;
    }

    const parsed = toolUse.input.thoughts;
    if (parsed.length !== thoughts.length) {
      res.status(502).json({ error: "Response count did not match the request.", raw: parsed });
      return;
    }

    const results = parsed.map((p) => ({
      date: typeof p?.date === "string" ? p.date : null,
      time: typeof p?.time === "string" ? p.time : null,
      duration: typeof p?.duration_minutes === "number" ? p.duration_minutes : null,
      priority: ["high", "med", "low"].includes(p?.priority) ? p.priority : "med",
    }));

    res.status(200).json({ results });
  } catch (err) {
    res.status(500).json({ error: "Request to Anthropic failed", detail: String(err) });
  }
}
