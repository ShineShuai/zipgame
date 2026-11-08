// Command-line options declared once: parsing, checking and --help come from the same table, so
// the documentation cannot miss an option and a typo (--bot for --boot) is an error, not silently
// ignored.
//   const { values, rest } = cli({
//     usage: 'node tools/x.mjs rows.json [options]',
//     summary: 'what the tool does',
//     positional: [{ name: 'rows.json', help: 'what it is', required: true }],
//     options: { boot: { type: 'int', arg: 'N', min: 1, default: 400, help: 'what it means' } },
//   });
// type: 'string' | 'number' | 'int' | 'flag' (no value) | 'list' (repeatable, array of strings);
// min / max (numbers), choices (strings), required, default, defaultText (shown instead of
// default). `--name value` and `--name=value` both work; options and positional arguments may
// come in any order.
import { DEFAULT_EVAL_CAP } from './lib.mjs';

export class ArgsError extends Error {}

// the node budget shared by the tools that solve puzzles (lib.mjs evalCap)
export const capOption = {
  type: 'int', arg: 'NODES', min: 1, default: DEFAULT_EVAL_CAP,
  help: 'solver budget per puzzle, in nodes (the solution path and the legacy metrics); a ' +
    'puzzle that still hits it is reported, never silently graded',
};

function convert(name, def, text) {
  if (def.type === 'string' || def.type === 'list') {
    if (def.choices && !def.choices.includes(text)) {
      throw new ArgsError(`--${name} must be one of ${def.choices.join(', ')} (got ${text})`);
    }
    return text;
  }
  const v = text.trim() === '' ? NaN : Number(text);
  if (!Number.isFinite(v)) throw new ArgsError(`--${name} needs a number (got ${text})`);
  if (def.type === 'int' && !Number.isInteger(v)) {
    throw new ArgsError(`--${name} needs a whole number (got ${text})`);
  }
  if (def.min !== undefined && v < def.min) {
    throw new ArgsError(`--${name} must be at least ${def.min}`);
  }
  if (def.max !== undefined && v > def.max) {
    throw new ArgsError(`--${name} must be at most ${def.max}`);
  }
  return v;
}

// -> { values, rest, help }: values by option name (defaults filled in), rest = the positional
// arguments, help = --help / -h was given. Throws ArgsError for anything wrong.
export function parseArgs(argv, spec) {
  const options = spec.options || {}, values = {}, rest = [];
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--help' || tok === '-h') { help = true; continue; }
    if (!tok.startsWith('--')) { rest.push(tok); continue; }
    const eq = tok.indexOf('='), name = tok.slice(2, eq < 0 ? undefined : eq), def = options[name];
    if (!def) throw new ArgsError(`unknown option --${name}`);
    if (def.type === 'flag') {
      if (eq >= 0) throw new ArgsError(`--${name} takes no value`);
      values[name] = true;
      continue;
    }
    const text = eq >= 0 ? tok.slice(eq + 1) : argv[++i];
    if (text === undefined || (eq < 0 && text.startsWith('--'))) {
      throw new ArgsError(`--${name} needs a value (${def.arg || 'VALUE'})`);
    }
    const v = convert(name, def, text);
    if (def.type === 'list') (values[name] ||= []).push(v);
    else values[name] = v;
  }
  if (help) return { values, rest, help };
  for (const [name, def] of Object.entries(options)) {
    if (values[name] === undefined && def.default !== undefined) values[name] = def.default;
    if (values[name] === undefined && def.required) throw new ArgsError(`--${name} is required`);
  }
  const positional = spec.positional || [];
  positional.forEach((p, k) => {
    if (p.required && rest[k] === undefined) throw new ArgsError(`${p.name} is required`);
  });
  if (rest.length > positional.length) {
    throw new ArgsError(`unexpected argument ${rest[positional.length]}`);
  }
  return { values, rest, help };
}

const wrap = (text, width) => {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) { lines.push(line); line = word; }
    else line = line ? line + ' ' + word : word;
  }
  return line ? [...lines, line] : lines;
};

export function helpText(spec) {
  const out = [`usage: ${spec.usage}`];
  if (spec.summary) out.push('', ...wrap(spec.summary, 98));
  const rows = [];
  for (const p of spec.positional || []) rows.push([p.name, p.help || '']);
  for (const [name, def] of Object.entries(spec.options || {})) {
    const left = '--' + name + (def.type === 'flag' ? '' : ' ' + (def.arg || 'VALUE'));
    const dflt = def.defaultText ?? (def.default !== undefined ? String(def.default) : null);
    const extra = [
      def.choices ? `one of ${def.choices.join(' | ')}` : null, def.required ? 'required' : null,
      def.type === 'list' ? 'may be repeated' : null, dflt !== null ? `default ${dflt}` : null,
    ];
    const tail = extra.filter(Boolean).join('; ');
    rows.push([left, def.help + (tail ? ` (${tail})` : '')]);
  }
  const width = Math.max(...rows.map(r => r[0].length)) + 2;
  out.push('', 'arguments and options:');
  for (const [left, text] of rows) {
    const lines = wrap(text, 98 - width - 2);
    out.push(`  ${left.padEnd(width)}${lines[0] || ''}`);
    for (const l of lines.slice(1)) out.push(`  ${' '.repeat(width)}${l}`);
  }
  return out.join('\n');
}

// parseArgs for a command line: --help prints the help and exits 0; a mistake prints the reason
// and a hint and exits 1.
export function cli(spec, argv = process.argv.slice(2)) {
  try {
    const parsed = parseArgs(argv, spec);
    if (parsed.help) {
      console.log(helpText(spec));
      process.exit(0);
    }
    return parsed;
  } catch (e) {
    if (!(e instanceof ArgsError)) throw e;
    console.error(`${spec.usage.split(' ')[1] || 'error'}: ${e.message} (see --help)`);
    process.exit(1);
  }
}
