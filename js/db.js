const DB_NAME = 'ReviewAppDB';
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldVersion = e.oldVersion || 0;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('files')) {
          const fs = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
          fs.createIndex('categoryId', 'categoryId', { unique: false });
        }
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('memos')) {
          const ms = db.createObjectStore('memos', { keyPath: 'id', autoIncrement: true });
          ms.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('workflows')) {
          db.createObjectStore('workflows', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('workflow_nodes')) {
          const wns = db.createObjectStore('workflow_nodes', { keyPath: 'id', autoIncrement: true });
          wns.createIndex('workflowId', 'workflowId', { unique: false });
        }
      }

      if (oldVersion < 3) {
        if (db.objectStoreNames.contains('workflow_nodes')) {
          db.deleteObjectStore('workflow_nodes');
        }
        const wns = db.createObjectStore('workflow_nodes', { keyPath: 'id', autoIncrement: true });
        wns.createIndex('workflowId', 'workflowId', { unique: false });
      }
    };

    req.onsuccess = (e) => { const db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
    req.onblocked = () => reject(new Error('数据库被占用，请关闭其他标签页'));
  });
}

function dbOp(storeName, mode, callback) {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(DB_NAME, DB_VERSION);

    openReq.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldVersion = e.oldVersion || 0;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('categories')) {
          db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('files')) {
          const fs = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
          fs.createIndex('categoryId', 'categoryId', { unique: false });
        }
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('memos')) {
          const ms = db.createObjectStore('memos', { keyPath: 'id', autoIncrement: true });
          ms.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('workflows')) {
          db.createObjectStore('workflows', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('workflow_nodes')) {
          const wns = db.createObjectStore('workflow_nodes', { keyPath: 'id', autoIncrement: true });
          wns.createIndex('workflowId', 'workflowId', { unique: false });
        }
      }

      if (oldVersion < 3) {
        if (db.objectStoreNames.contains('workflow_nodes')) {
          db.deleteObjectStore('workflow_nodes');
        }
        const wns = db.createObjectStore('workflow_nodes', { keyPath: 'id', autoIncrement: true });
        wns.createIndex('workflowId', 'workflowId', { unique: false });
      }
    };

    openReq.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let reqResult;

      try {
        reqResult = callback(store);
      } catch (err) {
        db.close();
        reject(err);
        return;
      }

      tx.oncomplete = () => {
        db.close();
        resolve(reqResult instanceof IDBRequest ? reqResult.result : reqResult);
      };

      tx.onerror = () => { db.close(); reject(tx.error || new Error('事务失败')); };
      tx.onabort = () => { db.close(); reject(new Error('事务被中止')); };
    };

    openReq.onerror = (e) => reject(e.target.error);
    openReq.onblocked = () => reject(new Error('数据库被占用'));
  });
}

// Category operations
async function addCategory(name, color) {
  return dbOp('categories', 'readwrite', (s) => s.add({ name, color, createdAt: Date.now() }));
}

async function getCategories() {
  return dbOp('categories', 'readonly', (s) => s.getAll());
}

async function deleteCategory(id) {
  return dbOp('categories', 'readwrite', (s) => s.delete(id));
}

// File operations
async function addFile(name, categoryId, type, data, size) {
  return dbOp('files', 'readwrite', (s) => s.add({ name, categoryId, type, data, size, createdAt: Date.now() }));
}

async function getFiles(categoryId) {
  const all = await dbOp('files', 'readonly', (s) => s.getAll());
  if (categoryId) return all.filter(f => f.categoryId === categoryId);
  return all;
}

async function getFileById(id) {
  return dbOp('files', 'readonly', (s) => s.get(id));
}

async function deleteFile(id) {
  return dbOp('files', 'readwrite', (s) => s.delete(id));
}

async function updateFileName(id, newName) {
  return new Promise((resolve, reject) => {
    var openReq = indexedDB.open(DB_NAME, DB_VERSION);
    openReq.onsuccess = function(e) {
      var db = e.target.result;
      var tx = db.transaction('files', 'readwrite');
      var store = tx.objectStore('files');
      var getReq = store.get(id);
      getReq.onsuccess = function() {
        var file = getReq.result;
        if (!file) { db.close(); reject(new Error('文件不存在')); return; }
        file.name = newName;
        store.put(file);
      };
      getReq.onerror = function() { db.close(); reject(getReq.error); };
      tx.oncomplete = function() { db.close(); resolve(); };
      tx.onerror = function() { db.close(); reject(tx.error); };
    };
    openReq.onerror = function(e) { reject(e.target.error); };
  });
}

// ── Memo operations ────────────────────────
async function addMemo(title, content, deadline, autoDelete) {
  return dbOp('memos', 'readwrite', (s) => s.add({ title, content, deadline: deadline || null, autoDelete: !!autoDelete, createdAt: Date.now() }));
}

async function getMemos() {
  return dbOp('memos', 'readonly', (s) => s.getAll());
}

async function deleteMemo(id) {
  return dbOp('memos', 'readwrite', (s) => s.delete(id));
}

async function updateMemo(id, updates) {
  return new Promise((resolve, reject) => {
    var openReq = indexedDB.open(DB_NAME, DB_VERSION);
    openReq.onsuccess = function(e) {
      var db = e.target.result;
      var tx = db.transaction('memos', 'readwrite');
      var store = tx.objectStore('memos');
      var getReq = store.get(id);
      getReq.onsuccess = function() {
        var memo = getReq.result;
        if (!memo) { db.close(); reject(new Error('备忘录不存在')); return; }
        if (updates.title !== undefined) memo.title = updates.title;
        if (updates.content !== undefined) memo.content = updates.content;
        if (updates.deadline !== undefined) memo.deadline = updates.deadline;
        if (updates.autoDelete !== undefined) memo.autoDelete = updates.autoDelete;
        store.put(memo);
      };
      getReq.onerror = function() { db.close(); reject(getReq.error); };
      tx.oncomplete = function() { db.close(); resolve(); };
      tx.onerror = function() { db.close(); reject(tx.error); };
    };
    openReq.onerror = function(e) { reject(e.target.error); };
  });
}

// ── Workflow operations ────────────────────────
async function addWorkflow(name) {
  var id = await dbOp('workflows', 'readwrite', (s) => s.add({ name, createdAt: Date.now() }));
  // Auto-create root node
  await dbOp('workflow_nodes', 'readwrite', (s) => s.add({ workflowId: id, parentId: null, direction: null, title: name, description: '', shape: 'rounded', size: 'medium', posX: null, posY: null, done: false, createdAt: Date.now() }));
  return id;
}

async function getWorkflows() {
  return dbOp('workflows', 'readonly', (s) => s.getAll());
}

async function deleteWorkflow(id) {
  await dbOp('workflows', 'readwrite', (s) => s.delete(id));
  var nodes = await getWorkflowNodes(id);
  for (var i = 0; i < nodes.length; i++) {
    await dbOp('workflow_nodes', 'readwrite', (s) => s.delete(nodes[i].id));
  }
}

// ── Workflow Node operations ────────────────────
async function addWorkflowNode(workflowId, parentId, direction, title, desc, shape, size) {
  return dbOp('workflow_nodes', 'readwrite', (s) => s.add({ workflowId, parentId, direction, title, description: desc || '', shape: shape || 'rounded', size: size || 'medium', posX: null, posY: null, done: false, createdAt: Date.now() }));
}

async function getWorkflowNodes(workflowId) {
  var all = await dbOp('workflow_nodes', 'readonly', (s) => s.getAll());
  return all.filter(function(n) { return n.workflowId === workflowId; });
}

async function updateWorkflowNode(id, updates) {
  return new Promise((resolve, reject) => {
    var openReq = indexedDB.open(DB_NAME, DB_VERSION);
    openReq.onsuccess = function(e) {
      var db = e.target.result;
      var tx = db.transaction('workflow_nodes', 'readwrite');
      var store = tx.objectStore('workflow_nodes');
      var getReq = store.get(id);
      getReq.onsuccess = function() {
        var node = getReq.result;
        if (!node) { db.close(); reject(new Error('节点不存在')); return; }
        if (updates.title !== undefined) node.title = updates.title;
        if (updates.description !== undefined) node.description = updates.description;
        if (updates.done !== undefined) node.done = updates.done;
        if (updates.parentId !== undefined) node.parentId = updates.parentId;
        if (updates.direction !== undefined) node.direction = updates.direction;
        if (updates.shape !== undefined) node.shape = updates.shape;
        if (updates.size !== undefined) node.size = updates.size;
        if (updates.posX !== undefined) node.posX = updates.posX;
        if (updates.posY !== undefined) node.posY = updates.posY;
        store.put(node);
      };
      getReq.onerror = function() { db.close(); reject(getReq.error); };
      tx.oncomplete = function() { db.close(); resolve(); };
      tx.onerror = function() { db.close(); reject(tx.error); };
    };
    openReq.onerror = function(e) { reject(e.target.error); };
  });
}

async function deleteWorkflowNode(id) {
  var all = await dbOp('workflow_nodes', 'readonly', (s) => s.getAll());
  // Collect all descendant IDs recursively
  var toDelete = [];
  function collectDescendants(pid) {
    for (var i = 0; i < all.length; i++) {
      if (all[i].parentId === pid) {
        toDelete.push(all[i].id);
        collectDescendants(all[i].id);
      }
    }
  }
  collectDescendants(id);
  toDelete.push(id);
  for (var i = 0; i < toDelete.length; i++) {
    await dbOp('workflow_nodes', 'readwrite', (s) => s.delete(toDelete[i]));
  }
}
