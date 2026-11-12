/**
 * 刷题本地存储：题库、题目、作答记录、收藏/斩题标记
 * 数据放在 ReviewAppDB 的 shua_* 表里，题目按题一条记录，避免 localStorage 5MB 限制
 */
(function () {
  'use strict';

  const DB_NAME = 'ReviewAppDB';
  const DB_VERSION = 6;
  const SESSION_KEY = 'shua-session';
  const RECORD_LIMIT = 6000;

  function openDBReq() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        if (typeof upgradeSchema === 'function') upgradeSchema(e.target.result, e.oldVersion || 0, e.target.transaction);
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
      req.onblocked = function () { reject(new Error('数据库被占用，请关闭其他标签页')); };
    });
  }

  // 单表事务：callback 返回 IDBRequest 时取它的 result
  function op(storeName, mode, callback) {
    return openDBReq().then(function (db) {
      return new Promise(function (resolve, reject) {
        let tx;
        try { tx = db.transaction(storeName, mode); } catch (e) { db.close(); reject(e); return; }
        const store = tx.objectStore(storeName);
        let req;
        try { req = callback(store); } catch (e) { db.close(); reject(e); return; }
        tx.oncomplete = function () { db.close(); resolve(req && req.result !== undefined ? req.result : undefined); };
        tx.onerror = function () { db.close(); reject(tx.error || new Error('事务失败')); };
        tx.onabort = function () { db.close(); reject(new Error('事务被中止')); };
      });
    });
  }

  function getAll(storeName) {
    return op(storeName, 'readonly', function (s) { return s.getAll(); }).then(function (v) { return v || []; });
  }

  function getByIndex(storeName, indexName, key) {
    return openDBReq().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).index(indexName).getAll(key);
        req.onsuccess = function () { db.close(); resolve(req.result || []); };
        req.onerror = function () { db.close(); reject(req.error); };
      });
    });
  }

  // ── 题库 ──────────────────────────────────
  function getBanks() {
    return getAll('shua_banks').then(function (list) {
      return list.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    });
  }

  function getBank(bankId) {
    return op('shua_banks', 'readonly', function (s) { return s.get(Number(bankId)); });
  }

  // 两段式写入：先拿到自增 id，再写题目
  function addBank(name, questions, sourceFileName) {
    const bank = {
      name: name || '未命名题库',
      sourceFileName: sourceFileName || '',
      count: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    return op('shua_banks', 'readwrite', function (s) { return s.add(bank); }).then(function (bankId) {
      const rows = questions.map(function (q, i) {
        return Object.assign({}, q, {
          id: bankId * 1000000 + (i + 1),
          bankId: bankId,
          seq: i + 1,
          qid: bankId * 1000000 + (i + 1)
        });
      });
      return openDBReq().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction(['shua_questions', 'shua_banks'], 'readwrite');
          const qStore = tx.objectStore('shua_questions');
          rows.forEach(function (row) { qStore.put(row); });
          const bStore = tx.objectStore('shua_banks');
          const getReq = bStore.get(bankId);
          getReq.onsuccess = function () {
            const b = getReq.result;
            if (b) {
              b.count = rows.length;
              b.updatedAt = Date.now();
              bStore.put(b);
            }
          };
          tx.oncomplete = function () { db.close(); resolve(bankId); };
          tx.onerror = function () { db.close(); reject(tx.error); };
          tx.onabort = function () { db.close(); reject(new Error('写入题库失败')); };
        });
      });
    });
  }

  function renameBank(bankId, name) {
    return openDBReq().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction('shua_banks', 'readwrite');
        const store = tx.objectStore('shua_banks');
        const getReq = store.get(Number(bankId));
        getReq.onsuccess = function () {
          const bank = getReq.result;
          if (!bank) { tx.abort(); return; }
          bank.name = name;
          bank.updatedAt = Date.now();
          store.put(bank);
        };
        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); reject(tx.error); };
        tx.onabort = function () { db.close(); reject(new Error('题库不存在')); };
      });
    });
  }

  function removeBank(bankId) {
    const id = Number(bankId);
    return getByIndex('shua_questions', 'bankId', id).then(function (rows) {
      return openDBReq().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction(['shua_banks', 'shua_questions'], 'readwrite');
          tx.objectStore('shua_banks').delete(id);
          const qStore = tx.objectStore('shua_questions');
          rows.forEach(function (row) { qStore.delete(row.id); });
          tx.oncomplete = function () { db.close(); resolve(true); };
          tx.onerror = function () { db.close(); reject(tx.error); };
        });
      });
    });
  }

  function getQuestions(bankId) {
    return getByIndex('shua_questions', 'bankId', Number(bankId)).then(function (rows) {
      return rows
        .sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); })
        .map(function (row) {
          return {
            id: row.seq,
            qid: row.qid,
            chapter: row.chapter || '',
            type: row.type,
            subtype: row.subtype || null,
            stem: row.stem,
            sharedStem: row.sharedStem || null,
            sharedOptions: row.sharedOptions || [],
            options: row.options || [],
            answer: row.answer || '',
            analysis: row.analysis || ''
          };
        });
    });
  }

  // ── 作答记录 ──────────────────────────────
  function getRecords() {
    return getAll('shua_records');
  }

  function getRecordsByBank(bankId) {
    return getByIndex('shua_records', 'bankId', Number(bankId));
  }

  function addRecord(record) {
    return op('shua_records', 'readwrite', function (s) { return s.add(record); }).then(function () {
      return op('shua_records', 'readonly', function (s) { return s.count(); });
    }).then(function (count) {
      if (!count || count <= RECORD_LIMIT) return;
      return openDBReq().then(function (db) {
        return new Promise(function (resolve) {
          const tx = db.transaction('shua_records', 'readwrite');
          const store = tx.objectStore('shua_records');
          let removed = 0;
          const target = count - RECORD_LIMIT;
          store.openCursor().onsuccess = function (e) {
            const cursor = e.target.result;
            if (!cursor || removed >= target) return;
            cursor.delete();
            removed++;
            cursor.continue();
          };
          tx.oncomplete = function () { db.close(); resolve(); };
          tx.onerror = function () { db.close(); resolve(); };
        });
      });
    });
  }

  // ── 标记（收藏 / 斩题）────────────────────
  function getFlags() {
    return getAll('shua_flags').then(function (list) {
      const map = {};
      list.forEach(function (f) { map[f.qid] = f; });
      return map;
    });
  }

  function getFlag(qid) {
    return op('shua_flags', 'readonly', function (s) { return s.get(Number(qid)); }).then(function (v) { return v || {}; });
  }

  function setFlag(qid, field, value) {
    const key = Number(qid);
    return getFlag(key).then(function (flag) {
      const item = Object.assign({ qid: key }, flag);
      item[field] = !!value;
      if (!item.favorite && !item.killed && !item.starred) {
        return op('shua_flags', 'readwrite', function (s) { return s.delete(key); });
      }
      return op('shua_flags', 'readwrite', function (s) { return s.put(item); });
    });
  }

  // ── 会话（退出后可恢复）────────────────────
  function saveSession(session) {
    try {
      if (!session) { localStorage.removeItem(SESSION_KEY); return; }
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) {}
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // ── 导出 ──────────────────────────────────
  function exportBankJson(bankId) {
    return Promise.all([getBank(bankId), getQuestions(bankId)]).then(function (res) {
      const bank = res[0];
      const questions = res[1];
      if (!bank) throw new Error('题库不存在');
      return JSON.stringify({
        version: 3,
        name: bank.name,
        exportedAt: Date.now(),
        questions: questions.map(function (q) {
          return {
            chapter: q.chapter || '',
            type: q.type,
            subtype: q.subtype || null,
            stem: q.stem,
            sharedStem: q.sharedStem || null,
            sharedOptions: q.sharedOptions || [],
            options: q.options,
            answer: q.answer,
            analysis: q.analysis || ''
          };
        })
      }, null, 2);
    });
  }

  window.ShuaStore = {
    getBanks, getBank, addBank, renameBank, removeBank, getQuestions,
    getRecords, getRecordsByBank, addRecord,
    getFlags, getFlag, setFlag,
    saveSession, getSession, exportBankJson
  };
})();
