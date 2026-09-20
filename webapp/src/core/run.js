// Drive a generator (function*) to completion synchronously. Returns its return value.
export function runSync(gen, onEvent) { for (let r = gen.next(); ; r = gen.next()) { if (r.done) return r.value; if (onEvent && r.value) onEvent(r.value); } }
