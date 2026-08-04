(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./storage.js'));
  } else {
    root.LocalDB = factory(root.LocalStorage);
  }
})(typeof self !== 'undefined' ? self : this, function (storage) {
  async function nextId(storeName) {
    const rows = await storage.all(storeName);
    let max = 0;
    rows.forEach((row) => {
      const n = typeof row.id === 'number' ? row.id : 0;
      if (n > max) max = n;
    });
    return max + 1;
  }

  async function insert(storeName, row) {
    if (row.id === undefined || row.id === null || row.id === '') {
      row.id = await nextId(storeName);
    }
    await storage.put(storeName, row);
    return row;
  }

  async function where(storeName, predicate) {
    const rows = await storage.all(storeName);
    return rows.filter(predicate);
  }

  async function byIndex(storeName, indexName, value) {
    return storage.byIndex(storeName, indexName, value);
  }

  return {
    all: storage.all, get: storage.get, put: storage.put,
    delete: storage.delete, clear: storage.clear, count: storage.count,
    where, byIndex, nextId, insert
  };
});
