/**
 * Calling for a roll — the half a study page cannot have.
 *
 * `roll-call.ts` decides; `design/call.*` draws; this file is the socket, the
 * clock and the three places on the bottom rail the objects stand.
 *
 * **It stands on the rail without the rail knowing.** The bottom HUD renders
 * once and replaces its whole markup when its shape changes, so anything
 * hung inside `.bhud` from outside would be swept away by the next level-up.
 * Rather than teach `bottom-hud.ts` about calls, this watches the HUD's host
 * for exactly that replacement (`childList`, not the subtree — a value change
 * moves nothing and fires nothing) and puts its three objects back. They are
 * rebuilt from state each time rather than moved, so an arrival that already
 * played is not played again, and the drain restarts where the clock is.
 *
 * **Transport.** One system socket (`"socket": true` in `system.json`, which
 * Foundry reads at server start — a world that upgrades needs a restart before
 * any of this can arrive). The server calls the listener with the payload and
 * the id of the user who sent it; that second argument is the only sender
 * anything here believes. A call goes out once per player, by `recipients`, so
 * the server delivers each player's payload to that player alone.
 *
 * **Answers come back through the chat log, not the socket.** The roll the
 * player makes is a chat message carrying the call's id in its flags; the GM's
 * client sees every duality message it is allowed to see — open, or whispered
 * to the GMs — and `answersCall` decides whether this one answers. A socket
 * reply would be the player's client asserting a total; the message is the
 * roll itself, its dice in the log, and the total is read off the plate the
 * engine wrote. The flag is only a pointer, and it is checked against the
 * speaker and the author's ownership before it counts.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { SYSTEM_ID, traitLabel } from "./config.ts";
import { askRoll, rollBase } from "./apps/ask-roll.ts";
import { party } from "./bottom-hud.ts";
import { waitFor3dDice } from "./dice/dsn.ts";
import { portraitOf } from "./dice/rolls.ts";
import {
  CALL_KEYS,
  CALL_LIFE,
  answersCall,
  barModel,
  callRecipients,
  callTargets,
  dcOf,
  isCallKey,
  makeCall,
  modeOf,
  outModel,
  partyGrid,
  readCall,
  traitOf,
  withoutAnswered,
  type CallMode,
  type InCall,
  type Out,
} from "./roll-call.ts";
import { CALL_BARS, CALL_PANEL, CALL_PRESS } from "./ui/call.js";

const SOCKET = `system.${SYSTEM_ID}`;

/* ── state. None of it is stored, on either side. ───────────────── */

/** The GM's sentence as it is being composed. */
const compose: { who: string[]; mode: CallMode; dc: string; showDc: boolean } = {
  who: [],
  mode: "public",
  dc: "",
  showDc: false,
};
/** The call that is out, on the GM's client. */
let out: Out | null = null;
let outTimer: ReturnType<typeof setTimeout> | null = null;
let panelOpen = false;

/** The call that came in, on a player's client, narrowed to their own characters. */
let incoming: InCall | null = null;
let inTimer: ReturnType<typeof setTimeout> | null = null;
/** Characters whose bar has not been drawn yet: the arrival plays on the first draw only. */
const fresh = new Set<string>();

let redrawTimer: ReturnType<typeof setTimeout> | null = null;

/* ── mounting ─────────────────────────────────────────────────────── */

export function registerRollCall(): void {
  const sock = (game as any).socket;
  if (sock?.on) sock.on(SOCKET, onSocket);
  else console.error(`${SYSTEM_ID} | no socket — calls for a roll cannot arrive on this client.`);

  Hooks.on("createChatMessage", (m: any) => void onMessage(m));
  /* A reroll rewrites the answering card in place; the panel reads it again. */
  Hooks.on("updateChatMessage", (m: any) => onReroll(m));
  /* The grid's numbers are a character's live trait values. */
  Hooks.on("updateActor", () => panelOpen && schedule());
  Hooks.on("updateItem", () => panelOpen && schedule());

  document.addEventListener("click", (e) => void onClick(e));
  document.addEventListener("input", onInput);
  document.addEventListener("keydown", onKey);

  const host = document.querySelector("#interface > .dh-bhud-host");
  if (host) new MutationObserver(() => attach()).observe(host, { childList: true });
  attach();
}

/** Coalesced, for the bottom HUD's reason: a hit is four writes and the panel should answer the last. */
function schedule(): void {
  if (redrawTimer) return;
  redrawTimer = setTimeout(() => {
    redrawTimer = null;
    attach();
  }, 0);
}

/** The bottom HUD's rail, when one is up. */
const railRoot = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("#interface > .dh-bhud-host > .bhud");

/** Put every object back where it stands, from state. Idempotent. */
function attach(): void {
  if (game.user?.isGM) {
    const root = railRoot();
    const gmRail = root?.dataset.role === "gm" ? root : null;
    placePress(gmRail);
    placePanel(gmRail);
    return;
  }
  placeBars();
}

/* ── the GM ───────────────────────────────────────────────────────── */

/** The party as the GM's seats show it, with the numbers each roll would open at. */
function members() {
  return party().map((a: any) => ({
    id: a.id as string,
    name: a.name as string,
    img: (portraitOf(a) ?? a.img ?? null) as string | null,
    mods: Object.fromEntries(
      CALL_KEYS.map((k) => {
        const t = traitOf(k, a.system?.spellcastTrait);
        return [k, t ? rollBase(a, t) : null];
      }),
    ),
  }));
}

const outNow = () => outModel(out, members(), Date.now());

function placePress(root: HTMLElement | null): void {
  for (const el of document.querySelectorAll(".bh-call-press")) if (!root?.contains(el)) el.remove();
  const stack = root?.querySelector(".bh-stack");
  if (!stack) return;
  const tpl = document.createElement("template");
  tpl.innerHTML = CALL_PRESS({ out: outNow(), open: panelOpen }).trim();
  const el = tpl.content.firstElementChild!;
  const old = stack.querySelector(".bh-call-press");
  if (old) old.replaceWith(el);
  else stack.append(el);
}

function placePanel(root: HTMLElement | null): void {
  const old = document.querySelector<HTMLElement>(".bh-call-panel");
  if (!root || !panelOpen) return void old?.remove();
  /* A redraw while the GM is typing a Difficulty keeps the caret where it was. */
  const typing = document.activeElement?.matches?.("[data-call-dc]")
    ? (document.activeElement as HTMLInputElement).selectionStart
    : null;
  const tpl = document.createElement("template");
  tpl.innerHTML = CALL_PANEL({ grid: partyGrid(members()), compose, out: outNow() }).trim();
  const el = tpl.content.firstElementChild as HTMLElement;
  /* The rise is for opening, not for every answer that lands while it is open. */
  if (old && root.contains(old)) {
    el.classList.add("is-steady");
    old.replaceWith(el);
  } else {
    old?.remove();
    root.append(el);
  }
  if (typing != null) {
    const input = el.querySelector<HTMLInputElement>("[data-call-dc]");
    input?.focus();
    input?.setSelectionRange(typing, typing);
  }
}

/** Send the call for `key` to the characters the GM has picked. */
export function sendCall(key: string): boolean {
  if (!game.user?.isGM || !isCallKey(key)) return false;
  const targets = callTargets(members(), compose.who);
  if (!targets.length) {
    ui.notifications?.info(game.i18n.localize("DAGGERHEART.Call.Nobody"));
    return false;
  }
  const actors = (game as any).actors;
  const users = [...((game as any).users ?? [])].map((u: any) => ({
    id: u.id,
    active: !!u.active,
    isGM: !!u.isGM,
    character: u.character?.id ?? null,
    owns: (id: string) => !!actors?.get(id)?.testUserPermission?.(u, "OWNER"),
  }));
  const { to, away } = callRecipients(targets, users);
  if (!to.size) {
    ui.notifications?.info(game.i18n.localize("DAGGERHEART.Call.NobodyHere"));
    return false;
  }
  const id = foundry.utils.randomID();
  const at = Date.now();
  const mode = modeOf(compose.mode);
  const payloads = [...to].map(([user, who]) => [user, makeCall({ key, dc: compose.dc, showDc: compose.showDc, mode, who, id, at })] as const);
  if (payloads.some(([, call]) => !call)) return false;

  endCall(true);
  for (const [user, call] of payloads) (game as any).socket.emit(SOCKET, call, { recipients: [user] });
  const dc = dcOf(compose.dc);
  out = {
    id,
    key,
    at,
    mode,
    dc,
    shown: compose.showDc && dc != null,
    until: at + CALL_LIFE,
    targets,
    away,
    users: [...to.keys()],
    answered: new Map(),
  };
  outTimer = setTimeout(() => {
    out = null;
    attach();
  }, CALL_LIFE);
  attach();
  return true;
}

/** Take the call back, on every client it went to. */
export function endCall(quiet = false): void {
  if (!out || !game.user?.isGM) return;
  (game as any).socket.emit(SOCKET, { type: "end", id: out.id }, { recipients: out.users });
  if (outTimer) clearTimeout(outTimer);
  outTimer = null;
  out = null;
  if (!quiet) attach();
}

/**
 * On the GM's screen: who has rolled, and what. The line is marked the moment
 * the message arrives; the number waits for the dice to land, as every result
 * on the rail does — the GM reading a total before the table has watched the
 * dice is the panel spoiling the roll.
 */
async function onMessage(message: any): Promise<void> {
  if (!game.user?.isGM || !out) return;
  const f = message?.flags?.[SYSTEM_ID] ?? {};
  const actorId = message?.speaker?.actor ?? null;
  const actor = actorId ? (game as any).actors?.get(actorId) : null;
  const author = message?.author ?? message?.user ?? null;
  const owned = !!(actor && author && actor.testUserPermission?.(author, "OWNER"));
  const call = out;
  if (!answersCall(call, { call: f.call, kind: f.kind, actorId, owned, at: Date.now() })) return;
  if (call.answered.has(actorId)) return;
  const seen = Date.now();
  call.answered.set(actorId, { seen, msg: message.id });
  attach();

  await new Promise((done) => setTimeout(done, 80));
  const dice = waitFor3dDice(message.id);
  if (dice) await dice;
  if (out !== call) return;
  call.answered.set(actorId, { seen, msg: message.id, ...readAnswer(message) });
  attach();
}

/** What an answering card says: its total and which die won. */
function readAnswer(message: any): { total?: number; out?: "hope" | "fear" | "crit" } {
  const plate = message?.flags?.[SYSTEM_ID]?.plate;
  const total = Number(plate?.total ?? message?.rolls?.[0]?.total);
  const outcome = ["hope", "fear", "crit"].includes(plate?.out) ? plate.out : undefined;
  return { ...(Number.isFinite(total) ? { total } : {}), ...(outcome ? { out: outcome } : {}) };
}

function onReroll(message: any): void {
  if (!game.user?.isGM || !out) return;
  for (const [actorId, a] of out.answered) {
    if (a.msg !== message?.id || a.total == null) continue;
    out.answered.set(actorId, { ...a, ...readAnswer(message) });
    attach();
  }
}

/* ── the player ───────────────────────────────────────────────────── */

/**
 * A payload arrives. `sender` is the server's word for who sent it, and the
 * only one read: a call is honoured only if that user is a GM and connected.
 */
function onSocket(payload: unknown, sender?: string): void {
  if (game.user?.isGM) return;
  const from = typeof sender === "string" ? (game as any).users?.get(sender) : null;
  const call = readCall(payload, { fromGM: !!(from?.isGM && from?.active), now: Date.now() });
  if (!call) return;
  if ("end" in call) {
    if (incoming?.id !== call.end) return;
    clearIncoming();
    return;
  }
  /* Only characters this client owns: the payload was addressed here, and a
     character it names that is not ours is not ours to answer for. */
  const mine = call.who.filter((id) => (game as any).actors?.get(id)?.isOwner);
  if (!mine.length) return;
  if (inTimer) clearTimeout(inTimer);
  incoming = { ...call, who: mine };
  fresh.clear();
  for (const id of mine) fresh.add(id);
  inTimer = setTimeout(clearIncoming, CALL_LIFE);
  placeBars();
}

function clearIncoming(): void {
  if (inTimer) clearTimeout(inTimer);
  inTimer = null;
  incoming = null;
  fresh.clear();
  placeBars();
}

/**
 * The rail when there is one; a rail-less root of our own otherwise, because a
 * player who switched the HUD off has still been asked for a roll.
 */
function barRoot(want: boolean): HTMLElement | null {
  const rail = railRoot();
  const solo = document.querySelector<HTMLElement>(".dh-call-solo-host");
  if (rail || !want) {
    solo?.remove();
    return rail;
  }
  if (solo) return solo.firstElementChild as HTMLElement;
  const wall = document.querySelector("#interface");
  if (!wall) return null;
  const host = document.createElement("div");
  host.className = "dh-call-solo-host";
  host.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:var(--z-index-app)";
  host.innerHTML = `<div class="dh bhud bh-call-solo" data-role="player" style="pointer-events:auto"></div>`;
  wall.append(host);
  return host.firstElementChild as HTMLElement;
}

function placeBars(): void {
  const now = Date.now();
  const bars = (incoming?.who ?? [])
    .map((id) => {
      const a = (game as any).actors?.get(id);
      const m = barModel(incoming, a ? { id: a.id, spellcast: a.system?.spellcastTrait } : null, now);
      return m && { ...m, actorId: id, name: a.name, fresh: fresh.has(id) };
    })
    .filter(Boolean) as any[];
  fresh.clear();
  for (const el of document.querySelectorAll(".bh-call-bars")) el.remove();
  const root = barRoot(bars.length > 0);
  if (!root || !bars.length) return;
  root.insertAdjacentHTML("beforeend", CALL_BARS(bars));
}

async function answer(btn: HTMLElement): Promise<void> {
  const id = btn.dataset.callRoll!;
  const a = (game as any).actors?.get(id);
  const call = incoming;
  const m = barModel(call, a ? { id: a.id, spellcast: a.system?.spellcastTrait } : null, Date.now());
  if (!a || !m?.trait) return;
  const spell = m.key === "spellcast";
  const res = await askRoll(a, m.trait, btn, {
    dc: m.dc ?? null,
    whisper: m.mode === "gm",
    call: m.id,
    ...(spell ? { label: "Spellcast", kind: `spellcast roll · ${traitLabel(m.trait).toLowerCase()}` } : {}),
  });
  /* Dismissing the popover is free, and the call is still standing. */
  if (!res || incoming?.id !== m.id) return;
  incoming = withoutAnswered(incoming, id);
  if (!incoming && inTimer) clearTimeout(inTimer);
  placeBars();
}

/* ── presses ──────────────────────────────────────────────────────── */

async function onClick(e: MouseEvent): Promise<void> {
  const t = e.target as HTMLElement | null;
  if (!t?.closest?.(".bhud")) return;

  const roll = t.closest<HTMLElement>("[data-call-roll]");
  if (roll) return void answer(roll);
  const dismiss = t.closest<HTMLElement>("[data-call-dismiss]");
  if (dismiss) {
    incoming = withoutAnswered(incoming, dismiss.dataset.callDismiss!);
    if (!incoming && inTimer) clearTimeout(inTimer);
    return placeBars();
  }

  if (!game.user?.isGM) return;
  if (t.closest('[data-act="call"]')) {
    panelOpen = !panelOpen;
    return attach();
  }
  if (t.closest('[data-act="call-end"]')) return endCall();
  const mode = t.closest<HTMLElement>("[data-call-mode]");
  if (mode) {
    compose.mode = modeOf(mode.dataset.callMode);
    return attach();
  }
  if (t.closest("[data-call-show]")) {
    compose.showDc = !compose.showDc;
    return attach();
  }
  if (t.closest("[data-call-all]")) {
    compose.who = [];
    return attach();
  }
  const who = t.closest<HTMLElement>("[data-call-who]");
  if (who) {
    const id = who.dataset.callWho!;
    compose.who = compose.who.includes(id) ? compose.who.filter((x) => x !== id) : [...compose.who, id];
    return attach();
  }
  const key = t.closest<HTMLElement>("[data-call-key]");
  if (key && key.getAttribute("aria-disabled") !== "true") sendCall(key.dataset.callKey!);
}

/** The Difficulty field keeps what is typed, digits only; nothing redraws while typing. */
function onInput(e: Event): void {
  const t = e.target as HTMLInputElement | null;
  if (!t?.matches?.("[data-call-dc]")) return;
  const clean = t.value.replace(/\D+/g, "").slice(0, 2);
  if (clean !== t.value) t.value = clean;
  compose.dc = clean;
}

/* Escape that closes the panel stops there, as the rail's own does
   (`escapeCloses`): Foundry's dismiss would also release the controlled token,
   and the GM's rail is drawn for that token. A key typed into somebody else's
   field is theirs. */
function onKey(e: KeyboardEvent): void {
  if (e.key !== "Escape" || !panelOpen || !game.user?.isGM || e.isComposing) return;
  /* Open but not drawn — the GM is on a PC's rail — is nothing to close. */
  if (!document.querySelector("[data-call-panel]")) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.("input, textarea, select, [contenteditable], .editor") && !t.closest(".bh-call-panel")) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  panelOpen = false;
  attach();
}

/** For `game.daggerheart.rollCall()`: what is out, what came in, and why nothing is showing. */
export function reportRollCall(): Record<string, unknown> {
  return {
    socket: SOCKET,
    gm: !!game.user?.isGM,
    panelOpen,
    compose: { ...compose, dcHeld: dcOf(compose.dc) },
    out: outNow(),
    incoming,
    rail: railRoot()?.dataset.role ?? null,
  };
}
