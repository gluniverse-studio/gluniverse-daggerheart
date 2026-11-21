/**
 * Calling for a roll: the half with no Foundry in it.
 *
 * Every one of these fails without a sign. A call honoured from a player is a
 * player putting a press on somebody else's rail; a hidden Difficulty in the
 * payload is a number sitting in every called player's socket where the
 * console can read it; a call for two characters delivered to the whole table
 * is the same, for the GM's choice of who; and an answer read off a forged
 * flag is a total the GM's panel believes. None of them draws anything wrong.
 *
 *   1. a call is honoured only when the host says the SERVER-attested sender
 *      is a GM, and nothing in the payload can stand in for that;
 *   2. the key is one of the seven, and nothing else survives either end;
 *   3. a hidden Difficulty never enters the payload;
 *   4. a call goes to the called characters' players and nobody else, each
 *      payload naming only that player's own characters, and no GM ever;
 *   5. a message answers a call only by the called character, rolled by
 *      somebody who owns it, inside the call's life, with the call's id;
 *   6. the panel's states, the verdict against a Difficulty that never left
 *      the GM's screen, and the grid's best-in-row.
 *
 * Negative-controlled: making `readCall` ignore `fromGM` fails (1); making
 * `makeCall` write the Difficulty whatever `showDc` says fails (3); dropping
 * the ownership test from `answersCall` fails (5).
 */

import assert from "node:assert/strict";
import {
  CALL_KEYS,
  CALL_LIFE,
  answersCall,
  barModel,
  callDone,
  callRecipients,
  callTargets,
  dcOf,
  makeCall,
  modeOf,
  outModel,
  partyGrid,
  readCall,
  traitOf,
  verdict,
  withoutAnswered,
} from "../src/module/roll-call.ts";

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};

const call = (o = {}) => ({ type: "call", id: "c1", key: "instinct", at: 1000, mode: "public", who: ["a1"], ...o });

console.log("who may call");

ok("a call from a sender the host does not attest as a GM is nothing", () => {
  assert.equal(readCall(call(), { fromGM: false }), null);
  assert.equal(readCall(call()), null);
  assert.equal(readCall({ type: "end", id: "c1" }, { fromGM: false }), null);
});

ok("the payload's own word for its sender is never read", () => {
  for (const claim of [{ sender: "gm" }, { from: "gm", isGM: true }, { userId: "gm", gm: true }]) {
    assert.equal(readCall(call(claim), { fromGM: false }), null);
  }
  const got = readCall(call({ sender: "gm", isGM: true }), { fromGM: true, now: 5 });
  assert.deepEqual(Object.keys(got).sort(), ["id", "key", "mode", "until", "who"]);
});

ok("a GM's call arrives whole, and lives for CALL_LIFE", () => {
  const got = readCall(call({ dc: 14 }), { fromGM: true, now: 100 });
  assert.deepEqual(got, { id: "c1", key: "instinct", mode: "public", who: ["a1"], until: 100 + CALL_LIFE, dc: 14 });
  assert.deepEqual(readCall({ type: "end", id: "c1" }, { fromGM: true }), { end: "c1" });
});

console.log("what a call may name");

ok("the key is one of the six traits or Spellcast, at both ends", () => {
  assert.deepEqual([...CALL_KEYS], ["agility", "strength", "finesse", "instinct", "presence", "knowledge", "spellcast"]);
  for (const bad of ["perception", "<img src=x onerror=alert(1)>", "", null, 3, "__proto__", "Agility"]) {
    assert.equal(makeCall({ key: bad, id: "x", at: 1, who: ["a"] }), null, String(bad));
    assert.equal(readCall(call({ key: bad }), { fromGM: true }), null, String(bad));
  }
});

ok("a call naming nobody, or malformed, is nothing", () => {
  assert.equal(readCall(call({ who: [] }), { fromGM: true }), null);
  assert.equal(readCall(call({ who: "a1" }), { fromGM: true }), null);
  assert.equal(readCall(call({ id: 7 }), { fromGM: true }), null);
  assert.equal(readCall("call", { fromGM: true }), null);
  assert.equal(readCall({ ...call(), type: "roll" }, { fromGM: true }), null);
});

ok("an unknown mode is the open roll; blind is not a mode here", () => {
  assert.equal(modeOf("gm"), "gm");
  for (const m of ["blind", "self", "ic", undefined]) assert.equal(modeOf(m), "public");
  assert.equal(readCall(call({ mode: "blind" }), { fromGM: true }).mode, "public");
});

ok("a Difficulty is a whole number in range or nothing", () => {
  assert.equal(dcOf("14"), 14);
  assert.equal(dcOf(12.7), 12);
  for (const bad of ["", " ", null, undefined, "0", "41", "abc", -3]) assert.equal(dcOf(bad), null, String(bad));
});

console.log("the hidden Difficulty");

ok("hidden, the Difficulty is not in the payload at all", () => {
  const c = makeCall({ key: "agility", dc: 15, showDc: false, who: ["a1"], id: "c", at: 1 });
  assert.equal("dc" in c, false);
  assert.equal(JSON.stringify(c).includes("15"), false);
});

ok("shown, it rides the payload; shown and unreadable, it does not", () => {
  assert.equal(makeCall({ key: "agility", dc: "15", showDc: true, who: ["a1"], id: "c", at: 1 }).dc, 15);
  assert.equal("dc" in makeCall({ key: "agility", dc: "x", showDc: true, who: ["a1"], id: "c", at: 1 }), false);
});

console.log("who hears it");

const users = [
  { id: "gm", active: true, isGM: true, character: null, owns: () => true },
  { id: "pa", active: true, isGM: false, character: "a1", owns: (id) => id === "a1" || id === "c1" },
  { id: "pb", active: true, isGM: false, character: "a2", owns: (id) => id === "a2" },
  { id: "pc", active: false, isGM: false, character: "a3", owns: (id) => id === "a3" },
  /* A co-owner of a1 with a character of their own elsewhere. */
  { id: "pd", active: true, isGM: false, character: "a9", owns: (id) => id === "a1" },
];

ok("no pick is the whole party; a pick names only the party", () => {
  const m = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
  assert.deepEqual(callTargets(m, []), ["a1", "a2", "a3"]);
  assert.deepEqual(callTargets(m, ["a2", "zz"]), ["a2"]);
  assert.deepEqual(callTargets(m, ["zz"]), ["a1", "a2", "a3"]);
});

ok("the assigned player hears their character, and a co-owner does not", () => {
  const { to } = callRecipients(["a1"], users);
  assert.deepEqual([...to], [["pa", ["a1"]]]);
});

ok("with no assigned player connected, the connected owners hear it", () => {
  const { to, away } = callRecipients(["c1"], users);
  assert.deepEqual([...to], [["pa", ["c1"]]]);
  assert.deepEqual(away, []);
});

ok("nobody connected is away, and a GM is never a recipient", () => {
  const { to, away } = callRecipients(["a1", "a2", "a3"], users);
  assert.deepEqual(away, ["a3"]);
  assert.equal(to.has("gm"), false);
  assert.equal(to.has("pc"), false);
});

ok("each player's payload names only their own characters", () => {
  const { to } = callRecipients(["a1", "c1", "a2"], users);
  const payloads = new Map([...to].map(([u, who]) => [u, makeCall({ key: "presence", who, id: "c", at: 1 })]));
  assert.deepEqual(payloads.get("pa").who, ["a1", "c1"]);
  assert.deepEqual(payloads.get("pb").who, ["a2"]);
  assert.equal(JSON.stringify(payloads.get("pb")).includes("a1"), false);
});

console.log("the answer");

const out = (o = {}) => ({
  id: "c1",
  key: "agility",
  at: 1000,
  mode: "public",
  dc: 14,
  shown: false,
  until: 1000 + CALL_LIFE,
  targets: ["a1", "a2", "a3"],
  away: ["a3"],
  users: ["pa", "pb"],
  answered: new Map(),
  ...o,
});
const msg = (o = {}) => ({ call: "c1", kind: "duality", actorId: "a1", owned: true, at: 2000, ...o });

ok("a duality roll by a called character, owned by its author, with the call's id, answers", () => {
  assert.equal(answersCall(out(), msg()), true);
});

ok("a forged or stray message does not", () => {
  assert.equal(answersCall(out(), msg({ call: "c2" })), false, "another call");
  assert.equal(answersCall(out(), msg({ call: undefined })), false, "no call");
  assert.equal(answersCall(out(), msg({ actorId: "zz" })), false, "not called");
  assert.equal(answersCall(out(), msg({ owned: false })), false, "author does not own it");
  assert.equal(answersCall(out(), msg({ kind: "damage" })), false, "not a duality roll");
  assert.equal(answersCall(out(), msg({ at: 999 })), false, "before the call");
  assert.equal(answersCall(out(), msg({ at: 1001 + CALL_LIFE })), false, "after it lapsed");
  assert.equal(answersCall(null, msg()), false, "no call out");
});

ok("a critical succeeds whatever the number; meeting it beats it; no Difficulty is no verdict", () => {
  assert.equal(verdict(3, "crit", 20), "success");
  assert.equal(verdict(14, "fear", 14), "success");
  assert.equal(verdict(13, "hope", 14), "failure");
  assert.equal(verdict(30, "hope", null), null);
  assert.equal(verdict(undefined, "hope", 14), null);
});

ok("the panel waits, holds the total while the dice roll, then reads it against the hidden number", () => {
  const o = out();
  const members = [{ id: "a1", name: "Bex" }, { id: "a2", name: "Orrin" }, { id: "a3", name: "Thane" }];
  let m = outModel(o, members, 2000);
  assert.deepEqual(m.targets.map((t) => t.state), ["wait", "wait", "away"]);
  assert.equal(m.of, 2);
  assert.equal(m.n, 0);
  o.answered.set("a1", { seen: 2000 });
  m = outModel(o, members, 2000);
  assert.equal(m.targets[0].state, "rolling");
  assert.equal("total" in m.targets[0], false);
  assert.equal(m.n, 1);
  o.answered.set("a1", { seen: 2000, total: 15, out: "fear" });
  o.answered.set("a2", { seen: 2100, total: 9, out: "hope" });
  m = outModel(o, members, 2200);
  assert.deepEqual(
    m.targets.slice(0, 2).map((t) => [t.state, t.total, t.out, t.verdict]),
    [["in", 15, "fear", "success"], ["in", 9, "hope", "failure"]],
  );
  assert.equal(m.left, CALL_LIFE - 1200);
  assert.equal(callDone(o), true);
});

console.log("the player's rail");

ok("a bar is drawn only for a called character, while the call stands", () => {
  const c = readCall(call({ key: "knowledge", dc: 12, who: ["a1", "a2"] }), { fromGM: true, now: 0 });
  const bar = barModel(c, { id: "a1" }, 1000);
  assert.equal(bar.trait, "knowledge");
  assert.equal(bar.label, "Knowledge");
  assert.equal(bar.dc, 12);
  assert.equal(bar.left, CALL_LIFE - 1000);
  assert.equal(barModel(c, { id: "zz" }, 1000), null);
  assert.equal(barModel(c, { id: "a1" }, CALL_LIFE + 1), null);
});

ok("Spellcast resolves per character, and a character with none cannot answer it", () => {
  const c = readCall(call({ key: "spellcast" }), { fromGM: true, now: 0 });
  assert.equal(barModel(c, { id: "a1", spellcast: "instinct" }, 1).trait, "instinct");
  assert.equal(barModel(c, { id: "a1", spellcast: null }, 1).trait, null);
  assert.equal(traitOf("spellcast", "spellcast"), null);
  assert.equal(traitOf("finesse", null), "finesse");
});

ok("answering one character leaves the others owed", () => {
  const c = readCall(call({ who: ["a1", "c1"] }), { fromGM: true, now: 0 });
  assert.deepEqual(withoutAnswered(c, "a1").who, ["c1"]);
  assert.equal(withoutAnswered(withoutAnswered(c, "a1"), "c1"), null);
});

console.log("the grid");

ok("the best in a row is marked, every holder of it, and a flat row marks nobody", () => {
  const g = partyGrid([
    { id: "a1", name: "Bex", mods: { agility: 2, strength: 0, spellcast: null } },
    { id: "a2", name: "Orrin", mods: { agility: 2, strength: 0, spellcast: 1 } },
    { id: "a3", name: "Thane", mods: { agility: -1, strength: 0, spellcast: 2 } },
  ]);
  const row = (k) => g.rows.find((r) => r.key === k).cells.map((c) => [c.mod, c.best]);
  assert.deepEqual(row("agility"), [[2, true], [2, true], [-1, false]]);
  assert.deepEqual(row("strength"), [[0, false], [0, false], [0, false]]);
  assert.deepEqual(row("spellcast"), [[null, false], [1, false], [2, true]]);
  assert.equal(g.rows.length, 7);
});

console.log(`\n${n} roll-call assertions passed`);
