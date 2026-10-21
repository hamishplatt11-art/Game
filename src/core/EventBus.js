export class EventBus {
  constructor() {
    this.handlers = new Map();
  }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }
  emit(type, payload = {}) {
    const set = this.handlers.get(type);
    if (set) for (const fn of set) fn(payload);
    const all = this.handlers.get('*');
    if (all) for (const fn of all) fn(type, payload);
  }
  clear() {
    this.handlers.clear();
  }
}
