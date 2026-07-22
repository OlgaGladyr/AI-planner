import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  CheckSquare, Calendar, Inbox as InboxIcon, MoreHorizontal, Plus, X, Mic, Send, Square,
  Search, Pencil, Trash2, SkipForward, ChevronRight, Mail, FileText, Bell, Shield, Palette, LogOut,
} from "lucide-react";

/* ----------------------------- design tokens ----------------------------- */

const COLOR = {
  teal: "#0d9488",
  tealDark: "#0f766e",
  tealLight: "#14b8a6",
  rose: "#f43f5e",
  ink: "#111827",
  sub: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  panel: "#f9fafb",
  card: "#ffffff",
};

const PRIORITY = {
  high: { border: "#5eead4", bg: "#f0fdfa", text: "#0f766e", label: "Високий" },
  med: { border: "#ea580c", bg: "#fff7ed", text: "#ea580c", label: "Середній" },
  low: { border: "#e5e7eb", bg: "#f3f4f6", text: "#374151", label: "Низький" },
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif";

/* ------------------------------ date helpers ------------------------------ */

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function pad2(n) { return String(n).padStart(2, "0"); }
function toDateInput(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function dateInputToOffset(dateStr, today) {
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((startOfDay(d) - today) / 86400000);
}
function offsetToDateInput(offset, today) { return toDateInput(addDays(today, offset)); }
function offsetToLabel(offset, today) {
  if (offset === null || offset === undefined) return null;
  if (offset === 0) return "Сьогодні";
  if (offset === 1) return "Завтра";
  if (offset === -1) return "Вчора";
  return addDays(today, offset).toLocaleDateString("uk-UA", { weekday: "short", month: "short", day: "numeric" });
}
function formatTimeShort(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return pad2(h) + ":" + pad2(m);
}
function shiftTime(hhmm, mins) {
  const [h, m] = hhmm.split(":").map(Number);
  let total = (h * 60 + m + mins) % 1440;
  if (total < 0) total += 1440;
  return pad2(Math.floor(total / 60)) + ":" + pad2(total % 60);
}
function nowHHMM() {
  const d = new Date();
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

// Ukrainian plural forms (1 / 2-4 / 5+, with the usual 11-14 exception) — e.g.
// pluralUk(3, "план", "плани", "планів") -> "плани"
function pluralUk(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

/* -------------------------- lightweight NLP parse -------------------------- */
/* Turns a free-typed thought into a best-guess day / time / priority, the   */
/* same way the "Accept plans" step in the design is meant to behave.        */

function parseThought(raw, today) {
  const text = raw.trim();
  const lower = text.toLowerCase();

  let dayOffset = 0;
  const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const weekdayNamesUk = ["неділ[юяі]", "понеділ[окку]+", "вівтор[окку]+", "серед[уиі]", "четвер[гу]*", "п\\'?ятниц[юіь]", "субот[уиі]"];
  if (/\btomorrow\b|\bзавтра\b/.test(lower)) dayOffset = 1;
  else if (/\bnext week\b|наступн(ого|ий) тижн/.test(lower)) dayOffset = 7;
  else if (/\btoday\b|\btonight\b|\bсьогодні\b/.test(lower)) dayOffset = 0;
  else {
    const wd = weekdayNames.findIndex((n) => new RegExp("\\b" + n + "\\b").test(lower));
    const wdUk = weekdayNamesUk.findIndex((n) => new RegExp(n).test(lower));
    const matchedWd = wd !== -1 ? wd : wdUk;
    if (matchedWd !== -1) {
      const todayWd = today.getDay();
      let delta = matchedWd - todayWd;
      if (delta <= 0) delta += 7;
      dayOffset = delta;
    }
  }

  let time = null;
  const m = lower.match(/(\d{1,2})(?::(\d{2}))?\s?(am|pm)/);
  const mUk = lower.match(/[ов]\s?(\d{1,2})(?::(\d{2}))?\s*(?:год|годин)/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2] || "00";
    if (m[3] === "pm" && h < 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    time = pad2(h) + ":" + min;
  } else if (mUk) {
    time = pad2(parseInt(mUk[1], 10)) + ":" + (mUk[2] || "00");
  }

  let priority = "med";
  if (/\basap\b|urgent|important|priority|терміново|важливо|асап|пріоритет/.test(lower)) priority = "high";
  if (/maybe|sometime|someday|whenever|можливо|колись|іноді/.test(lower)) priority = "low";

  const hasDayWord = /\btomorrow\b|\btoday\b|\btonight\b|\bnext week\b|завтра|сьогодні|наступн(ого|ий) тижн/.test(lower) ||
    weekdayNames.some((n) => new RegExp("\\b" + n + "\\b").test(lower)) ||
    weekdayNamesUk.some((n) => new RegExp(n).test(lower));
  const vague = /maybe|sometime|someday|можливо|колись/.test(lower);
  if (vague && !time && !hasDayWord) dayOffset = null;

  // The offline fallback never has enough context to safely match an existing
  // task, so everything it produces is always a fresh "create" — matching an
  // existing item and editing/removing it is only attempted by the real AI path.
  return { text, dayOffset, time, priority, action: "create", taskId: null };
}

const MAX_DRAFT_CHARS = 2000; // a sane cap on one dictation/typing chunk, same spirit as Structured's ~2,000 char cap

/* --------------------- letting the AI see what's already booked --------------------- */
/* A compact summary of existing tasks, sent alongside new notes so the model can   */
/* (a) avoid double-booking, and (b) recognize when a note is actually an edit or   */
/* cancellation of something already on the schedule, rather than a new task.       */

function buildScheduleContext(tasks, today) {
  return tasks
    .filter((t) => t.status === "pending" && t.dayOffset !== null && t.dayOffset >= -7 && t.dayOffset <= 60)
    .map((t) => ({
      id: t.id,
      text: t.text,
      date: offsetToDateInput(t.dayOffset, today),
      time: t.time || null,
    }));
}

/* ------------------------- real parsing via backend ------------------------ */
/* Calls our own /api/parse-thoughts (Vercel serverless function), which asks  */
/* Claude to read each thought properly. Falls back to the local guesser above */
/* if the request fails for any reason (offline, key not configured yet, etc). */

async function parseThoughtsRemote(rawTexts, today, existingTasksContext) {
  const referenceDate = toDateInput(today);
  const response = await fetch("/api/parse-thoughts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ thoughts: rawTexts, referenceDate, existingTasks: existingTasksContext || [] }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  const { results } = await response.json();
  return results.map((r) => ({
    text: r.text,
    dayOffset: r.date ? dateInputToOffset(r.date, today) : null,
    time: r.time || null,
    duration: r.duration || null,
    priority: r.priority || "med",
    action: ["create", "update", "delete"].includes(r.action) ? r.action : "create",
    taskId: r.task_id || null,
  }));
}

/* --------------------------------- persistence -------------------------------- */

const STORAGE_KEY = "ai-planner:tasks:v1";

function loadSavedTasks() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function nextSeqFrom(tasks, prefix) {
  let max = 0;
  tasks.forEach((t) => {
    if (typeof t.id === "string" && t.id.startsWith(prefix)) {
      const n = parseInt(t.id.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  });
  return max + 1;
}

/* --------------------------------- seed data -------------------------------- */

function seedTasks() {
  return [
    { id: "t1", text: "Ранкові нотатки", time: "08:30", duration: null, priority: "low", status: "pending", dayOffset: 0 },
    { id: "t2", text: "Нарада з командою", time: "09:30", duration: 30, priority: "med", status: "pending", dayOffset: 0 },
    { id: "t3", text: "Переглянути PR від Алекса", time: "11:00", duration: null, priority: "med", status: "pending", dayOffset: 0 },
    { id: "t4", text: "Дзвінок клієнту — продовження договору Acme", time: "15:00", duration: 60, priority: "high", status: "pending", dayOffset: 0 },
    { id: "t5", text: "Забрати дітей зі школи", time: "17:30", duration: null, priority: "med", status: "pending", dayOffset: 0 },
    { id: "t6", text: "Переглянути документ із відгуками щодо дизайну", time: null, duration: null, priority: "low", status: "pending", dayOffset: 0 },
    { id: "t7", text: "Прийом у стоматолога", time: "10:00", duration: 60, priority: "med", status: "pending", dayOffset: 1 },
    { id: "t8", text: "Скласти план статті для блогу", time: null, duration: null, priority: "low", status: "pending", dayOffset: 1 },
    { id: "t9", text: "Підготувати документ планування на 3 квартал", time: null, duration: null, priority: "high", status: "pending", dayOffset: 5 },
    { id: "t10", text: "Підібрати новий мікрофон для подкасту", time: null, duration: null, priority: "low", status: "pending", dayOffset: null },
    { id: "t11", text: "Подати звіт про витрати", time: "10:00", duration: null, priority: "med", status: "pending", dayOffset: -1 },
  ];
}

const MOCK_PHRASES = [
  "Подзвонити стоматологу, щоб перенести завтрашню чистку, орієнтовно на 9 ранку",
  "Доробити презентацію для понеділкової наради, це доволі терміново",
  "Купити продукти на тиждень",
  "Тренування о 18:00",
  "Написати Сарі про контракт, якомога швидше",
  "Можливо, колись перефарбувати коридор",
  "Оновити паспорт перед поїздкою наступного тижня",
  "Рефлексія команди сьогодні о 14:30",
];

/* --------------------------------- icons --------------------------------- */

function FlagIcon({ size = 11, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <rect x="4" y="3" width="2" height="18" rx="1" />
      <path d="M6 4h13l-3 4 3 4H6z" />
    </svg>
  );
}

/* -------------------------------- TaskRow --------------------------------- */

function TaskRow({ task, today, allowDayPicker, overdue, justMoved, onSave, onDiscard, onToggleDone, onSkip }) {
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState(task.time || "");
  const [duration, setDuration] = useState(task.duration ? String(task.duration) : "");
  const [priority, setPriority] = useState(task.priority);
  const [date, setDate] = useState(offsetToDateInput(task.dayOffset ?? 0, today));

  const openEdit = () => {
    setTime(task.time || "");
    setDuration(task.duration ? String(task.duration) : "");
    setPriority(task.priority);
    setDate(offsetToDateInput(task.dayOffset ?? 0, today));
    setEditing(true);
  };

  const save = () => {
    onSave({
      ...task,
      time: time || null,
      duration: duration ? Number(duration) : null,
      priority,
      dayOffset: allowDayPicker ? dateInputToOffset(date, today) : task.dayOffset,
    });
    setEditing(false);
  };

  const pri = PRIORITY[task.priority] || PRIORITY.low;
  const done = task.status === "done";
  const skipped = task.status === "skipped";

  return (
    <div
      style={{
        background: COLOR.card,
        borderRadius: 16,
        padding: "12px 14px",
        boxShadow: "0 1px 3px rgba(17,24,39,.06)",
        borderLeft: overdue ? `3px solid ${COLOR.rose}` : "none",
        animation: justMoved ? "om-move-in .55s cubic-bezier(.2,.9,.3,1)" : "none",
        opacity: skipped ? 0.6 : 1,
      }}
    >
      {!editing && (
        <>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <button
              type="button"
              aria-label={done ? "Позначити як невиконане" : "Позначити як виконане"}
              onClick={onToggleDone}
              style={{
                flex: "none", marginTop: 1, width: 20, height: 20, borderRadius: 7, cursor: "pointer",
                border: done ? "none" : `1.5px solid ${COLOR.line}`,
                background: done ? COLOR.teal : "#fff",
                display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
              }}
            >
              {done && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            <span
              onClick={openEdit}
              style={{
                flex: 1, fontSize: 14, lineHeight: 1.4, cursor: "pointer", color: done ? COLOR.faint : COLOR.ink,
                textDecoration: done ? "line-through" : "none",
              }}
            >
              {task.text}
            </span>

            <button
              type="button"
              aria-label="Редагувати"
              onClick={openEdit}
              style={{ border: "none", background: "none", color: COLOR.sub, cursor: "pointer", padding: 4, flex: "none" }}
            >
              <Pencil size={14} />
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, paddingLeft: 30 }}>
            {task.time && <span style={{ fontSize: 11, color: COLOR.sub }}>{formatTimeShort(task.time)}{task.duration ? " – " + formatTimeShort(shiftTime(task.time, task.duration)) : ""}</span>}
            {skipped && <span style={{ fontSize: 11, fontWeight: 700, color: COLOR.faint }}>Пропущено</span>}
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: pri.text }}>
              {pri.label}<FlagIcon color={pri.text} />
            </span>
          </div>
        </>
      )}

      {editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: COLOR.ink }}>{task.text}</div>

          <div style={{ display: "flex", gap: 8 }}>
            {allowDayPicker && (
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>День</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
              </div>
            )}
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Час</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Тривалість</label>
              <select value={duration} onChange={(e) => setDuration(e.target.value)} style={inputStyle}>
                <option value="">Немає</option>
                <option value="15">15 хв</option>
                <option value="30">30 хв</option>
                <option value="45">45 хв</option>
                <option value="60">1 год</option>
                <option value="90">1.5 год</option>
                <option value="120">2 год</option>
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Пріоритет</label>
            <div style={{ display: "flex", gap: 6 }}>
              {["high", "med", "low"].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  style={{
                    flex: 1, padding: "6px 0", borderRadius: 99, cursor: "pointer", fontSize: 11, fontWeight: 600,
                    border: `1px solid ${priority === p ? PRIORITY[p].border : COLOR.line}`,
                    background: priority === p ? PRIORITY[p].bg : "#fff",
                    color: priority === p ? PRIORITY[p].text : "#374151",
                  }}
                >
                  {PRIORITY[p].label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, paddingTop: 10, borderTop: "1px solid #f1f3f5" }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => { setEditing(false); onDiscard(); }} aria-label="Видалити" style={smallGhostBtn}>
                <Trash2 size={14} /> Видалити
              </button>
              {onSkip && (
                <button type="button" onClick={() => { setEditing(false); onSkip(); }} aria-label="Пропустити" style={smallGhostBtn}>
                  <SkipForward size={14} /> Пропустити
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setEditing(false)} style={smallCancelBtn}>Скасувати</button>
              <button type="button" onClick={save} style={smallSaveBtn}>Зберегти</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = { fontSize: 12, fontWeight: 600, color: COLOR.sub, display: "block", marginBottom: 4 };
const inputStyle = { width: "100%", fontSize: 12, border: `1px solid ${COLOR.line}`, borderRadius: 12, padding: "10px 12px", boxSizing: "border-box", color: COLOR.ink, background: "#fff", fontFamily: "inherit" };
const smallGhostBtn = { display: "flex", alignItems: "center", gap: 6, border: `1px solid ${COLOR.line}`, background: "#fff", color: "#dc2626", fontSize: 13, fontWeight: 600, borderRadius: 10, cursor: "pointer", padding: "7px 10px" };
const smallCancelBtn = { fontSize: 12, fontWeight: 600, padding: "7px 12px", border: `1px solid ${COLOR.line}`, borderRadius: 10, background: "#fff", color: "#374151", cursor: "pointer" };
const smallSaveBtn = { fontSize: 12, fontWeight: 600, padding: "7px 14px", border: "none", borderRadius: 10, background: COLOR.teal, color: "#fff", cursor: "pointer" };

/* ------------------------------- ThoughtCard ------------------------------- */

function ThoughtCard({ thought, today, onChange, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(thought.text);
  const [time, setTime] = useState(thought.time || "");
  const [duration, setDuration] = useState(thought.duration ? String(thought.duration) : "");
  const [priority, setPriority] = useState(thought.priority);
  const [date, setDate] = useState(offsetToDateInput(thought.dayOffset ?? 0, today));

  const eff = thought;
  const timeParts = [];
  if (eff.dayOffset !== 0 && eff.dayOffset !== null && eff.dayOffset !== undefined) {
    const lbl = offsetToLabel(eff.dayOffset, today);
    if (lbl) timeParts.push(lbl);
  }
  if (eff.time) timeParts.push(eff.duration ? formatTimeShort(eff.time) + " – " + formatTimeShort(shiftTime(eff.time, eff.duration)) : formatTimeShort(eff.time));
  const timeLabel = timeParts.join(" · ");
  const pri = PRIORITY[eff.priority] || PRIORITY.med;

  const openEdit = () => {
    if (thought.action === "delete") return; // nothing to edit for a removal — just accept or cancel it
    setText(thought.text); setTime(thought.time || ""); setDuration(thought.duration ? String(thought.duration) : "");
    setPriority(thought.priority); setDate(offsetToDateInput(thought.dayOffset ?? 0, today));
    setEditing(true);
  };
  const save = () => {
    onChange({ ...thought, text, time: time || null, duration: duration ? Number(duration) : null, priority, dayOffset: dateInputToOffset(date, today) });
    setEditing(false);
  };

  const ActionBadge = () => {
    if (thought.action === "update") return <span style={badgeStyle("#fef3c7", "#92400e")}>Оновлення{thought.refText ? ` · було: «${thought.refText}»` : ""}</span>;
    if (thought.action === "delete") return <span style={badgeStyle("#fee2e2", "#991b1b")}>Видалення</span>;
    return null;
  };

  if (thought.action === "delete") {
    return (
      <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: "12px 14px", boxShadow: "0 1px 3px rgba(17,24,39,.06)" }}>
        <div style={{ paddingRight: 40 }}>
          <ActionBadge />
          <p style={{ fontSize: 13, lineHeight: 1.4, color: COLOR.ink, margin: "6px 0 0" }}>
            {thought.refText ? `«${thought.refText}» буде видалено.` : "Цей план буде видалено."}
          </p>
        </div>
        <button type="button" aria-label="Скасувати видалення" onClick={onRemove} style={{ ...iconBtn44, position: "absolute", top: 4, right: 6 }}><X size={16} /></button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", background: "#fff", borderRadius: 16, padding: "12px 14px", boxShadow: "0 1px 3px rgba(17,24,39,.06)" }}>
      {editing ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            {thought.action === "update" && <ActionBadge />}
            <label style={{ ...labelStyle, marginTop: thought.action === "update" ? 6 : 0 }}>План</label>
            <textarea
              rows={Math.max(1, text.split("\n").length, Math.ceil(text.length / 38))}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === "Escape") setEditing(false); }}
              autoFocus
              style={{ ...inputStyle, fontSize: 13, resize: "none" }}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}><label style={labelStyle}>День</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></div>
            <div style={{ flex: 1 }}><label style={labelStyle}>Час</label><input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} /></div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Тривалість</label>
              <select value={duration} onChange={(e) => setDuration(e.target.value)} style={inputStyle}>
                <option value="">Немає</option><option value="15">15 хв</option><option value="30">30 хв</option>
                <option value="45">45 хв</option><option value="60">1 год</option><option value="90">1.5 год</option><option value="120">2 год</option>
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Пріоритет</label>
            <div style={{ display: "flex", gap: 6 }}>
              {["high", "med", "low"].map((p) => (
                <button key={p} type="button" onClick={() => setPriority(p)} style={{
                  flex: 1, padding: "6px 0", borderRadius: 99, cursor: "pointer", fontSize: 11, fontWeight: 600,
                  border: `1px solid ${priority === p ? PRIORITY[p].border : COLOR.line}`,
                  background: priority === p ? PRIORITY[p].bg : "#fff",
                  color: priority === p ? PRIORITY[p].text : "#374151",
                }}>{PRIORITY[p].label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, paddingTop: 10, borderTop: "1px solid #f1f3f5" }}>
            <button type="button" onClick={() => { setEditing(false); onRemove(); }} style={smallGhostBtn}><Trash2 size={14} /> Видалити</button>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={() => setEditing(false)} style={smallCancelBtn}>Скасувати</button>
              <button type="button" onClick={save} style={smallSaveBtn}>Зберегти</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div style={{ paddingRight: 78 }}>
            {thought.action === "update" && <ActionBadge />}
            <span onClick={openEdit} style={{ display: "block", fontSize: 13, lineHeight: 1.4, cursor: "pointer", color: COLOR.ink, marginTop: thought.action === "update" ? 4 : 0 }}>{thought.text}</span>
          </div>
          <div style={{ position: "absolute", top: 4, right: 6, display: "flex" }}>
            <button type="button" aria-label="Редагувати" onClick={openEdit} style={iconBtn44}><Pencil size={16} /></button>
            <button type="button" aria-label="Видалити" onClick={onRemove} style={iconBtn44}><X size={16} /></button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
            {timeLabel && <span style={{ fontSize: 11, color: COLOR.sub }}>{timeLabel}</span>}
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: pri.text }}>{pri.label}<FlagIcon color={pri.text} /></span>
          </div>
        </>
      )}
    </div>
  );
}
const badgeStyle = (bg, color) => ({ display: "inline-block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".03em", padding: "3px 8px", borderRadius: 99, background: bg, color });
const iconBtn44 = { border: "none", background: "none", color: "#374151", cursor: "pointer", width: 34, height: 34, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" };

/* --------------------------------- Section header --------------------------------- */
function SectionLabel({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: COLOR.faint, marginBottom: 10 }}>{children}</div>;
}
function EmptyState({ children }) {
  return <p style={{ fontSize: 14, color: COLOR.faint, textAlign: "center", padding: "48px 0" }}>{children}</p>;
}

/* ===================================================================== */
/*                                MAIN APP                               */
/* ===================================================================== */

export default function AIPlanner() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const todayLabel = useMemo(() => new Date().toLocaleDateString("uk-UA", { weekday: "long", month: "short", day: "numeric" }), []);

  const [screen, setScreen] = useState("today");
  const [lastTab, setLastTab] = useState("today");
  const [tasks, setTasks] = useState(() => loadSavedTasks() || seedTasks());

  const [upcomingDay, setUpcomingDay] = useState(null); // null = "all" grouped view
  const [inboxSearch, setInboxSearch] = useState("");
  const [showInboxSearch, setShowInboxSearch] = useState(false);

  const [capturedThoughts, setCapturedThoughts] = useState([]);
  const [textDraft, setTextDraft] = useState("");
  const [committedText, setCommittedText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [isParsing, setIsParsing] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const [replanBanner, setReplanBanner] = useState(null);
  const [replanTaskId, setReplanTaskId] = useState(null);
  const [toast, setToast] = useState(null);
  const [toastAction, setToastAction] = useState(null);
  const [toastActionLabel, setToastActionLabel] = useState("");
  const [justMovedId, setJustMovedId] = useState(null);

  const undoRef = useRef(null);
  const recIntervalRef = useRef(null);
  const recBaseRef = useRef("");
  const recognitionRef = useRef(null);
  const textDraftRef = useRef("");
  const committedTextRef = useRef("");
  const thoughtSeq = useRef(1);
  const taskSeq = useRef(nextSeqFrom(tasks, "t") + nextSeqFrom(tasks, "p"));
  const toastTimeout = useRef(null);
  const undoTimeout = useRef(null);
  const moveTimeout = useRef(null);

  // Real, browser-built-in speech-to-text (Chrome/Edge). No account, key, or
  // extra cost needed — if it's not available (Safari/Firefox), voice input
  // falls back to a short typed-out demo so the flow still works.
  const supportsSpeech = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  // Small helpers that update state AND a same-value ref together, so any
  // code running from an old/async callback (a timer, or a speech-recognition
  // event) always reads the true current value instead of a stale one
  // captured back when that callback was first created.
  const setDraft = (value) => { textDraftRef.current = value; setTextDraft(value); };
  const setCommitted = (value) => { committedTextRef.current = value; setCommittedText(value); };

  useEffect(() => () => {
    clearInterval(recIntervalRef.current);
    clearTimeout(toastTimeout.current);
    clearTimeout(undoTimeout.current);
    clearTimeout(moveTimeout.current);
    if (recognitionRef.current) recognitionRef.current.stop();
  }, []);

  // Remember tasks: every time they change, save them so they're still here
  // next time the app is opened (survives refresh / closing the tab).
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch {
      // storage unavailable (e.g. private browsing) — fail silently, app still works this session
    }
  }, [tasks]);

  const showToast = useCallback((msg, ms = 2600, action = null, actionLabel = "") => {
    clearTimeout(toastTimeout.current);
    setToast(msg); setToastAction(() => action); setToastActionLabel(actionLabel);
    toastTimeout.current = setTimeout(() => setToast(null), ms);
  }, []);

  /* ---------------- navigation ---------------- */
  const goTab = (tab) => { setScreen(tab); setLastTab(tab); };
  const openBraindump = () => setScreen("braindump");
  const closeBraindump = () => {
    clearInterval(recIntervalRef.current);
    if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); recognitionRef.current = null; }
    setScreen(lastTab); setCapturedThoughts([]); setDraft(""); setCommitted(""); setIsRecording(false); setShowLeaveConfirm(false);
  };
  const requestCloseBraindump = () => {
    const hasUnsaved = capturedThoughts.length > 0 || textDraft.trim() !== committedText.trim();
    if (hasUnsaved) setShowLeaveConfirm(true); else closeBraindump();
  };

  /* ---------------- task operations ---------------- */
  const saveTask = (updated) => {
    setTasks((prev) => {
      const before = prev.find((t) => t.id === updated.id);
      const timeChanged = before && before.time !== updated.time;
      if (timeChanged) {
        setJustMovedId(updated.id);
        clearTimeout(moveTimeout.current);
        moveTimeout.current = setTimeout(() => setJustMovedId((id) => (id === updated.id ? null : id)), 900);
      }
      return prev.map((t) => (t.id === updated.id ? updated : t));
    });
  };
  const discardTask = (id) => setTasks((prev) => prev.filter((t) => t.id !== id));
  const toggleDoneTask = (id) => {
    const NOW = nowHHMM();
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    const wasLate = t.status !== "done" && !!t.time && t.dayOffset === 0 && t.time < NOW;
    const newStatus = t.status === "done" ? "pending" : "done";
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, status: newStatus } : x)));
    if (newStatus === "done" && wasLate) { setReplanBanner(`«${t.text}» зайняло більше часу, ніж планувалося. Перенести решту сьогоднішнього дня?`); setReplanTaskId(id); }
  };
  const skipTask = (id) => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    setTasks((prev) => prev.map((x) => (x.id === id ? { ...x, status: "skipped" } : x)));
    setReplanBanner(`«${t.text}» пропущено. Перенести решту сьогоднішнього дня?`);
    setReplanTaskId(id);
  };
  const dismissReplan = () => { setReplanBanner(null); setReplanTaskId(null); };
  const doReplan = () => {
    const delay = 30;
    const ref = tasks.find((t) => t.id === replanTaskId);
    const refTime = ref ? ref.time : null;
    setTasks((prev) => prev.map((t) => (t.dayOffset === 0 && t.status === "pending" && t.time && (!refTime || t.time > refTime)) ? { ...t, time: shiftTime(t.time, delay) } : t));
    setReplanBanner(null); setReplanTaskId(null);
    showToast(`Решту сьогоднішнього дня перенесено на ${delay} хв.`);
  };

  /* ---------------- braindump / capture ---------------- */
  const newDraftLines = () => {
    const full = textDraftRef.current;
    const committed = committedTextRef.current;
    const newPart = full.startsWith(committed) ? full.slice(committed.length) : full;
    return newPart.split("\n").map((l) => l.trim()).filter(Boolean);
  };

  // Turns a batch of raw lines into properly split, structured thought cards —
  // via Claude (which can split one messy line into several distinct plans,
  // and recognize edits/cancellations of things already on the schedule),
  // falling back to the simple local guesser (no splitting, always "create")
  // if that fails.
  const captureLines = async (lines) => {
    if (!lines.length) return;
    setIsCapturing(true);
    let built;
    try {
      built = await parseThoughtsRemote(lines, today, buildScheduleContext(tasks, today));
    } catch (err) {
      built = lines.map((l) => parseThought(l, today));
      console.warn("Falling back to local parsing:", err.message);
    }
    // Defense in depth: only trust an update/delete if it points at a task ID
    // that genuinely exists right now. Anything else quietly becomes a
    // plain "create" instead of silently touching the wrong (or no) task.
    const added = built.map((th) => {
      const refTask = th.taskId ? tasks.find((t) => t.id === th.taskId) : null;
      const safe = refTask ? th : { ...th, action: "create", taskId: null };
      return { id: "c" + thoughtSeq.current++, ...safe, refText: refTask ? refTask.text : null };
    });
    setCapturedThoughts((prev) => [...prev, ...added]);
    setIsCapturing(false);
  };

  const sendDraft = () => {
    const full = textDraftRef.current;
    const lines = newDraftLines();
    setCommitted(full);
    if (lines.length) captureLines(lines);
  };

  const startRecordingFallbackDemo = () => {
    // Used only when this browser has no built-in speech-to-text (e.g. Safari,
    // Firefox) — types out a sample phrase so the flow can still be tried.
    showToast("Цей браузер не підтримує голосове введення — показуємо приклад замість цього.", 3200);
    const phrase = MOCK_PHRASES[phraseIndex % MOCK_PHRASES.length];
    const base = textDraftRef.current;
    recBaseRef.current = base.length && !base.endsWith("\n") ? base + "\n" : base;
    setIsRecording(true); setDraft(recBaseRef.current);
    let i = 0;
    const stepMs = Math.max(18, 1400 / phrase.length);
    recIntervalRef.current = setInterval(() => {
      i++;
      setDraft(recBaseRef.current + phrase.slice(0, i));
      if (i >= phrase.length) stopRecording();
    }, stepMs);
  };

  const startRecording = () => {
    if (isRecording) return;
    if (!supportsSpeech) { startRecordingFallbackDemo(); return; }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "uk-UA"; // Ukrainian by default — the browser's system-language setting was being used before, which caused mismatches (e.g. speaking English but the OS set to Russian).

    const base = textDraftRef.current;
    recBaseRef.current = base.length && !base.endsWith("\n") ? base + "\n" : base;

    recognition.onresult = (event) => {
      let finalChunk = "", interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalChunk += transcript;
        else interimChunk += transcript;
      }
      if (finalChunk) recBaseRef.current = recBaseRef.current + finalChunk;
      const combined = recBaseRef.current + interimChunk;
      if (combined.length > MAX_DRAFT_CHARS) {
        // Hit the sane length cap mid-sentence — stop here rather than let one
        // dictation session run away, same spirit as Structured's ~2,000 char cap.
        recBaseRef.current = recBaseRef.current.slice(0, MAX_DRAFT_CHARS);
        setDraft(recBaseRef.current);
        showToast("Це вже непогана частина — погляньмо на неї, перш ніж додавати більше.", 2800);
        stopRecording();
        return;
      }
      setDraft(combined);
    };
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        showToast("Доступ до мікрофона заблоковано — перевірте дозволи цього сайту в браузері.", 3600);
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        showToast("Голосове введення дало збій — спробуйте ще раз або введіть текст вручну.", 2600);
      }
    };
    // Fires whether the mic was stopped by tapping the button, the length cap,
    // or the browser ending the session on its own after a stretch of silence.
    // Either way, this just returns to a normal, editable text box — it does
    // NOT send anything yet. That happens only when the person reviews what
    // was heard and explicitly taps send (or presses Enter), same as typing.
    recognition.onend = () => {
      recognitionRef.current = null;
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    setIsRecording(true);
    setDraft(recBaseRef.current);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsRecording(false);
      showToast("Не вдалося увімкнути мікрофон — можете просто ввести текст.", 2600);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    else { clearInterval(recIntervalRef.current); setIsRecording(false); } // fallback demo path has no onend of its own
  };
  const inputBtnAction = () => {
    if (isRecording) stopRecording();
    else if (textDraft.trim() !== committedText.trim()) sendDraft();
    else startRecording();
  };
  const removeThought = (id) => {
    setCapturedThoughts((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      undoRef.current = { thought: prev[idx], index: idx };
      clearTimeout(undoTimeout.current);
      undoTimeout.current = setTimeout(() => { undoRef.current = null; }, 5000);
      return prev.filter((t) => t.id !== id);
    });
    showToast("План видалено", 5000, undoRemoveThought, "Скасувати");
  };
  const undoRemoveThought = () => {
    if (!undoRef.current) return;
    const { thought, index } = undoRef.current;
    setCapturedThoughts((prev) => { const list = [...prev]; list.splice(Math.min(index, list.length), 0, thought); return list; });
    undoRef.current = null; clearTimeout(undoTimeout.current);
    setToast(null);
  };
  const changeThought = (updated) => setCapturedThoughts((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

  const structureDay = async () => {
    // Normally every card here was already properly split & parsed the moment
    // it was captured (on Enter, the send button, or when voice recording
    // stopped). This only does extra work for the rare leftover case: text
    // typed but never explicitly sent before tapping Accept.
    const lines = newDraftLines();
    let thoughts = capturedThoughts;
    if (lines.length) {
      setIsParsing(true);
      let extra;
      try {
        extra = await parseThoughtsRemote(lines, today, buildScheduleContext(tasks, today));
      } catch (err) {
        extra = lines.map((l) => parseThought(l, today));
        console.warn("Falling back to local parsing:", err.message);
      }
      thoughts = [...thoughts, ...extra.map((th) => {
        const refTask = th.taskId ? tasks.find((t) => t.id === th.taskId) : null;
        const safe = refTask ? th : { ...th, action: "create", taskId: null };
        return { id: "c" + thoughtSeq.current++, ...safe, refText: refTask ? refTask.text : null };
      })];
    }
    if (!thoughts.length) { setIsParsing(false); return; }
    setDraft(""); setCommitted("");

    const creates = thoughts.filter((th) => th.action === "create" || !th.taskId);
    const updates = thoughts.filter((th) => th.action === "update" && th.taskId);
    const deletes = thoughts.filter((th) => th.action === "delete" && th.taskId);

    const newTasks = creates.map((th) => ({
      id: "p" + taskSeq.current++, text: th.text, dayOffset: th.dayOffset, time: th.time,
      duration: th.duration || null, priority: th.priority, status: "pending",
    }));
    const scheduled = newTasks.filter((p) => p.dayOffset !== null);
    const toInbox = newTasks.filter((p) => p.dayOffset === null);

    const updateById = {};
    updates.forEach((th) => {
      updateById[th.taskId] = { text: th.text, dayOffset: th.dayOffset, time: th.time, duration: th.duration || null, priority: th.priority };
    });
    const deleteIds = new Set(deletes.map((th) => th.taskId));

    setTasks((prev) => prev
      .map((t) => (updateById[t.id] ? { ...t, ...updateById[t.id] } : t))
      .filter((t) => !deleteIds.has(t.id))
      .concat(scheduled, toInbox));

    const msgs = [];
    if (scheduled.length) msgs.push(`Додано ${scheduled.length} ${pluralUk(scheduled.length, "план", "плани", "планів")} до вашого дня.`);
    if (toInbox.length) msgs.push(`${toInbox.length} ${pluralUk(toInbox.length, "думка потребує", "думки потребують", "думок потребують")} деталей — перевірте Вхідні.`);
    if (updates.length) msgs.push(`Оновлено ${updates.length} ${pluralUk(updates.length, "наявний план", "наявні плани", "наявних планів")}.`);
    if (deletes.length) msgs.push(`Видалено ${deletes.length} ${pluralUk(deletes.length, "план", "плани", "планів")}.`);
    setIsParsing(false); setCapturedThoughts([]); setScreen(lastTab);
    showToast(msgs.join(" ") || "Готово.", 3400);
  };

  /* ---------------- derived view data ---------------- */
  const sortRows = (arr) => {
    const timed = arr.filter((t) => t.time).sort((a, b) => a.time.localeCompare(b.time));
    const untimed = arr.filter((t) => !t.time);
    return [...timed, ...untimed];
  };

  const todayTasks = tasks.filter((t) => t.dayOffset === 0);
  const todayRows = sortRows(todayTasks);
  const todayDoneCount = todayTasks.filter((t) => t.status === "done").length;
  const firstUntimedIdx = todayRows.findIndex((t) => !t.time);

  const overdueTasks = tasks.filter((t) => t.status === "pending" && t.dayOffset !== null && t.dayOffset < 0);

  const upcomingTasks = tasks.filter((t) => t.dayOffset !== null && t.dayOffset > 0);
  const upcomingGroups = useMemo(() => {
    const by = {};
    upcomingTasks.forEach((t) => { (by[t.dayOffset] = by[t.dayOffset] || []).push(t); });
    return Object.keys(by).map(Number).sort((a, b) => a - b).map((offset) => ({ offset, label: offsetToLabel(offset, today), rows: sortRows(by[offset]) }));
  }, [tasks]); // eslint-disable-line

  const weekDays = useMemo(() => {
    const dow = today.getDay(); // 0=Sun
    const mondayOffset = -(((dow + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const offset = mondayOffset + i;
      const d = addDays(today, offset);
      return {
        offset, isToday: offset === 0, isPast: offset < 0,
        weekday: d.toLocaleDateString("uk-UA", { weekday: "short" }), dayNum: d.getDate(),
        hasTasks: tasks.some((t) => t.dayOffset === offset && t.dayOffset !== null),
      };
    });
  }, [tasks]); // eslint-disable-line

  const selectedDayRows = upcomingDay === null ? [] : sortRows(tasks.filter((t) => t.dayOffset === upcomingDay));

  const allScheduled = tasks.filter((t) => t.dayOffset !== null && t.dayOffset >= 0);
  const allGroups = useMemo(() => {
    const by = {};
    allScheduled.forEach((t) => { (by[t.dayOffset] = by[t.dayOffset] || []).push(t); });
    return Object.keys(by).map(Number).sort((a, b) => a - b).map((offset) => ({ offset, label: offsetToLabel(offset, today), rows: sortRows(by[offset]) }));
  }, [tasks]); // eslint-disable-line

  const unscheduledTasks = tasks.filter((t) => t.dayOffset === null);

  const q = inboxSearch.trim().toLowerCase();
  const matchesQ = (t) => !q || t.text.toLowerCase().includes(q);
  const inboxOverdue = overdueTasks.filter(matchesQ);
  const inboxGroups = allGroups.map((g) => ({ ...g, rows: g.rows.filter((r) => matchesQ(r)) })).filter((g) => g.rows.length);
  const inboxUnscheduled = unscheduledTasks.filter(matchesQ);

  const activeTab = screen === "braindump" ? lastTab : screen;
  const tabColor = (tab) => (activeTab === tab ? COLOR.teal : COLOR.faint);

  /* ------------------------------- render ------------------------------- */

  return (
    <div style={{ background: "#eef2f7", minHeight: "100vh", display: "flex", justifyContent: "center", fontFamily: FONT }}>
      <style>{`
        @keyframes om-fade-in { from { opacity:0; transform:translate(-50%,4px);} to { opacity:1; transform:translate(-50%,0);} }
        @keyframes om-move-in { 0%{transform:translateY(-18px) scale(.97);opacity:.4;background:#ccfbf1;box-shadow:0 8px 20px rgba(13,148,136,.25)} 55%{transform:translateY(3px) scale(1.01);background:#ccfbf1} 100%{transform:translateY(0) scale(1);opacity:1;background:transparent;box-shadow:none} }
        .om-hide-scrollbar{scrollbar-width:none;-ms-overflow-style:none}
        .om-hide-scrollbar::-webkit-scrollbar{display:none}
        .om-btn:focus-visible, .om-icon:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }
      `}</style>

      <div style={{ width: "100%", maxWidth: 430, margin: "0 auto", minHeight: "100vh", background: "#fff", position: "relative", boxShadow: "0 0 40px rgba(17,24,39,.08)", color: COLOR.ink }}>
        <div style={{ minHeight: "100vh", paddingBottom: screen === "braindump" ? 0 : 104 }}>

          {/* ---------------- TODAY ---------------- */}
          {screen === "today" && (
            <div style={{ padding: "28px 16px 20px 16px", background: COLOR.panel }}>
              <div style={{ marginBottom: 24 }}>
                <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: COLOR.ink }}>Сьогодні</h1>
                <p style={{ fontSize: 16, fontWeight: 500, color: COLOR.sub, margin: "4px 0 0" }}>{todayLabel}</p>
              </div>

              {replanBanner && (
                <div style={{ background: "#fff", borderRadius: 16, padding: 14, marginBottom: 16, boxShadow: "0 1px 3px rgba(17,24,39,.06)", borderLeft: `3px solid ${COLOR.rose}` }}>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2, color: COLOR.ink }}>Не встигаєте?</div>
                  <p style={{ fontSize: 13, margin: "0 0 10px", color: COLOR.sub }}>{replanBanner}</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={doReplan} style={{ fontSize: 13, fontWeight: 600, padding: "8px 14px", border: "none", borderRadius: 10, background: COLOR.teal, color: "#fff", cursor: "pointer" }}>Перепланувати решту дня</button>
                    <button type="button" onClick={dismissReplan} style={{ fontSize: 13, fontWeight: 600, padding: "8px 14px", border: "none", borderRadius: 10, background: "none", color: COLOR.sub, cursor: "pointer" }}>Не зараз</button>
                  </div>
                </div>
              )}

              {todayTasks.length > 0 ? (
                <>
                  <SectionLabel>{todayTasks.length} {pluralUk(todayTasks.length, "план", "плани", "планів")} на сьогодні · {todayDoneCount} виконано</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {todayRows.map((t, i) => (
                      <div key={t.id}>
                        {i === firstUntimedIdx && <div style={{ fontSize: 11, fontWeight: 700, color: COLOR.faint, margin: "14px 0 8px" }}>Без визначеного часу</div>}
                        <TaskRow task={t} today={today} allowDayPicker={false} justMoved={t.id === justMovedId}
                          onSave={saveTask} onDiscard={() => discardTask(t.id)} onToggleDone={() => toggleDoneTask(t.id)} onSkip={() => skipTask(t.id)} />
                      </div>
                    ))}
                  </div>
                </>
              ) : <EmptyState>Поки що нічого не заплановано. Натисніть +, щоб озвучити свій день.</EmptyState>}

              {overdueTasks.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <SectionLabel>Прострочені плани ({overdueTasks.length})</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {overdueTasks.map((t) => (
                      <TaskRow key={t.id} task={t} today={today} allowDayPicker overdue
                        onSave={saveTask} onDiscard={() => discardTask(t.id)} onToggleDone={() => toggleDoneTask(t.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---------------- UPCOMING ---------------- */}
          {screen === "upcoming" && (
            <div style={{ padding: "28px 16px 20px 16px", background: COLOR.panel }}>
              <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 18px", color: COLOR.ink }}>Найближчі</h1>

              <div className="om-hide-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 8, marginBottom: 18 }}>
                {weekDays.map((d) => {
                  const sel = upcomingDay === d.offset;
                  return (
                    <button key={d.offset} type="button" disabled={d.isPast}
                      onClick={() => setUpcomingDay((cur) => (cur === d.offset ? null : d.offset))}
                      style={{
                        flex: "none", width: 48, padding: "8px 4px", borderRadius: 14, cursor: d.isPast ? "not-allowed" : "pointer",
                        border: sel ? `1px solid ${COLOR.teal}` : (d.isToday ? `1.5px solid ${COLOR.teal}` : `1px solid ${COLOR.line}`),
                        background: sel ? COLOR.teal : "transparent", color: sel ? "#fff" : (d.isPast ? "#d1d5db" : COLOR.ink),
                        opacity: d.isPast ? 0.5 : 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                      }}>
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", opacity: 0.7 }}>{d.isToday ? "Сьогодні" : d.weekday}</span>
                      <span style={{ fontSize: 15, fontWeight: 700 }}>{d.dayNum}</span>
                      {d.hasTasks && <span style={{ width: 4, height: 4, borderRadius: "50%", background: sel ? "#fff" : COLOR.teal }} />}
                    </button>
                  );
                })}
              </div>

              {upcomingDay === null ? (
                upcomingGroups.length > 0 ? upcomingGroups.map((grp) => (
                  <div key={grp.offset} style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: COLOR.ink }}>{grp.label}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {grp.rows.map((t) => (
                        <TaskRow key={t.id} task={t} today={today} allowDayPicker={false} justMoved={t.id === justMovedId}
                          onSave={saveTask} onDiscard={() => discardTask(t.id)} onToggleDone={() => toggleDoneTask(t.id)} />
                      ))}
                    </div>
                  </div>
                )) : <EmptyState>Поки немає найближчих планів.</EmptyState>
              ) : (
                selectedDayRows.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {selectedDayRows.map((t) => (
                      <TaskRow key={t.id} task={t} today={today} allowDayPicker={false} justMoved={t.id === justMovedId}
                        onSave={saveTask} onDiscard={() => discardTask(t.id)} onToggleDone={() => toggleDoneTask(t.id)} />
                    ))}
                  </div>
                ) : <EmptyState>На цей день нічого не заплановано.</EmptyState>
              )}
            </div>
          )}

          {/* ---------------- INBOX ---------------- */}
          {screen === "inbox" && (
            <div style={{ padding: "28px 16px 20px 16px", background: COLOR.panel }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
                <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, color: COLOR.ink }}>Вхідні</h1>
                <button type="button" aria-label="Пошук" onClick={() => setShowInboxSearch((s) => !s)} style={{ border: "none", background: "none", color: COLOR.sub, cursor: "pointer", padding: 6, borderRadius: 10 }}>
                  <Search size={18} />
                </button>
              </div>

              {showInboxSearch && (
                <div style={{ position: "relative", marginBottom: 20 }}>
                  <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: COLOR.faint }} />
                  <input value={inboxSearch} onChange={(e) => setInboxSearch(e.target.value)} placeholder="Пошук серед планів" autoFocus
                    style={{ width: "100%", padding: "10px 14px 10px 38px", fontSize: 13, border: `1px solid ${COLOR.line}`, borderRadius: 12, boxSizing: "border-box" }} />
                </div>
              )}

              {inboxOverdue.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <SectionLabel>Прострочені плани ({inboxOverdue.length})</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {inboxOverdue.map((t) => (
                      <TaskRow key={t.id} task={t} today={today} allowDayPicker overdue onSave={saveTask} onDiscard={() => discardTask(t.id)} onToggleDone={() => toggleDoneTask(t.id)} />
                    ))}
                  </div>
                </div>
              )}

              {inboxUnscheduled.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <SectionLabel>Потребує дати ({inboxUnscheduled.length})</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {inboxUnscheduled.map((t) => (
                      <TaskRow key={t.id} task={t} today={today} allowDayPicker onSave={saveTask} onDiscard={() => discardTask(t.id)} onToggleDone={() => toggleDoneTask(t.id)} />
                    ))}
                  </div>
                </div>
              )}

              {inboxGroups.length > 0 ? inboxGroups.map((grp) => (
                <div key={grp.offset} style={{ marginBottom: 24 }}>
                  <SectionLabel>{grp.label}</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {grp.rows.map((t) => (
                      <TaskRow key={t.id} task={t} today={today} allowDayPicker={false} justMoved={t.id === justMovedId}
                        onSave={saveTask} onDiscard={() => discardTask(t.id)} onToggleDone={() => toggleDoneTask(t.id)} />
                    ))}
                  </div>
                </div>
              )) : (inboxOverdue.length === 0 && inboxUnscheduled.length === 0 && <EmptyState>{q ? "Немає планів, що відповідають пошуку." : "Тут поки що порожньо."}</EmptyState>)}
            </div>
          )}

          {/* ---------------- MORE ---------------- */}
          {screen === "more" && (
            <div style={{ padding: "24px 20px 20px 20px", background: COLOR.panel, textAlign: "center" }}>
              <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 24px", color: COLOR.ink, textAlign: "left" }}>Ще</h1>
              <div style={{ width: 112, height: 112, borderRadius: "50%", margin: "0 auto 14px", background: `linear-gradient(135deg, ${COLOR.tealLight}, ${COLOR.teal})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 20px rgba(13,148,136,.25)" }}>
                <span style={{ fontSize: 38, fontWeight: 700, color: "#fff" }}>АР</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: COLOR.ink }}>Алекс Рівера</div>
              <div style={{ fontSize: 14, color: COLOR.sub, marginBottom: 28 }}>США — Сан-Франциско</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 14, textAlign: "left" }}>
                <button type="button" onClick={() => showToast("Дякуємо — відгук збережено.")} style={moreBtn}><Mail size={20} /> Залишити відгук</button>
                <div style={{ background: "#dbeafe", borderRadius: 18, padding: "6px 18px" }}>
                  {[
                    { icon: <FileText size={20} />, label: "Правила використання" },
                    { icon: <Bell size={20} />, label: "Сповіщення" },
                    { icon: <Shield size={20} />, label: "Політика конфіденційності" },
                    { icon: <FileText size={20} />, label: "Умови використання" },
                  ].map((row, i, arr) => (
                    <div key={row.label} onClick={() => showToast(row.label + " — скоро з'явиться.")} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: i < arr.length - 1 ? "1px solid rgba(30,58,95,.1)" : "none", fontSize: 15, color: "#1e3a5f", fontWeight: 600, cursor: "pointer" }}>
                      {row.icon}{row.label}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => showToast("Кольорова схема: системна")} style={{ ...moreBtn, justifyContent: "space-between" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 14 }}><Palette size={20} />Кольорова схема</span>
                  <span style={{ color: COLOR.sub, fontWeight: 600 }}>Системна</span>
                </button>
                <button type="button" onClick={() => showToast("Ви вийшли (демо).")} style={{ ...moreBtn, color: "#dc2626" }}><LogOut size={20} /> Вийти</button>
              </div>
              <button type="button" onClick={() => { setTasks(seedTasks()); showToast("Дані скинуто до демо-версії."); }} style={{ border: "none", background: "none", color: COLOR.faint, fontSize: 12, textDecoration: "underline", cursor: "pointer", marginTop: 28, padding: 0 }}>
                Скинути демо-дані
              </button>
              <p style={{ fontSize: 12, color: COLOR.faint, marginTop: 10 }}>Версія 1.0.0</p>
            </div>
          )}

          {/* ---------------- BRAINDUMP ---------------- */}
          {screen === "braindump" && (
            <div style={{ minHeight: "100vh", padding: "28px 16px 200px 16px", background: "linear-gradient(180deg, #dbeafe 0%, #eff6ff 35%, #e0edfc 65%, #bfdbfe 100%)" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
                <button type="button" aria-label="Закрити" onClick={requestCloseBraindump} style={{ border: "none", background: "rgba(255,255,255,.6)", color: "#374151", cursor: "pointer", padding: 0, width: 34, height: 34, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <X size={16} />
                </button>
              </div>
              <p style={{ fontSize: 15, color: COLOR.teal, margin: "0 0 4px", fontWeight: 700 }}>Привіт, Алекс 👋</p>
              <h1 style={{ fontSize: 27, fontWeight: 800, lineHeight: 1.2, margin: "0 0 24px", color: COLOR.ink }}>Які у вас плани на сьогодні?</h1>

              {capturedThoughts.length > 0 && (
                <div>
                  <SectionLabel>Ваші плани ({capturedThoughts.length})</SectionLabel>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {capturedThoughts.map((th) => (
                      <ThoughtCard key={th.id} thought={th} today={today} onChange={changeThought} onRemove={() => removeThought(th.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* fixed input panel — braindump only */}
        {screen === "braindump" && (
          <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 0, width: "100%", maxWidth: 430, background: "#fff", borderTop: "1px solid #f1f3f5", padding: 16, display: "flex", flexDirection: "column", gap: 12, zIndex: 7 }}>
            <div style={{ position: "relative", background: "#f3f4f6", borderRadius: 16, padding: "12px 50px 12px 14px" }}>
              <textarea
                readOnly={isRecording}
                className="om-hide-scrollbar"
                style={{ width: "100%", border: "none", background: "transparent", padding: 0, resize: "none", fontSize: 14, fontFamily: "inherit", height: 56, overflowY: "auto", boxSizing: "border-box", color: COLOR.ink }}
                placeholder="Введіть план або натисніть на мікрофон, щоб сказати…"
                value={textDraft}
                maxLength={MAX_DRAFT_CHARS}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_DRAFT_CHARS))}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendDraft(); } }}
              />
              <button type="button" aria-label={isRecording ? "Зупинити" : "Записати"} onClick={inputBtnAction}
                style={{ position: "absolute", right: 10, bottom: 10, width: 34, height: 34, borderRadius: "50%", border: "none", background: isRecording ? "#dc2626" : COLOR.teal, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
                {isRecording ? <Square size={13} /> : (textDraft.trim() !== committedText.trim() ? <Send size={15} /> : <Mic size={15} />)}
              </button>
            </div>
            {isRecording && <p style={{ fontSize: 12, color: COLOR.faint, margin: "-4px 0 0", textAlign: "center" }}>Слухаю…</p>}
            {!isRecording && !isCapturing && textDraft.trim() !== committedText.trim() && (
              <p style={{ fontSize: 12, color: COLOR.faint, margin: "-4px 0 0", textAlign: "center" }}>Все правильно? Натисніть надіслати, або спочатку виправте.</p>
            )}
            {!isRecording && isCapturing && <p style={{ fontSize: 12, color: COLOR.faint, margin: "-4px 0 0", textAlign: "center" }}>Опрацьовую ваш план…</p>}
            {capturedThoughts.length > 0 && (
              <button type="button" disabled={isParsing || isCapturing} onClick={structureDay}
                style={{ width: "100%", padding: "13px 0", border: "none", borderRadius: 14, background: COLOR.teal, color: "#fff", fontSize: 15, fontWeight: 700, cursor: (isParsing || isCapturing) ? "default" : "pointer", opacity: (isParsing || isCapturing) ? 0.85 : 1 }}>
                {isParsing ? "Формую ваш день…" : "Прийняти плани"}
              </button>
            )}
          </div>
        )}

        {/* bottom nav + FAB */}
        {screen !== "braindump" && (
          <>
            <nav style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 0, width: "100%", maxWidth: 430, background: "#fff", borderTop: "1px solid #f1f3f5", display: "flex", alignItems: "stretch", height: 64, zIndex: 5 }}>
              {[
                { tab: "today", icon: <Calendar size={20} />, label: "Сьогодні", go: () => goTab("today") },
                { tab: "upcoming", icon: <ChevronRight size={20} style={{ transform: "rotate(0deg)" }} />, label: "Найближчі", go: () => goTab("upcoming") },
                { tab: "inbox", icon: <InboxIcon size={20} />, label: "Вхідні", go: () => goTab("inbox") },
                { tab: "more", icon: <MoreHorizontal size={20} />, label: "Ще", go: () => goTab("more") },
              ].map((item) => (
                <button key={item.tab} type="button" onClick={item.go} style={{ flex: 1, background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, cursor: "pointer", color: tabColor(item.tab) }}>
                  {item.icon}
                  <span style={{ fontSize: 10, fontWeight: 600 }}>{item.label}</span>
                </button>
              ))}
            </nav>
            <button type="button" aria-label="Новий план" onClick={openBraindump}
              style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 42, width: 56, height: 56, borderRadius: "50%", background: `linear-gradient(135deg, ${COLOR.tealLight}, ${COLOR.teal})`, color: "#fff", border: "none", boxShadow: "0 8px 20px rgba(13,148,136,.4)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 6, padding: 0 }}>
              <Plus size={22} />
            </button>
          </>
        )}

        {/* leave-confirm modal */}
        {showLeaveConfirm && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(17,24,39,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }}>
            <div style={{ background: "#fff", borderRadius: 20, boxShadow: "0 20px 60px rgba(17,24,39,.25)", maxWidth: 320, width: "100%", padding: 22, textAlign: "center" }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: COLOR.ink, marginBottom: 8 }}>Вийти без збереження?</div>
              <p style={{ fontSize: 14, color: COLOR.sub, margin: "0 0 20px" }}>Ваші плани ще не додано — якщо вийти зараз, вони не збережуться.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={() => setShowLeaveConfirm(false)} style={{ flex: 1, border: `1px solid ${COLOR.line}`, background: "#fff", color: "#374151", fontSize: 14, fontWeight: 600, borderRadius: 10, padding: "10px 0", cursor: "pointer" }}>Продовжити редагування</button>
                <button type="button" onClick={closeBraindump} style={{ flex: 1, border: "none", background: "#dc2626", color: "#fff", fontSize: 14, fontWeight: 600, borderRadius: 10, padding: "10px 0", cursor: "pointer" }}>Скасувати</button>
              </div>
            </div>
          </div>
        )}

        {/* toast */}
        {toast && (
          <div style={{ position: "fixed", left: "50%", bottom: 130, transform: "translateX(-50%)", background: "#111827", color: "#fff", padding: "10px 14px 10px 18px", borderRadius: 14, fontSize: 13, boxShadow: "0 8px 24px rgba(17,24,39,.3)", zIndex: 10, maxWidth: 340, textAlign: "center", animation: "om-fade-in .2s ease", display: "flex", alignItems: "center", gap: 12 }}>
            <span>{toast}</span>
            {toastAction && <button type="button" onClick={toastAction} style={{ background: "none", border: "none", color: "#5eead4", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "2px 4px", flex: "none" }}>{toastActionLabel}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

const moreBtn = { display: "flex", alignItems: "center", gap: 14, background: "#dbeafe", border: "none", borderRadius: 18, padding: "16px 18px", cursor: "pointer", fontSize: 15, color: "#1e3a5f", fontWeight: 600 };
