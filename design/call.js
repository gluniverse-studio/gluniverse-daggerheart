// Calling for a roll — the GM's panel and the bar a call puts on a rail.
//
// "Everybody make an Instinct Roll", said once, by the GM, and answered by a
// press on every called character's rail rather than by four people going to
// find the trait on four sheets. The rules about who hears it and what it may
// carry are `src/module/roll-call.ts`; this file draws the three objects and
// says nothing about what a press does.
//
//   CALL_PRESS   the GM's door, at the foot of the party stack: one line
//                saying "call for a roll", or, while a call is out, the trait
//                and how many have answered, with a foot that drains
//   CALL_PANEL   the sentence being composed — to whom (the column heads;
//                nobody picked is everybody), posted how, against what
//                Difficulty and whether the table is told it — over a grid of
//                every party character's seven numbers, whose row heads send
//   CALL_BAR     what lands on a player's rail: the trait at display size,
//                the Difficulty in the rules' own diamond when the GM showed
//                it, a Roll press, a dismiss, and a foot that drains by the
//                time left
//
// Every name is `bh-call`-prefixed: it lives inside the rail's `.bhud` root
// and takes the rail's button reset with it, and nothing else in the ported
// stack begins with those letters. Gestures attach to data-* handles:
// [data-act="call"], [data-act="call-end"], [data-call-key],
// [data-call-who], [data-call-all], [data-call-mode], [data-call-show],
// [data-call-dc], [data-call-roll], [data-call-dismiss].

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* Foundry's plain-text tooltip, as hud.js's tip(): a native title would open beside it. */
const tip = s => s ? ` data-tooltip-text="${esc(s)}"` : '';
const sign = n => n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';

/* The door's mark: a speech line with a die face in it. Authored on the
   rail's 16 grid at its 1.6 stroke, like every icon on the rail. */
const MARK = `<svg class="bh-ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/><path d="M8 5.2 10 7 8 8.8 6 7z"/></svg>`;

/* The time left, as a running animation that starts where the clock already
   is. A host that re-attaches an element restarts its animations, so the
   delay is recomputed every time the markup is made and the drain carries
   on rather than refilling. */
export const drain = (o) => `--bh-call-life:${Math.round(o.life)}ms;--bh-call-gone:${Math.round(Math.max(0, o.life - o.left))}ms`;
const FOOT = (o) => `<i class="bh-call-foot" aria-hidden="true" style="${drain(o)}"></i>`;

/* ── the door ─────────────────────────────────────────────────── */
export const CALL_PRESS = ({ out = null, open = false } = {}) => `
<button type="button" class="bh-call-press${out ? ' is-out' : ''}" data-act="call" aria-expanded="${open}"
  ${tip(out ? `${out.label} — ${out.n} of ${out.of} answered` : 'Call for a roll')}>
  ${MARK}<b>${out ? esc(out.label) : 'Call for a roll'}</b>${out ? `<span>${out.n}/${out.of}</span>${FOOT(out)}` : ''}
</button>`;

/* ── the call that is out ─────────────────────────────────────── */
const OUTCOME = { hope: 'with Hope', fear: 'with Fear', crit: 'Critical' };
const stateText = (t) =>
  t.state === 'wait' ? 'Waiting' :
  t.state === 'away' ? 'Away' :
  t.state === 'rolling' ? 'Rolling' :
  `${OUTCOME[t.out] ?? 'Rolled'}${t.verdict ? ` · ${t.verdict === 'success' ? 'Success' : 'Failure'}` : ''}`;

const OUT = (o) => `
<div class="bh-call-out" data-call-out>
  <div class="bh-call-head">
    <b class="bh-call-big">${esc(o.label)}</b>
    <span>${o.mode === 'gm' ? 'GM only' : 'Open'}${o.dc != null ? ` · Difficulty ${o.dc}${o.shown ? '' : ', hidden'}` : ' · no Difficulty'}</span>
    <em>${o.n}/${o.of}</em>
    <button type="button" class="bh-call-end" data-act="call-end">${o.of && o.n >= o.of ? 'Clear' : 'Withdraw'}</button>
  </div>
  <ul class="bh-call-list">${o.targets.map(t => `
    <li data-state="${t.state}"${t.verdict ? ` data-verdict="${t.verdict}"` : ''}>
      <b>${esc(t.name)}</b><span${t.out ? ` data-out="${t.out}"` : ''}>${stateText(t)}</span>${t.total != null ? `<em>${t.total}</em>` : ''}
    </li>`).join('')}
  </ul>
  ${FOOT(o)}
</div>`;

/* ── the panel ────────────────────────────────────────────────── */
/* The sentence reads left to right — posted how, against what — and then the
   grid answers to whom and what: a column head picks a character (none picked
   is everybody), a row head sends. A cell is the number that character's roll
   opens at; the best in a row is underlined, and a row where everybody is
   equal underlines nobody. The grid is divs and not a table, because Foundry's
   elements layer dresses every table cell in somebody else's borders. */
const first = (name) => String(name ?? '').split(/\s+/)[0] || '—';

export const CALL_PANEL = ({ grid, compose = {}, out = null }) => {
  const who = compose.who ?? [];
  const mode = compose.mode === 'gm' ? 'gm' : 'public';
  const n = grid.members.length;
  return `
<section class="bh-call-panel" role="dialog" aria-label="Call for a roll" data-call-panel>
  <header><b>Call for a roll</b><span>${n ? 'Pick who, then press a trait to send it' : 'Nobody in the party to call'}</span></header>
  ${out ? OUT(out) : ''}
  <div class="bh-call-how">
    <div class="bh-call-seg" role="group" aria-label="Who sees the result">
      <button type="button" class="bh-call-opt${mode === 'public' ? ' on' : ''}" data-call-mode="public" aria-pressed="${mode === 'public'}"${tip('Posted to the table')}>Open</button>
      <button type="button" class="bh-call-opt${mode === 'gm' ? ' on' : ''}" data-call-mode="gm" aria-pressed="${mode === 'gm'}"${tip('Only the roller and the GM see the card')}>GM only</button>
    </div>
    <label class="bh-call-dc"><span>Difficulty</span><input type="text" inputmode="numeric" maxlength="2" placeholder="—" data-call-dc value="${esc(compose.dc ?? '')}" aria-label="Difficulty"></label>
    <button type="button" class="bh-call-opt bh-call-show${compose.showDc ? ' on' : ''}" data-call-show aria-pressed="${!!compose.showDc}"
      ${tip(compose.showDc ? 'The players see the Difficulty and their card is judged against it' : 'The Difficulty stays on this screen; their card says there was none')}>${compose.showDc ? 'Shown' : 'Hidden'}</button>
  </div>
  <div class="bh-call-grid" role="table" aria-label="The party's traits" style="--n:${n}">
    <div class="bh-call-row is-head" role="row">
      <span role="columnheader"><button type="button" class="bh-call-who${who.length ? '' : ' on'}" data-call-all aria-pressed="${!who.length}">Everyone</button></span>${grid.members.map(m => `
      <span role="columnheader"><button type="button" class="bh-call-who${who.includes(m.id) ? ' on' : ''}" data-call-who="${esc(m.id)}" aria-pressed="${who.includes(m.id)}"${tip(m.name)}>${esc(first(m.name))}</button></span>`).join('')}
    </div>${grid.rows.map(r => `
    <div class="bh-call-row" role="row">
      <span role="rowheader"><button type="button" class="bh-call-key" data-call-key="${r.key}"${n ? '' : ' aria-disabled="true"'}${tip(`Call for ${r.label}`)}>${esc(r.label)}</button></span>${r.cells.map(c => `
      <span role="cell" class="bh-call-cell${c.best ? ' is-best' : ''}${c.mod == null ? ' is-none' : ''}">${c.mod == null ? '—' : sign(c.mod)}</span>`).join('')}
    </div>`).join('')}
  </div>
</section>`;
};

/* ── the bar ──────────────────────────────────────────────────── */
/* Ink, with the paper edge every other quiet claim on this rail wears; the
   colours here are already spoken for. The trait is the one thing set large,
   because it is the one thing the player has to act on. The Difficulty is the
   adversary panel's diamond — the rules' own shape for that number — and is
   drawn only when the GM showed it. A private call says who will see the
   result on the line above the trait, because a player choosing an Experience
   to spend should know whether the table is watching. */
export const CALL_BAR = (o) => `
<div class="bh-call-bar${o.fresh ? ' is-new' : ''}" data-call-bar="${esc(o.actorId)}" role="group" aria-label="The GM calls for ${esc(o.label)}${o.name ? ` from ${esc(o.name)}` : ''}">
  <div class="bh-call-says">
    <span>${o.name ? `${esc(o.name)} · ` : ''}${o.mode === 'gm' ? 'only you and the GM will see the result' : 'the GM calls for a roll'}</span>
    <b class="bh-call-big">${esc(o.label)}</b>
  </div>
  ${o.dc != null ? `<div class="bh-call-diff" role="img" aria-label="Difficulty ${o.dc}"><span>${o.dc}</span></div>` : ''}
  ${o.trait
    ? `<button type="button" class="bh-call-roll" data-call-roll="${esc(o.actorId)}">Roll</button>`
    : `<span class="bh-call-cant">No Spellcast trait</span>`}
  <button type="button" class="bh-call-x" data-call-dismiss="${esc(o.actorId)}" aria-label="Dismiss the call"${tip('Dismiss')}>×</button>
  ${FOOT(o)}
</div>`;

export const CALL_BARS = (bars) => bars.length
  ? `<div class="bh-call-bars" aria-live="polite">${bars.map(CALL_BAR).join('')}</div>`
  : '';
