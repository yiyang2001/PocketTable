// 游戏模块与引擎之间的契约。只用于类型检查（tsc --noEmit），运行时不加载。

export type Seat = number;

export interface Rng {
  /** [0, 1) */
  next(): number;
  /** [0, n) 的整数 */
  int(n: number): number;
  pick<T>(arr: readonly T[]): T;
  /** 返回打乱后的新数组，不改原数组 */
  shuffle<T>(arr: readonly T[]): T[];
  save(): number[];
  restore(state: number[]): void;
}

export interface SeatInfo {
  seat: Seat;
  name: string;
  bot: boolean;
}

export interface GameEvent {
  type: string;
  [key: string]: any;
}

export interface Ctx<O = any> {
  rng: Rng;
  /** 引擎给的"当前时间"（毫秒）。游戏里禁止用 Date.now()，否则无法重放。 */
  now: number;
  seats: SeatInfo[];
  options: O;
  /** 发事件；to 指定时只发给那个座位 */
  emit(evt: GameEvent, opts?: { to?: Seat }): void;
}

/** 参数类型：'string' | 'number' | 'int' | 'boolean' | 'seat' | 'string[]' | 'int[]' | 'any'，末尾加 ? 表示可选 */
export type ArgSpec = Record<string, string>;

export interface MoveDef<S = any, O = any> {
  args: ArgSpec;
  /** 不在 actors 里也能出（例如"不要！"、猜词） */
  anytime?: boolean;
  /** 直接改 s（引擎给的是草稿）。返回字符串 = 非法，草稿整份丢弃。 */
  apply(s: S, seat: Seat, args: any, ctx: Ctx<O>): string | void;
}

export type OptionDef =
  | { type: 'enum'; values: (string | number)[]; default: string | number; label?: string }
  | { type: 'int'; min: number; max: number; default: number; label?: string };

export interface Result {
  winners: Seat[];
  ranking?: Seat[];
  summary?: string;
}

export interface LegalMove {
  name: string;
  args: any;
}

export interface GameDef<S = any, O = any> {
  id: string;
  name: string;
  /** 规则改动时 +1，旧记录不再按新规则重放 */
  rulesVersion: number;
  players: { min: number; max: number };
  options?: Record<string, OptionDef>;

  setup(ctx: Ctx<O>): S;
  moves: Record<string, MoveDef<S, O>>;
  actors(s: S): Seat[];

  deadline?(s: S): number | null;
  onTimeout?(s: S, ctx: Ctx<O>): string | void;

  tickHz?: number;
  tick?(s: S, ctx: Ctx<O>): string | void;
  /** 高频出招：不立刻广播，合并后再发 */
  ephemeral?: string[];

  view(s: S, seat: Seat | null): any;
  result(s: S): Result | null;

  legalMoves?(s: S, seat: Seat): LegalMove[];
  invariants?(s: S): void;
  /** 此刻 seat 不应该看到的字符串（例如别人手牌的 id），随机测试用它查泄露 */
  secrets?(s: S, seat: Seat): string[];
}

export interface BotDef {
  decide(view: any, seat: Seat, rng: Rng): LegalMove | null;
}

export interface RecordEntry {
  t: number;
  seat?: Seat;
  move?: string;
  args?: any;
  timeout?: true;
  tick?: true;
}

export interface MatchRecord {
  game: string;
  rulesVersion: number;
  seed: string;
  options: any;
  seats: SeatInfo[];
  startedAt: number;
  log: RecordEntry[];
}

export interface QueuedEvent {
  evt: GameEvent;
  to: Seat | null;
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  events?: QueuedEvent[];
  ephemeral?: boolean;
}
