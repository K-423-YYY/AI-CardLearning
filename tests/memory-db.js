class MemoryDB {
  constructor() {
    this.data = {};
  }

  async all(store) {
    return (this.data[store] || []).map((r) => ({ ...r }));
  }

  async get(store, id) {
    const row = (this.data[store] || []).find((r) => r.id === id);
    return row ? { ...row } : undefined;
  }

  async put(store, row) {
    const arr = this.data[store] || (this.data[store] = []);
    const idx = arr.findIndex((r) => r.id === row.id);
    if (idx >= 0) arr[idx] = { ...row };
    else arr.push({ ...row });
    return { ...row };
  }

  async delete(store, id) {
    this.data[store] = (this.data[store] || []).filter((r) => r.id !== id);
  }

  async clear(store) {
    this.data[store] = [];
  }

  async count(store) {
    return (this.data[store] || []).length;
  }

  async where(store, predicate) {
    return (this.data[store] || []).filter(predicate).map((r) => ({ ...r }));
  }

  async byIndex(store, indexName, value) {
    return (this.data[store] || []).filter((r) => r[indexName] === value).map((r) => ({ ...r }));
  }

  async nextId(store) {
    const rows = this.data[store] || [];
    return rows.reduce((max, r) => Math.max(max, typeof r.id === 'number' ? r.id : 0), 0) + 1;
  }

  async insert(store, row) {
    if (row.id === undefined || row.id === null || row.id === '') {
      row.id = await this.nextId(store);
    }
    return this.put(store, row);
  }
}

module.exports = MemoryDB;
