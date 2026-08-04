(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.LocalStorage = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DB_NAME = 'ai-learn-local';
  const DB_VERSION = 4;

  const STORES = [
    'settings', 'meta', 'keys', 'zones', 'files', 'cards', 'memory_cards',
    'records', 'provider_configs', 'zone_settings', 'levels', 'level_cards',
    'review_schedule', 'daily_tasks', 'checkins', 'ai_history'
  ];

  const INDEXES = {
    files: [['zone_id', 'zone_id', { unique: false }]],
    cards: [['file_id', 'file_id', { unique: false }]],
    memory_cards: [['zone_id', 'zone_id', { unique: false }]],
    records: [['card_id', 'card_id', { unique: false }]],
    levels: [['zone_id', 'zone_id', { unique: false }]],
    level_cards: [['zone_id', 'zone_id', { unique: false }]],
    review_schedule: [['zone_id', 'zone_id', { unique: false }]],
    daily_tasks: [['zone_id', 'zone_id', { unique: false }]],
    checkins: [['zone_id', 'zone_id', { unique: false }]],
    ai_history: [['zone_id', 'zone_id', { unique: false }]]
  };

  function open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前环境不支持 IndexedDB'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        STORES.forEach((storeName) => {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: 'id' });
          }
        });
        const tx = event.target.transaction;
        Object.entries(INDEXES).forEach(([storeName, indexDefs]) => {
          if (!db.objectStoreNames.contains(storeName)) return;
          const store = tx.objectStore(storeName);
          indexDefs.forEach(([indexName, keyPath, opts]) => {
            if (!store.indexNames.contains(indexName)) {
              store.createIndex(indexName, keyPath, opts);
            }
          });
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB 被其他页面占用，请关闭其他标签页'));
    });
  }

  let dbPromise = null;

  function getDb() {
    if (!dbPromise) dbPromise = open();
    return dbPromise;
  }

  function withStore(storeName, mode, fn) {
    return getDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, mode);
          const store = tx.objectStore(storeName);
          let result;
          try {
            result = fn(store);
          } catch (err) {
            reject(err);
            return;
          }
          tx.oncomplete = () => Promise.resolve(result).then(resolve, reject);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error('事务已中止'));
        })
    );
  }

  function requestToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function all(storeName) {
    return withStore(storeName, 'readonly', (store) => requestToPromise(store.getAll()));
  }

  function get(storeName, key) {
    return withStore(storeName, 'readonly', (store) => requestToPromise(store.get(key)));
  }

  function put(storeName, row) {
    return withStore(storeName, 'readwrite', (store) => requestToPromise(store.put(row)));
  }

  function remove(storeName, key) {
    return withStore(storeName, 'readwrite', (store) => requestToPromise(store.delete(key)));
  }

  function clear(storeName) {
    return withStore(storeName, 'readwrite', (store) => requestToPromise(store.clear()));
  }

  function count(storeName) {
    return withStore(storeName, 'readonly', (store) => requestToPromise(store.count()));
  }

  function byIndex(storeName, indexName, value) {
    return withStore(storeName, 'readonly', (store) => {
      const index = store.index(indexName);
      return requestToPromise(index.getAll(value));
    });
  }

  return {
    DB_NAME, DB_VERSION, STORES, open, getDb,
    all, get, put, delete: remove, clear, count, byIndex
  };
});
