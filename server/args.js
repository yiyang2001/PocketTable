'use strict';
// 出招参数校验。游戏在 moves.<name>.args 里声明格式，引擎在调用 apply 之前统一检查，
// 所以游戏代码可以假设参数类型正确。

const MAX_STR = 200;
const MAX_ARR = 200;

/** @type {Record<string, (v: any) => boolean>} */
const CHECKS = {
  string: (v) => typeof v === 'string' && v.length <= MAX_STR,
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  int: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  seat: (v) => Number.isInteger(v) && v >= 0 && v < 64,
  'string[]': (v) => Array.isArray(v) && v.length <= MAX_ARR && v.every(CHECKS.string),
  'int[]': (v) => Array.isArray(v) && v.length <= MAX_ARR && v.every(CHECKS.int),
  any: () => true,
};

/**
 * @param {import('./types').ArgSpec} spec
 * @param {any} args
 * @returns {string | null} 错误键，合法时为 null
 */
function checkArgs(spec, args) {
  if (args === undefined || args === null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) return 'err.bad_args';
  for (const key of Object.keys(args)) {
    if (!Object.prototype.hasOwnProperty.call(spec, key)) return 'err.bad_args';
  }
  for (const [key, raw] of Object.entries(spec)) {
    const optional = raw.endsWith('?');
    const type = optional ? raw.slice(0, -1) : raw;
    const check = CHECKS[type];
    if (!check) throw new Error(`未知的参数类型 "${raw}"`);
    const v = args[key];
    if (v === undefined) {
      if (optional) continue;
      return 'err.bad_args';
    }
    if (!check(v)) return 'err.bad_args';
  }
  return null;
}

/**
 * 校验并补全房间选项。
 * @param {Record<string, import('./types').OptionDef> | undefined} defs
 * @param {Record<string, any>} [given]
 */
function resolveOptions(defs, given = {}) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [key, def] of Object.entries(defs || {})) {
    const v = given[key];
    out[key] = optionValid(def, v) ? v : def.default;
  }
  return out;
}

/**
 * @param {import('./types').OptionDef} def
 * @param {any} v
 */
function optionValid(def, v) {
  if (def.type === 'enum') return def.values.includes(v);
  return Number.isInteger(v) && v >= def.min && v <= def.max;
}

module.exports = { checkArgs, resolveOptions, optionValid };
