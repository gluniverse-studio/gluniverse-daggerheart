/**
 * Types for the vendored `design/call.js`, in a file of their own rather than
 * in `ui/ui.d.ts`: the call is one feature with one seam, and its contract
 * reads best beside the host that is its only caller.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "*/ui/call.js" {
  /** The CSS custom properties that start a drain where the clock already is. */
  export function drain(o: { left: number; life: number }): string;
  /** The GM's door, at the foot of the party stack. */
  export function CALL_PRESS(opts?: { out?: any; open?: boolean }): string;
  /** The GM's panel: how, against what, to whom, and the grid whose row heads send. */
  export function CALL_PANEL(opts: {
    grid: { members: { id: string; name: string; img: string | null }[]; rows: any[] };
    compose?: { who?: string[]; mode?: string; dc?: string; showDc?: boolean };
    out?: any;
  }): string;
  /** One called character's bar on a player's rail. */
  export function CALL_BAR(opts: any): string;
  /** Every bar, in the container that stands them above the rail. */
  export function CALL_BARS(bars: any[]): string;
}
