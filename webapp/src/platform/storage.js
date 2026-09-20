// Storage port: async get(key) -> {value}|null, set(key, value). Swap the implementation per platform (wx.setStorage, native, ...).
const mem = new Map();
const memory = { name: 'memory', shared: false, async get(k) { return mem.has(k) ? { value: mem.get(k) } : null; }, async set(k, v) { mem.set(k, v); } };
const local = {
  name: 'localStorage', shared: false,
  async get(k) { try { const v = localStorage.getItem(k); return v == null ? null : { value: v }; } catch { return null; } },
  async set(k, v) { try { localStorage.setItem(k, v); } catch { /* quota / disabled */ } },
};
export async function pickStorage() {
  try { localStorage.setItem('__probe__', '1'); localStorage.removeItem('__probe__'); return local; } catch { return memory; }
}
