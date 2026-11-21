/**
 * Calling for a roll — the half with no Foundry in it.
 *
 * "Everybody make an Instinct Roll" is said at every Daggerheart table several
 * times a session, and until now it was said out loud and answered by four
 * people each going to find the trait on four sheets. A CALL is the GM's
 * sentence sent to the players' rails: one press on each called character's
 * rail opens the roll popover already holding the trait, and the answer comes
 * back to the GM's panel as it lands. `roll-call-host.ts` owns the socket, the
 * clock and the DOM; this file owns every decision that can be wrong quietly.
 *
 * A call is never stored. It is a sentence and not a record: it ends when it
 * is answered, when the GM takes it back, or after `CALL_LIFE`, and a reload on
 * either side forgets it, which is the honest outcome for a thing nobody wrote
 * down.
 *
 * Five things here fail silently, and each is held by `tools/test-roll-call.mjs`:
 *
 *   - A call is honoured only from a sender the SERVER names, and only if that
 *     user is an active GM. `readCall` takes the host's answer about the
 *     attested sender and never reads the payload's own word for who sent it —
 *     the payload has no such field to read.
 *   - The key is one of `CALL_KEYS` and nothing else. It becomes a press on
 *     somebody else's screen and an argument to the roll engine.
 *   - The Difficulty is the GM's number. It rides the payload only when the GM
 *     chose to show it; hidden, the player's roll carries none, the card says
 *     there was no target number, and the GM's panel reads the total against
 *     the number that never left the GM's screen.
 *   - A call for some of the party goes to those players and nobody else: the
 *     server filters by recipient, so a payload sent wider and ignored by the
 *     others would still be sitting in their socket.
 *   - Each player's payload names only that player's own called characters,
 *     never the rest of the list.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TRAITS, traitLabel, type Trait } from "./config.ts";

/** How long a call stands unanswered: long enough for a table to finish a sentence. */
export const CALL_LIFE = 180_000;

/**
 * The six traits, and Spellcast — which is not a seventh trait but a pointer to
 * one of the six (`RESOURCE_TRAITS`'s reading), resolved per character on the
 * player's client. A character with no Spellcast trait cannot answer a
 * Spellcast call, and the bar says so rather than rolling Finesse.
 */
export const CALL_KEYS = [...TRAITS, "spellcast"] as const;
export type CallKey = (typeof CALL_KEYS)[number];

/**
 * How the answer is posted. Foundry's message modes, less two:
 * `self` because a roll the GM asked for and cannot see answers nothing, and
 * `blind` because a duality roll is the player's to act on — a Hope result is a
 * claim on a card the roller could not see, and the Fear lands on a pool that
 * is public by design, so "blind" would be a roll whose outcome the whole table
 * reads off the Fear strip except the person who made it.
 */
export const CALL_MODES = ["public", "gm"] as const;
export type CallMode = (typeof CALL_MODES)[number];

/** The lowest and highest Difficulty a call may carry. The book's run 5–30. */
export const DC_RANGE = [1, 40] as const;

const WHO_MAX = 16;
const ID_MAX = 64;

const list = (x: any): any[] => (Array.isArray(x) ? x : x instanceof Set ? [...x] : []);
const ids = (x: any): string[] =>
  [...new Set(list(x).filter((v) => typeof v === "string" && v).map((v: string) => v.slice(0, ID_MAX)))].slice(
    0,
    WHO_MAX,
  );

export const isCallKey = (x: unknown): x is CallKey =>
  typeof x === "string" && (CALL_KEYS as readonly string[]).includes(x);

/** A mode as given: one of `CALL_MODES`, else the open roll. */
export const modeOf = (x: unknown): CallMode =>
  (CALL_MODES as readonly string[]).includes(x as string) ? (x as CallMode) : "public";

/** A Difficulty as typed: a whole number in range, or null for none. */
export function dcOf(x: unknown): number | null {
  if (x == null || String(x).trim() === "") return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i < DC_RANGE[0] || i > DC_RANGE[1] ? null : i;
}

/** What a key is called on screen. */
export const keyLabel = (k: CallKey): string => (k === "spellcast" ? "Spellcast" : traitLabel(k));

/** The trait a key rolls for a character whose Spellcast trait is `spellcast`. */
export function traitOf(key: unknown, spellcast: unknown): Trait | null {
  if (!isCallKey(key)) return null;
  if (key !== "spellcast") return key;
  return (TRAITS as readonly string[]).includes(spellcast as string) ? (spellcast as Trait) : null;
}

/* ── who ──────────────────────────────────────────────────────────── */

export interface Member {
  id: string;
  name?: string;
  img?: string | null;
}

/**
 * The characters a call is for. `who` is the GM's pick; an empty pick, or one
 * that names nobody in the party, is the whole party.
 */
export function callTargets(members: Member[], who: unknown): string[] {
  const all = list(members)
    .map((m) => m?.id)
    .filter((id): id is string => typeof id === "string" && !!id);
  const pick = ids(who).filter((id) => all.includes(id));
  return pick.length ? pick : all;
}

export interface UserLike {
  id: string;
  active: boolean;
  isGM: boolean;
  /** The actor id the user is assigned, if any. */
  character: string | null;
  owns(actorId: string): boolean;
}

/**
 * Who hears a call. A character's call goes to the connected player it is
 * assigned to; with no such player, to the connected players who own it. GMs
 * are never recipients — they own everything, and a GM's client answering a
 * call is the GM rolling for somebody who was asked.
 *
 * → `to` maps a user id to the called characters that are theirs; `away` is
 * every called character with nobody connected to answer for it.
 */
export function callRecipients(targets: string[], users: UserLike[]): { to: Map<string, string[]>; away: string[] } {
  const players = list(users).filter((u) => u?.active && !u.isGM);
  const to = new Map<string, string[]>();
  const away: string[] = [];
  for (const id of list(targets)) {
    const own = players.filter((u) => u.character === id);
    const hear = own.length ? own : players.filter((u) => u.owns?.(id));
    if (!hear.length) {
      away.push(id);
      continue;
    }
    for (const u of hear) to.set(u.id, [...(to.get(u.id) ?? []), id]);
  }
  return { to, away };
}

/* ── the payload ──────────────────────────────────────────────────── */

export interface CallPayload {
  type: "call";
  id: string;
  key: CallKey;
  at: number;
  mode: CallMode;
  who: string[];
  dc?: number;
}

export interface EndPayload {
  type: "end";
  id: string;
}

/**
 * A call as it leaves the GM, for ONE player. `showDc` false keeps the number
 * at home — there is no other path by which it could leave. Null when the key
 * is not one a call may name.
 */
export function makeCall(o: {
  key: unknown;
  dc?: unknown;
  showDc?: boolean;
  mode?: unknown;
  who?: unknown;
  id: string;
  at: number;
}): CallPayload | null {
  if (!isCallKey(o.key) || typeof o.id !== "string" || !o.id) return null;
  const n = dcOf(o.dc);
  return {
    type: "call",
    id: o.id.slice(0, ID_MAX),
    key: o.key,
    at: Number(o.at) || 0,
    mode: modeOf(o.mode),
    who: ids(o.who),
    ...(o.showDc && n != null ? { dc: n } : {}),
  };
}

export interface InCall {
  id: string;
  key: CallKey;
  mode: CallMode;
  who: string[];
  until: number;
  dc?: number;
}

/**
 * A payload as it arrives on a player's client. Total: anything that is not a
 * well-formed call from a GM is null, and nothing of it is kept beyond the
 * fields named here. `fromGM` is the host's answer about the SERVER-attested
 * sender; the payload itself carries no sender field and none would be read.
 */
export function readCall(
  payload: unknown,
  { fromGM = false, now = 0 }: { fromGM?: boolean; now?: number } = {},
): InCall | { end: string } | null {
  if (!fromGM || !payload || typeof payload !== "object") return null;
  const p = payload as any;
  if (p.type === "end") return typeof p.id === "string" && p.id ? { end: p.id.slice(0, ID_MAX) } : null;
  if (p.type !== "call" || !isCallKey(p.key) || typeof p.id !== "string" || !p.id) return null;
  const who = ids(p.who);
  if (!who.length) return null;
  const dc = dcOf(p.dc);
  return {
    id: p.id.slice(0, ID_MAX),
    key: p.key,
    mode: modeOf(p.mode),
    who,
    until: now + CALL_LIFE,
    ...(dc != null ? { dc } : {}),
  };
}

/** Is this call still standing at `now`? */
export const callLive = (call: { until?: number } | null | undefined, now: number): boolean =>
  !!call && now < (call.until ?? 0);

/**
 * What a player's rail draws for one called character, or null — no call, a
 * call lapsed, a character it was not made for, or a Spellcast call to a
 * character with no Spellcast trait (`trait: null`, drawn as a bar that says so).
 */
export function barModel(
  call: InCall | null,
  actor: { id: string; spellcast?: unknown } | null,
  now: number,
): { id: string; key: CallKey; label: string; trait: Trait | null; mode: CallMode; left: number; life: number; dc?: number } | null {
  if (!call || !actor || !callLive(call, now) || !call.who.includes(actor.id)) return null;
  return {
    id: call.id,
    key: call.key,
    label: keyLabel(call.key),
    trait: traitOf(call.key, actor.spellcast),
    mode: call.mode,
    left: Math.max(0, call.until - now),
    life: CALL_LIFE,
    ...(call.dc != null ? { dc: call.dc } : {}),
  };
}

/** The call with one character answered: the rest of the player's characters still owe it. */
export function withoutAnswered(call: InCall | null, actorId: string): InCall | null {
  if (!call) return null;
  const who = call.who.filter((id) => id !== actorId);
  return who.length ? { ...call, who } : null;
}

/* ── the answer ───────────────────────────────────────────────────── */

export type Outcome = "hope" | "fear" | "crit";

export interface Answer {
  /** When the message was seen; the total arrives once the dice land. */
  seen: number;
  total?: number;
  out?: Outcome;
}

/** The GM's record of a call that is out. Never stored outside the GM's memory. */
export interface Out {
  id: string;
  key: CallKey;
  at: number;
  mode: CallMode;
  /** The Difficulty as it stood when the call went out — every answer is read against one number. */
  dc: number | null;
  /** Whether that Difficulty went to the players. */
  shown: boolean;
  until: number;
  targets: string[];
  away: string[];
  /** The users the call was sent to, so a withdrawal reaches exactly them. */
  users: string[];
  answered: Map<string, Answer>;
}

/**
 * Did this chat message answer the call? A duality roll carrying the call's id,
 * by one of the called characters, whose author owns that character, made
 * after the call went out and before it lapsed. The flag alone is not trusted:
 * any client can write any flag on its own message, so the actor must be one
 * that was called and one its author could have rolled for — which is
 * everything a forged flag could otherwise claim.
 */
export function answersCall(
  out: Out | null,
  m: { call?: unknown; kind?: unknown; actorId?: unknown; owned?: boolean; at?: number },
): boolean {
  if (!out || m.call !== out.id || m.kind !== "duality") return false;
  if (typeof m.actorId !== "string" || !out.targets.includes(m.actorId)) return false;
  if (!m.owned) return false;
  const at = m.at ?? 0;
  return at >= out.at && at <= out.until;
}

/**
 * Success or failure against a Difficulty, the engine's rule: a critical
 * succeeds whatever the number, and meeting it beats it. Null with no
 * Difficulty, because "no target number" is not a failure.
 */
export function verdict(total: number | undefined, out: Outcome | undefined, dc: number | null): "success" | "failure" | null {
  if (dc == null || total == null) return null;
  if (out === "crit") return "success";
  return total >= dc ? "success" : "failure";
}

export interface OutTarget {
  id: string;
  name: string;
  img: string | null;
  state: "in" | "rolling" | "wait" | "away";
  total?: number;
  out?: Outcome;
  verdict?: "success" | "failure";
}

/**
 * The call that is out, as the GM's panel draws it. `state` is "in" (rolled,
 * total known), "rolling" (the message is here and the dice are still on the
 * table), "wait", or "away" (nobody connected to answer). The total is held
 * back until the dice land, as every result on the rail is.
 */
export function outModel(out: Out | null, members: Member[], now: number) {
  if (!out) return null;
  const by = new Map(list(members).map((m) => [m.id, m]));
  const targets: OutTarget[] = out.targets
    .filter((id) => by.has(id))
    .map((id) => {
      const a = out.answered.get(id);
      const m = by.get(id)!;
      const v = a ? verdict(a.total, a.out, out.dc) : null;
      return {
        id,
        name: m.name ?? "",
        img: m.img ?? null,
        state: a ? (a.total != null ? "in" : "rolling") : out.away.includes(id) ? "away" : "wait",
        ...(a?.total != null ? { total: a.total } : {}),
        ...(a?.out ? { out: a.out } : {}),
        ...(v ? { verdict: v } : {}),
      };
    });
  return {
    id: out.id,
    key: out.key,
    label: keyLabel(out.key),
    mode: out.mode,
    dc: out.dc,
    shown: out.shown,
    left: Math.max(0, out.until - now),
    life: CALL_LIFE,
    n: targets.filter((t) => t.state === "in" || t.state === "rolling").length,
    of: targets.filter((t) => t.state !== "away").length,
    targets,
  };
}

/** Every called character still owing an answer, so a call that is fully answered can close itself. */
export const callDone = (out: Out | null): boolean =>
  !!out && out.targets.every((id) => out.away.includes(id) || out.answered.get(id)?.total != null);

/* ── the grid ─────────────────────────────────────────────────────── */

/**
 * Who in the party is good at what: a row per key, a column per character.
 * `mods[key]` is what that character's roll would open at, or null where they
 * cannot make it (Spellcast with no spellcasting subclass). `best` marks the
 * highest in a row — every holder of it on a tie — and never a row where
 * everybody is equal, because a highlight on everybody says nothing.
 */
export function partyGrid(members: (Member & { mods: Partial<Record<CallKey, number | null>> })[]) {
  const pcs = list(members);
  const rows = CALL_KEYS.map((key) => {
    const cells = pcs.map((m) => {
      const v = m.mods?.[key];
      return { id: m.id as string, mod: typeof v === "number" && Number.isFinite(v) ? v : null, best: false };
    });
    const mods = cells.map((c) => c.mod).filter((v): v is number => v != null);
    const top = mods.length ? Math.max(...mods) : null;
    const flat = mods.length < 2 || mods.every((v) => v === top);
    for (const c of cells) c.best = !flat && c.mod != null && c.mod === top;
    return { key, label: keyLabel(key), cells };
  });
  return { members: pcs.map((m) => ({ id: m.id, name: m.name ?? "", img: m.img ?? null })), rows };
}
