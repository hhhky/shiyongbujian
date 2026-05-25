if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.min.js';
}

window.addEventListener('unhandledrejection', function(e) {
  console.error('未捕获的Promise错误:', e.reason);
  toast('系统错误: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
});

const COLORS = ['#a855f7','#f472b6','#fb923c','#34d399','#60a5fa','#fb7185','#22d3ee','#facc15'];
let selectedColor = COLORS[0];
let selectedFile = null;
let selectedUploadCat = null;
let currentFilterCat = null;
let pdfDoc = null;
let pdfCurrentPage = 1;
let pdfBaseScale = 1;
let previewFileId = null;
let zoomLevel = 1;
let pinchDist0 = 0;
let pinchZoom0 = 1;

// ── Widget Registry ────────────────────────
const WIDGETS = [
  {
    id: 'review', name: '资料管理', icon: '📁', desc: '分类管理、上传和预览各类资料', color: '#8b5cf6',
    tabs: [
      { id: 'categories', name: '分类管理', shortName: '分类', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>' },
      { id: 'files', name: '资料列表', shortName: '资料', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' },
      { id: 'upload', name: '上传资料', shortName: '上传', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>' }
    ]
  },
  {
    id: 'memo', name: '备忘录', icon: '📝', desc: '记录待办事项，管理工作流程', color: '#10b981',
    tabs: [
      { id: 'memos', name: '备忘录', shortName: '备忘', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' },
      { id: 'workflows', name: '工作流', shortName: '流程', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>' }
    ]
  }
];
let currentWidget = null;
let currentWorkflowId = null;
let editingMemoId = null;
let workflowModalMode = null;
let editingNodeId = null;

function renderWidgets() {
  var grid = document.getElementById('widgets-grid');
  if (!grid) return;
  var filesCount = 0;
  grid.innerHTML = WIDGETS.map(function(w) {
    return `<div onclick="enterWidget('${w.id}')" class="widget-card-outer rounded-2xl p-6 cursor-pointer shadow-lg card-hover" style="box-shadow: 0 4px 24px ${w.color}40;">
      <div class="text-4xl mb-3">${w.icon}</div>
      <h3 class="font-bold text-white text-base mb-1 drop-shadow">${esc(w.name)}</h3>
      <p class="text-xs text-white/80">${w.desc}</p>
    </div>`;
  }).join('');
}

function enterWidget(id) {
  currentWidget = id;
  var w = WIDGETS.find(function(x){ return x.id === id; });
  if (!w) return;

  // Show widget pages
  document.getElementById('page-home').classList.remove('active');
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  var firstTabId = w.tabs[0].id;
  var firstPage = document.getElementById('page-' + firstTabId);
  if (firstPage) firstPage.classList.add('active');

  // Header
  document.getElementById('header-back-btn').classList.remove('hidden');
  document.getElementById('header-title').textContent = w.name;
  document.getElementById('header-badge').style.display = '';

  // Bottom nav
  document.getElementById('bottom-nav').classList.remove('hidden');
  document.querySelector('.main-content').classList.add('has-nav');

  // Sidebar: show back link + widget nav
  document.getElementById('sidebar-back-btn').classList.remove('hidden');
  document.getElementById('sidebar-footer').classList.remove('hidden');
  renderSidebarTabs(w);
  renderBottomNavTabs(w);

  // Activate first tab
  switchTab(firstTabId);
  refreshAll();
  if (id === 'review') renderColorPicker();
  if (id === 'memo') { currentWorkflowId = null; backToWorkflowsList(true); }
}

function goHome() {
  currentWidget = null;
  currentWorkflowId = null;

  // Hide widget pages, show home
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.getElementById('page-home').classList.add('active');

  // Header
  document.getElementById('header-back-btn').classList.add('hidden');
  document.getElementById('header-title').textContent = '实用部件';
  updateHomeBadge();

  // Bottom nav
  document.getElementById('bottom-nav').classList.add('hidden');
  document.querySelector('.main-content').classList.remove('has-nav');

  // Sidebar
  document.getElementById('sidebar-back-btn').classList.add('hidden');
  document.getElementById('sidebar-footer').classList.add('hidden');
  document.getElementById('sidebar-tabs-container').innerHTML = '';
  document.getElementById('bottom-nav-tabs-container').innerHTML = '';

  closePreview();
  renderWidgets();
}

function renderSidebarTabs(w) {
  var container = document.getElementById('sidebar-tabs-container');
  if (!container) return;
  container.innerHTML = w.tabs.map(function(t, i) {
    return '<button onclick="switchTab(\'' + t.id + '\')" class="sidebar-tab flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm ' + (i === 0 ? 'active font-semibold' : 'font-medium text-gray-500') + '" data-tab="' + t.id + '">'
      + '<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' + t.svg + '</svg>'
      + '<span class="hidden lg:inline">' + esc(t.name) + '</span>'
    + '</button>';
  }).join('');
}

function renderBottomNavTabs(w) {
  var container = document.getElementById('bottom-nav-tabs-container');
  if (!container) return;
  container.innerHTML = w.tabs.map(function(t, i) {
    return '<button onclick="switchTab(\'' + t.id + '\')" class="nav-tab flex flex-col items-center gap-0.5 py-1 px-4 rounded-2xl transition-all' + (i === 0 ? ' active' : ' text-gray-400') + '" style="' + (i === 0 ? 'color: #7c3aed;' : '') + '" data-tab="' + t.id + '">'
      + '<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">' + t.svg + '</svg>'
      + '<span class="text-xs font-medium">' + esc(t.shortName) + '</span>'
    + '</button>';
  }).join('');
}

function updateHomeBadge() {
  var badge = document.getElementById('header-badge');
  if (badge) badge.textContent = WIDGETS.length + ' 个部件';
}

// ── Init ──────────────────────────────────
async function init() {
  renderWidgets();
  updateHomeBadge();
  await cleanupExpiredMemos();
  var el;
  el = document.getElementById('header-back-btn'); if (el) el.classList.add('hidden');
  el = document.getElementById('header-title'); if (el) el.textContent = '实用部件';
  el = document.getElementById('bottom-nav'); if (el) el.classList.add('hidden');
  el = document.querySelector('.main-content'); if (el) el.classList.remove('has-nav');
  el = document.getElementById('sidebar-back-btn'); if (el) el.classList.add('hidden');
  el = document.getElementById('sidebar-footer'); if (el) el.classList.add('hidden');
  el = document.getElementById('page-home'); if (el) el.classList.add('active');
  if (document.getElementById('sidebar-tabs-container')) document.getElementById('sidebar-tabs-container').innerHTML = '';
  if (document.getElementById('bottom-nav-tabs-container')) document.getElementById('bottom-nav-tabs-container').innerHTML = '';
}

async function refreshAll() {
  if (!currentWidget) return;
  if (currentWidget === 'review') {
    var _a = await Promise.all([getCategories(), getFiles()]);
    var cats = _a[0]; var files = _a[1];
    var count = files.length;
    var badge = document.getElementById('header-badge');
    if (badge) badge.textContent = count + ' 份资料';
    var sc = document.getElementById('sidebar-footer-text');
    if (sc) sc.textContent = '共 ' + count + ' 份资料';
    renderCategories();
    renderFiles();
    renderUploadCategories();
    renderCategoryFilter();
  } else if (currentWidget === 'memo') {
    await cleanupExpiredMemos();
    var _b = await Promise.all([getMemos(), getWorkflows()]);
    var memos = _b[0]; var workflows = _b[1];
    var badge = document.getElementById('header-badge');
    if (badge) badge.textContent = memos.length + ' 条备忘';
    var sc = document.getElementById('sidebar-footer-text');
    if (sc) sc.textContent = memos.length + ' 条备忘 · ' + workflows.length + ' 个工作流';
    renderMemos();
    renderWorkflows();
  }
}

// ── Tab Navigation ────────────────────────
function switchTab(tab) {
  if (!currentWidget) return;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  var page = document.getElementById('page-' + tab);
  if (page) page.classList.add('active');

  // Bottom nav buttons (mobile)
  document.querySelectorAll('.nav-tab').forEach(function(b) {
    b.style.color = ''; b.classList.add('text-gray-400'); b.classList.remove('active');
  });
  var navBtn = document.querySelector('.nav-tab[data-tab="' + tab + '"]');
  if (navBtn) { navBtn.classList.remove('text-gray-400'); navBtn.classList.add('active'); navBtn.style.color = '#7c3aed'; }

  // Sidebar nav buttons (tablet+)
  document.querySelectorAll('.sidebar-tab').forEach(function(b) {
    b.classList.remove('active'); b.classList.add('text-gray-500'); b.classList.remove('font-semibold'); b.classList.add('font-medium');
  });
  var sideBtn = document.querySelector('.sidebar-tab[data-tab="' + tab + '"]');
  if (sideBtn) { sideBtn.classList.remove('text-gray-500','font-medium'); sideBtn.classList.add('active','font-semibold'); }

  if (currentWidget === 'review') {
    if (tab === 'files') { renderCategoryFilter(); renderFiles(); }
    if (tab === 'upload') renderUploadCategories();
  } else if (currentWidget === 'memo') {
    if (tab === 'memos') renderMemos();
    if (tab === 'workflows') renderWorkflows();
  }
}

// ── Toast ─────────────────────────────────
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2000);
}

function confirmDialog(msg) {
  return new Promise(resolve => {
    if (confirm(msg)) { resolve(true); } else { resolve(false); }
  });
}

// ── Category Modal ────────────────────────
function showAddCategory() {
  document.getElementById('category-modal').classList.remove('hidden');
  document.getElementById('new-cat-name').value = '';
  selectedColor = COLORS[0];
  renderColorPicker();
  document.getElementById('new-cat-name').focus();
}

function hideCategoryModal() {
  document.getElementById('category-modal').classList.add('hidden');
}

function renderColorPicker() {
  const container = document.getElementById('color-picker');
  container.innerHTML = COLORS.map(c =>
    `<button onclick="selectColor('${c}')" class="w-10 h-10 rounded-full transition-all active:scale-90 flex items-center justify-center shadow-md hover:scale-110 hover:shadow-xl" style="background:${c}; box-shadow: 0 2px 8px ${c}66, 0 0 16px ${c}33"
      ${selectedColor === c ? '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
    </button>`
  ).join('');
}

function selectColor(c) { selectedColor = c; renderColorPicker(); }

async function confirmAddCategory() {
  const name = document.getElementById('new-cat-name').value.trim();
  if (!name) { toast('请输入分类名称'); return; }
  await addCategory(name, selectedColor);
  hideCategoryModal();
  toast('分类已创建');
  await refreshAll();
}

// ── Category Management ───────────────────
async function renderCategories() {
  const cats = await getCategories();
  const files = await getFiles();
  const container = document.getElementById('categories-list');
  if (cats.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-12 text-sm col-span-full">还没有分类，点击上方按钮创建</div>';
    return;
  }
  container.innerHTML = cats.map(c => {
    const count = files.filter(f => f.categoryId === c.id).length;
    return `<div class="bg-white/80 backdrop-blur rounded-xl p-4 flex items-center gap-3 card-hover cursor-default shadow-sm" style="border-left: 4px solid ${c.color}">
      <span class="cat-color" style="background:${c.color}; color:${c.color};"></span>
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-gray-800 text-sm">${esc(c.name)}</p>
        <p class="text-xs text-gray-400">${count} 份资料</p>
      </div>
      <button onclick="removeCategory(${c.id})" class="icon-btn-del" title="删除分类"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
    </div>`;
  }).join('');
}

async function removeCategory(id) {
  const files = await getFiles(id);
  if (files.length > 0) {
    if (!await confirmDialog('该分类下有 ' + files.length + ' 份资料，删除分类会同时删除这些资料。确定删除？')) return;
    for (const f of files) await deleteFile(f.id);
  }
  await deleteCategory(id);
  toast('分类已删除');
  await refreshAll();
}

// ── File List ─────────────────────────────
async function renderFiles() {
  const files = await getFiles(currentFilterCat);
  const search = (document.getElementById('file-search')?.value || '').toLowerCase();
  const filtered = files.filter(f => f.name.toLowerCase().includes(search));
  const container = document.getElementById('files-list');
  if (filtered.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-12 text-sm col-span-full">还没有上传资料</div>';
    return;
  }
  container.innerHTML = filtered.sort((a,b) => b.createdAt - a.createdAt).map(f => {
    var icon = getFileIcon(f.type, f.name);
    var sizeStr = f.size > 1024*1024 ? (f.size/(1024*1024)).toFixed(1)+'MB' : (f.size/1024).toFixed(0)+'KB';
    return `<div class="bg-white/80 backdrop-blur rounded-xl p-4 flex items-center gap-3 card-hover cursor-pointer shadow-sm" onclick="previewFile(${f.id})">
      <span class="text-2xl shrink-0">${icon}</span>
      <div class="flex-1 min-w-0">
        <span id="fname-${f.id}" class="font-medium text-gray-800 text-sm truncate block">${esc(f.name)}</span>
        <p class="text-xs text-gray-400">${sizeStr} · ${new Date(f.createdAt).toLocaleDateString('zh-CN')}</p>
      </div>
      <button onclick="event.stopPropagation();startRename(${f.id})" class="icon-btn-edit shrink-0" title="重命名"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>
      <button onclick="event.stopPropagation();removeFile(${f.id})" class="icon-btn-del shrink-0" title="删除"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
    </div>`;
  }).join('');
}

function filterFiles(catId) {
  currentFilterCat = catId;
  document.querySelectorAll('.cat-filter-btn').forEach(b => {
    var matchAll = catId === null && b.dataset.cat === 'all';
    var matchCat = catId !== null && Number(b.dataset.cat) === catId;
    b.className = b.className.replace(/btn-gradient|shadow-md|text-white|bg-gray-100|text-gray-600|font-semibold/g,'');
    if (matchAll || matchCat) {
      b.classList.add('btn-gradient','shadow-md','text-white','font-semibold');
    } else {
      b.classList.add('bg-gray-100','text-gray-600','font-medium');
    }
  });
  renderFiles();
}

async function renderCategoryFilter() {
  const cats = await getCategories();
  const bar = document.getElementById('category-filter-bar');
  const files = await getFiles();
  bar.innerHTML = `<button onclick="filterFiles(null)" class="cat-filter-btn shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold text-white btn-gradient shadow-md active:scale-95 transition-all" data-cat="all">全部 (${files.length})</button>` +
    cats.map(c => {
      const count = files.filter(f => f.categoryId === c.id).length;
      return `<button onclick="filterFiles(${c.id})" class="cat-filter-btn shrink-0 px-4 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-600 active:scale-95 transition-transform" data-cat="${c.id}">${esc(c.name)} (${count})</button>`;
    }).join('');
}

async function removeFile(id) {
  if (!await confirmDialog('确定删除这份资料？')) return;
  await deleteFile(id);
  toast('资料已删除');
  await refreshAll();
  if (previewFileId === id) closePreview();
}

// ── Rename ─────────────────────────────────
function startRename(id) {
  var el = document.getElementById('fname-' + id);
  if (!el || el.querySelector('input')) return;
  var oldName = el.textContent;
  el.innerHTML = '<input id="rename-input-' + id + '" value="' + esc(oldName) + '" class="w-full text-sm font-medium text-gray-800 bg-gray-100 rounded px-2 py-0.5 outline-none border border-primary-500">';
  var inp = document.getElementById('rename-input-' + id);
  inp.focus();
  inp.select();
  inp.addEventListener('blur', function() { finishRename(id); });
  inp.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); finishRename(id); } });
}

async function finishRename(id) {
  var inp = document.getElementById('rename-input-' + id);
  if (!inp) return;
  var newName = inp.value.trim();
  if (!newName) {
    toast('文件名不能为空');
    inp.focus();
    return;
  }
  try {
    await updateFileName(id, newName);
    toast('已重命名');
    await refreshAll();
  } catch(e) {
    toast('重命名失败: ' + (e && e.message ? e.message : ''));
  }
}

// ── Zoom ───────────────────────────────────
function onZoomInput(el) {
  var v = parseInt(el.value);
  if (isNaN(v)) { el.value = Math.round(zoomLevel * 100); return; }
  v = Math.max(25, Math.min(300, v));
  zoomLevel = v / 100;
  el.value = v;
  applyZoom();
}

function setZoom(val) {
  zoomLevel = val;
  var inp = document.getElementById('zoom-input');
  if (inp) inp.value = Math.round(zoomLevel * 100);
  applyZoom();
}

function resetZoom() { setZoom(1); }

function updateZoomIndicator() {
  var inp = document.getElementById('zoom-input');
  if (inp) inp.value = Math.round(zoomLevel * 100);
}

function applyZoom() {
  updateZoomIndicator();
  var content = document.getElementById('preview-content');
  if (!content) return;
  var docTarget = content.querySelector('.word-preview') || content.querySelector('.excel-preview');
  if (docTarget) {
    docTarget.style.zoom = zoomLevel;
  } else if (pdfDoc) {
    renderPdfPage(pdfCurrentPage);
  } else {
    var img = content.querySelector('img');
    if (img) {
      img.style.transform = 'scale(' + zoomLevel + ')';
      img.style.transformOrigin = 'center center';
      img.style.transition = 'transform 0.15s ease';
    }
  }
}

// Mouse wheel zoom (desktop)
function onWheelZoom(e) {
  if (!e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    var delta = e.deltaY > 0 ? -0.05 : 0.05;
    setZoom(Math.max(0.25, Math.min(3, zoomLevel + delta)));
  }
}

// Pinch-to-zoom (mobile)
function onPreviewTouchStart(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    pinchDist0 = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    pinchZoom0 = zoomLevel;
  }
}
function onPreviewTouchMove(e) {
  if (e.touches.length === 2 && pinchDist0 > 0) {
    e.preventDefault();
    var dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    var raw = pinchZoom0 * (dist / pinchDist0);
    setZoom(Math.max(0.25, Math.min(3, raw)));
  }
}
function onPreviewTouchEnd(e) {
  if (e.touches.length < 2) {
    pinchDist0 = 0;
  }
}

// ── Upload ────────────────────────────────
function onFileSelected(input) {
  const file = input.files[0];
  if (!file) return;

  // Validate file type
  var ext = file.name.toLowerCase().split('.').pop();
  var supported = ['pdf','doc','docx','xls','xlsx','jpg','jpeg','png','gif','webp','bmp'];
  var isImage = file.type.startsWith('image/');
  if (supported.indexOf(ext) === -1 && !isImage) {
    toast('不支持的文件格式 (.{})'.replace('{}', ext));
    input.value = '';
    return;
  }
  selectedFile = file;
  document.getElementById('selected-file-info').classList.remove('hidden');
  document.getElementById('selected-file-name').textContent = file.name;
  const size = file.size > 1024*1024 ? (file.size/(1024*1024)).toFixed(1)+'MB' : (file.size/1024).toFixed(0)+'KB';
  document.getElementById('selected-file-size').textContent = size;
  document.getElementById('selected-file-icon').textContent = getFileIcon(file.type, file.name);
  updateUploadBtn();
}

function clearSelectedFile() {
  selectedFile = null;
  document.getElementById('file-input').value = '';
  document.getElementById('selected-file-info').classList.add('hidden');
  updateUploadBtn();
}

function selectUploadCategory(catId) {
  selectedUploadCat = catId;
  document.querySelectorAll('.upload-cat-option').forEach(el => {
    var sel = Number(el.dataset.cat) === catId;
    el.classList.toggle('ring-2', sel);
    el.classList.toggle('ring-dopa-purple-400', sel);
    el.style.transform = sel ? 'scale(1.02)' : '';
  });
  updateUploadBtn();
}

function updateUploadBtn() {
  const btn = document.getElementById('upload-btn');
  if (selectedFile && selectedUploadCat !== null) {
    btn.disabled = false;
    btn.classList.remove('bg-gray-300');
    btn.classList.add('btn-gradient','shadow-lg'); btn.style.background='linear-gradient(135deg, #8b5cf6, #ec4899)';
  } else {
    btn.disabled = true;
    btn.style.background = '';
    btn.className = btn.className.replace('btn-gradient','').replace('shadow-lg','');
    btn.classList.add('bg-gray-300');
  }
}

async function renderUploadCategories() {
  const cats = await getCategories();
  const container = document.getElementById('upload-category-list');
  if (cats.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-4 text-sm col-span-full">请先到"分类"页面创建分类</div>';
    return;
  }
  container.innerHTML = cats.map(c => `<div onclick="selectUploadCategory(${c.id})" class="upload-cat-option bg-white/80 backdrop-blur rounded-xl p-3 flex items-center gap-3 card-hover cursor-pointer transition-all shadow-sm" data-cat="${c.id}">
    <span class="cat-color" style="background:${c.color}"></span>
    <span class="text-sm font-medium text-gray-700">${esc(c.name)}</span>
  </div>`).join('');
}

async function uploadFile() {
  const btn = document.getElementById('upload-btn');

  try {
    if (!selectedFile) { toast('❌ 未选择文件'); return; }
    if (selectedUploadCat === null || selectedUploadCat === undefined) {
      toast('❌ 未选择分类'); return;
    }
    if (selectedFile.size > 100 * 1024 * 1024) { toast('❌ 文件不能超过100MB'); return; }

    btn.disabled = true;
    btn.textContent = '读取中...';
    toast('⏳ 正在读取文件...');

    const arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('读取失败'));
      reader.readAsArrayBuffer(selectedFile);
    });

    btn.textContent = '保存中...';
    toast('⏳ 正在保存到本地...');

    const id = await dbOp('files', 'readwrite', function(store) {
      return store.add({
        name: selectedFile.name,
        categoryId: selectedUploadCat,
        type: selectedFile.type || 'application/octet-stream',
        data: arrayBuffer,
        size: selectedFile.size,
        createdAt: Date.now()
      });
    });

    toast('✅ 上传成功！id=' + id);
    clearSelectedFile();
    selectedUploadCat = null;
    document.querySelectorAll('.upload-cat-option').forEach(el => { el.classList.remove('ring-2','ring-dopa-purple-400'); el.style.transform = ''; });
    updateUploadBtn();
    btn.textContent = '上传资料';
    await refreshAll();

  } catch (e) {
    console.error('Upload error:', e);
    toast('❌ 失败: ' + (e && e.message ? e.message : String(e)));
    btn.disabled = false;
    btn.textContent = '上传资料';
  }
}

// ── Preview ───────────────────────────────
async function previewFile(id) {
  previewFileId = id;
  var file = await getFileById(id);
  if (!file) return;
  document.getElementById('preview-overlay').classList.remove('hidden');
  document.getElementById('preview-title').textContent = file.name;
  document.getElementById('preview-controls').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setZoom(1);

  var cat = getFileCategory(file.type, file.name);
  if (cat === 'pdf') {
    document.getElementById('btn-prev-page').classList.remove('hidden');
    document.getElementById('btn-next-page').classList.remove('hidden');
    document.getElementById('pdf-page-indicator').style.display = '';
    document.getElementById('ctl-sep').style.display = '';
    await renderPdf(file.data);
  } else if (cat === 'word') {
    document.getElementById('btn-prev-page').classList.add('hidden');
    document.getElementById('btn-next-page').classList.add('hidden');
    document.getElementById('pdf-page-indicator').style.display = 'none';
    document.getElementById('ctl-sep').style.display = 'none';
    renderWord(file.data, file.name);
  } else if (cat === 'excel') {
    document.getElementById('btn-prev-page').classList.add('hidden');
    document.getElementById('btn-next-page').classList.add('hidden');
    document.getElementById('pdf-page-indicator').style.display = 'none';
    document.getElementById('ctl-sep').style.display = 'none';
    renderExcel(file.data, file.name);
  } else {
    document.getElementById('btn-prev-page').classList.add('hidden');
    document.getElementById('btn-next-page').classList.add('hidden');
    document.getElementById('pdf-page-indicator').style.display = 'none';
    document.getElementById('ctl-sep').style.display = 'none';
    renderImage(file.data, file.type);
  }
}

async function renderPdf(data) {
  document.getElementById('preview-content').innerHTML = '<div class="text-white text-sm">加载中...</div>';
  pdfCurrentPage = 1;
  try {
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    await renderPdfPage(1);
    updatePdfIndicator();
  } catch (e) {
    document.getElementById('preview-content').innerHTML = '<div class="text-red-400 text-sm">PDF 加载失败</div>';
  }
}

async function renderPdfPage(pageNum) {
  if (!pdfDoc) return;
  var page = await pdfDoc.getPage(pageNum);
  var container = document.getElementById('preview-content');
  var maxW = container.clientWidth - 32;
  var maxH = window.innerHeight * 0.75;
  pdfBaseScale = maxW / page.getViewport({ scale: 1 }).width;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var viewport = page.getViewport({ scale: pdfBaseScale * zoomLevel * dpr });

  var displayW = viewport.width / dpr;
  var displayH = viewport.height / dpr;

  // 默认缩放时适配屏幕；放大后允许溢出滚动
  if (zoomLevel <= 1.01) {
    if (displayW > maxW || displayH > maxH) {
      var fit = Math.min(maxW / displayW, maxH / displayH);
      displayW = Math.floor(displayW * fit);
      displayH = Math.floor(displayH * fit);
    }
  }

  var canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width = displayW + 'px';
  canvas.style.height = displayH + 'px';
  canvas.style.borderRadius = '4px';
  var ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: viewport }).promise;

  container.innerHTML = '';
  container.appendChild(canvas);
  pdfCurrentPage = pageNum;
  updatePdfIndicator();
}

function updatePdfIndicator() {
  document.getElementById('pdf-page-indicator').textContent =
    pdfCurrentPage + '/' + (pdfDoc ? pdfDoc.numPages : 1);
}

function prevPdfPage() {
  if (pdfCurrentPage <= 1) return;
  renderPdfPage(pdfCurrentPage - 1);
}
function nextPdfPage() {
  if (!pdfDoc || pdfCurrentPage >= pdfDoc.numPages) return;
  renderPdfPage(pdfCurrentPage + 1);
}

function renderImage(data, type) {
  var blob = new Blob([data], { type: type });
  var url = URL.createObjectURL(blob);
  var container = document.getElementById('preview-content');
  container.innerHTML = '<img src="' + url + '" class="max-w-full max-h-full object-contain rounded" style="transition: transform 0.15s ease; transform: scale(1); transform-origin: center center" alt="preview">';
}

async function renderWord(data, name) {
  var container = document.getElementById('preview-content');
  container.innerHTML = '<div class="text-white text-sm">正在加载 Word 预览组件...</div>';
  var ext = (name || '').toLowerCase().split('.').pop();
  if (ext !== 'docx') {
    container.innerHTML = '<div class="bg-white rounded-xl p-6 max-w-lg mx-auto text-center"><p class="text-gray-600 text-sm">.doc 格式无法直接在浏览器中预览</p><p class="text-gray-400 text-xs mt-2">请用 Word 打开后另存为 .docx 格式再上传</p></div>';
    return;
  }
  try {
    await loadScript('js/mammoth.browser.min.js');
    var arr = new Uint8Array(data);
    mammoth.convertToHtml({ arrayBuffer: arr.buffer }, {
      styleMap: [
        "p[style-name='Heading 1'] => h2:fresh",
        "p[style-name='Heading 2'] => h3:fresh",
        "p[style-name='Heading 3'] => h4:fresh",
        "r[style-name='Strong'] => strong",
        "r[style-name='Emphasis'] => em"
      ]
    }).then(function(result) {
      container.innerHTML = '<div class="bg-white rounded-xl p-4 md:p-6 max-w-3xl mx-auto word-preview" style="zoom:' + zoomLevel + '">' + result.value + '</div>';
      if (result.messages && result.messages.length > 0) {
        console.warn('Mammoth warnings:', result.messages);
      }
    }).catch(function(err) {
      container.innerHTML = '<div class="bg-white rounded-xl p-6 max-w-lg mx-auto text-center"><p class="text-red-500 text-sm">Word 解析失败</p><p class="text-gray-400 text-xs mt-2">' + esc(String(err)) + '</p></div>';
    });
  } catch (e) {
    container.innerHTML = '<div class="bg-white rounded-xl p-6 max-w-lg mx-auto text-center"><p class="text-red-500 text-sm">Word 解析失败</p><p class="text-gray-400 text-xs mt-2">' + esc(String(e)) + '</p></div>';
  }
}

async function renderExcel(data, name) {
  var container = document.getElementById('preview-content');
  container.innerHTML = '<div class="text-white text-sm">正在加载 Excel 预览组件...</div>';
  try {
    await loadScript('js/xlsx.full.min.js');
    var arr = new Uint8Array(data);
    var wb = XLSX.read(arr, { type: 'array' });
    var sheetName = wb.SheetNames[0];
    var sheet = wb.Sheets[sheetName];
    var html = XLSX.utils.sheet_to_html(sheet, { id: 'excel-table', editable: false });
    container.innerHTML = '<div class="bg-white rounded-xl p-2 md:p-4 max-w-full mx-auto excel-preview" style="zoom:' + zoomLevel + '">' + html + '</div>';
    // Style the generated table
    var tbl = container.querySelector('#excel-table');
    if (tbl) {
      tbl.style.borderCollapse = 'collapse';
      tbl.style.fontSize = '0.8125rem';
      tbl.style.whiteSpace = 'nowrap';
      var cells = tbl.querySelectorAll('td, th');
      cells.forEach(function(c) {
        c.style.border = '1px solid #e5e7eb';
        c.style.padding = '4px 8px';
        c.style.maxWidth = '300px';
        c.style.overflow = 'hidden';
        c.style.textOverflow = 'ellipsis';
      });
    }
  } catch (e) {
    container.innerHTML = '<div class="bg-white rounded-xl p-6 max-w-lg mx-auto text-center"><p class="text-red-500 text-sm">Excel 解析失败</p><p class="text-gray-400 text-xs mt-2">' + esc(String(e)) + '</p></div>';
  }
}

function closePreview() {
  document.getElementById('preview-overlay').classList.add('hidden');
  document.getElementById('preview-content').innerHTML = '';
  document.getElementById('preview-controls').classList.add('hidden');
  document.getElementById('btn-prev-page').classList.add('hidden');
  document.getElementById('btn-next-page').classList.add('hidden');
  document.getElementById('pdf-page-indicator').style.display = 'none';
  document.getElementById('ctl-sep').style.display = 'none';
  document.body.style.overflow = '';
  pdfDoc = null;
  pdfCurrentPage = 1;
  pdfBaseScale = 1;
  previewFileId = null;
  zoomLevel = 1;
  pinchDist0 = 0;
}

async function deletePreviewFile() {
  if (previewFileId !== null) {
    if (await confirmDialog('确定删除当前预览的资料？')) {
      await deleteFile(previewFileId);
      closePreview();
      toast('资料已删除');
      await refreshAll();
    }
  }
}

// ── Lazy script loader ─────────────────────
var _loadedScripts = {};
function loadScript(src) {
  if (_loadedScripts[src]) return _loadedScripts[src];
  var p = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function() { resolve(); };
    s.onerror = function() { reject(new Error('Failed to load: ' + src)); };
    document.head.appendChild(s);
  });
  _loadedScripts[src] = p;
  return p;
}

// ── File type helpers ──────────────────────
function getFileCategory(type, name) {
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || type === 'application/msword') return 'word';
  if (type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || type === 'application/vnd.ms-excel') return 'excel';
  // Fallback by extension if MIME is generic
  const ext = (name || '').toLowerCase().split('.').pop();
  if (ext === 'docx' || ext === 'doc') return 'word';
  if (ext === 'xlsx' || ext === 'xls') return 'excel';
  return 'unknown';
}

function getFileIcon(type, name) {
  const cat = getFileCategory(type, name);
  if (cat === 'pdf') return '📕';
  if (cat === 'image') return '🖼️';
  if (cat === 'word') return '📝';
  if (cat === 'excel') return '📊';
  return '📎';
}

// ── Memo ───────────────────────────────────
function showAddMemo() {
  editingMemoId = null;
  document.getElementById('memo-modal-title').textContent = '新建备忘录';
  document.getElementById('memo-confirm-btn').textContent = '确认创建';
  document.getElementById('memo-title-input').value = '';
  document.getElementById('memo-content-input').value = '';
  document.getElementById('memo-deadline-input').value = '';
  document.getElementById('memo-modal').classList.remove('hidden');
  document.getElementById('memo-title-input').focus();
}

function showEditMemo(id) {
  editingMemoId = id;
  getMemos().then(function(memos) {
    var m = memos.find(function(x) { return x.id === id; });
    if (!m) return;
    document.getElementById('memo-modal-title').textContent = '编辑备忘录';
    document.getElementById('memo-confirm-btn').textContent = '确认更新';
    document.getElementById('memo-title-input').value = m.title;
    document.getElementById('memo-content-input').value = m.content || '';
    if (m.deadline) {
      var d = new Date(m.deadline);
      document.getElementById('memo-deadline-input').value = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + 'T' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    } else {
      document.getElementById('memo-deadline-input').value = '';
    }
    document.getElementById('memo-modal').classList.remove('hidden');
    document.getElementById('memo-title-input').focus();
  });
}

function hideMemoModal() {
  document.getElementById('memo-modal').classList.add('hidden');
  editingMemoId = null;
}

async function confirmMemo() {
  var title = document.getElementById('memo-title-input').value.trim();
  if (!title) { toast('请输入备忘录标题'); return; }
  var content = document.getElementById('memo-content-input').value.trim();
  var deadlineVal = document.getElementById('memo-deadline-input').value;
  var deadline = deadlineVal ? new Date(deadlineVal).getTime() : null;

  if (editingMemoId) {
    await updateMemo(editingMemoId, { title: title, content: content, deadline: deadline });
    toast('备忘录已更新');
  } else {
    await addMemo(title, content, deadline);
    toast('备忘录已创建');
  }
  hideMemoModal();
  await refreshAll();
}

async function deleteMemoById(id) {
  if (!await confirmDialog('确定删除这条备忘录？')) return;
  await deleteMemo(id);
  toast('备忘录已删除');
  await refreshAll();
}

async function cleanupExpiredMemos() {
  try {
    var memos = await getMemos();
    var now = Date.now();
    var GRACE = 7 * 24 * 60 * 60 * 1000;
    for (var i = 0; i < memos.length; i++) {
      if (memos[i].deadline && (memos[i].deadline + GRACE) < now) {
        await deleteMemo(memos[i].id);
      }
    }
  } catch(e) { /* silent */ }
}

function getDaysInfo(memo) {
  if (!memo.deadline) return { label: '无截止日期', color: '#9ca3af', urgent: false };
  var now = Date.now();
  var deadline = memo.deadline;
  var deletionTime = deadline + 7 * 24 * 60 * 60 * 1000;
  var msRemaining = deletionTime - now;
  if (msRemaining <= 0) return { label: '即将删除...', color: '#ef4444', urgent: true };
  var days = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
  if (now > deadline) return { label: '已过期 · ' + days + '天后自动删除', color: '#f97316', urgent: true };
  var daysToDeadline = Math.ceil((deadline - now) / (24 * 60 * 60 * 1000));
  if (daysToDeadline <= 1) return { label: '即将到期 · ' + days + '天后删除', color: '#e11d48', urgent: true };
  if (daysToDeadline <= 3) return { label: daysToDeadline + '天后到期 · ' + days + '天后删除', color: '#f97316', urgent: false };
  return { label: daysToDeadline + '天后到期', color: '#6b7280', urgent: false };
}

async function renderMemos() {
  await cleanupExpiredMemos();
  var memos = await getMemos();
  var container = document.getElementById('memos-list');
  if (memos.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-12 text-sm col-span-full">还没有备忘录，点击上方按钮创建</div>';
    return;
  }
  container.innerHTML = memos.sort(function(a,b){ return b.createdAt - a.createdAt; }).map(function(m) {
    var info = getDaysInfo(m);
    var preview = (m.content || '').substring(0, 80);
    if ((m.content || '').length > 80) preview += '...';
    return '<div class="bg-white/80 backdrop-blur rounded-xl p-4 card-hover shadow-sm memo-card">'
      + '<div class="flex items-start justify-between mb-2">'
        + '<h4 class="font-semibold text-gray-800 text-sm flex-1 min-w-0">' + esc(m.title) + '</h4>'
        + '<div class="flex gap-0.5 shrink-0 ml-2">'
          + '<button onclick="event.stopPropagation();showEditMemo(' + m.id + ')" class="icon-btn-edit" title="编辑"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>'
          + '<button onclick="event.stopPropagation();deleteMemoById(' + m.id + ')" class="icon-btn-del" title="删除"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
        + '</div>'
      + '</div>'
      + (preview ? '<p class="text-xs text-gray-500 mb-2">' + esc(preview) + '</p>' : '')
      + '<div class="flex items-center justify-between text-xs">'
        + '<span class="text-gray-400">' + new Date(m.createdAt).toLocaleDateString('zh-CN') + '</span>'
        + '<span class="font-medium" style="color:' + info.color + '">' + info.label + '</span>'
      + '</div>'
    + '</div>';
  }).join('');
}

// ── Workflow ───────────────────────────────
function showAddWorkflow() {
  workflowModalMode = 'create-workflow';
  document.getElementById('workflow-modal-title').textContent = '新建工作流';
  document.getElementById('workflow-name-input').value = '';
  document.getElementById('workflow-name-input').style.display = '';
  document.getElementById('workflow-node-fields').classList.add('hidden');
  document.getElementById('workflow-modal').classList.remove('hidden');
  document.getElementById('workflow-name-input').focus();
}

function showAddNode() {
  workflowModalMode = 'add-node';
  editingNodeId = null;
  document.getElementById('workflow-modal-title').textContent = '添加节点';
  document.getElementById('workflow-name-input').style.display = 'none';
  document.getElementById('workflow-node-fields').classList.remove('hidden');
  document.getElementById('node-title-input').value = '';
  document.getElementById('node-desc-input').value = '';
  document.getElementById('workflow-modal').classList.remove('hidden');
  document.getElementById('node-title-input').focus();
}

function showEditNode(nodeId) {
  workflowModalMode = 'edit-node';
  editingNodeId = nodeId;
  getWorkflowNodes(currentWorkflowId).then(function(nodes) {
    var n = nodes.find(function(x) { return x.id === nodeId; });
    if (!n) return;
    document.getElementById('workflow-modal-title').textContent = '编辑节点';
    document.getElementById('workflow-name-input').style.display = 'none';
    document.getElementById('workflow-node-fields').classList.remove('hidden');
    document.getElementById('node-title-input').value = n.title;
    document.getElementById('node-desc-input').value = n.description || '';
    document.getElementById('workflow-modal').classList.remove('hidden');
    document.getElementById('node-title-input').focus();
  });
}

function hideWorkflowModal() {
  document.getElementById('workflow-modal').classList.add('hidden');
  workflowModalMode = null;
  editingNodeId = null;
}

async function confirmWorkflowModal() {
  if (workflowModalMode === 'create-workflow') {
    var name = document.getElementById('workflow-name-input').value.trim();
    if (!name) { toast('请输入工作流名称'); return; }
    var id = await addWorkflow(name);
    toast('工作流已创建');
    hideWorkflowModal();
    enterWorkflow(id);
    await refreshAll();
  } else if (workflowModalMode === 'add-node') {
    var title = document.getElementById('node-title-input').value.trim();
    if (!title) { toast('请输入节点标题'); return; }
    var desc = document.getElementById('node-desc-input').value.trim();
    await addWorkflowNode(currentWorkflowId, title, desc);
    toast('节点已添加');
    hideWorkflowModal();
    await renderWorkflowNodes(currentWorkflowId);
    var badge = document.getElementById('header-badge');
    if (badge) {
      var totalNodes = (await getWorkflowNodes(currentWorkflowId)).length;
      badge.textContent = totalNodes + ' 个节点';
    }
  } else if (workflowModalMode === 'edit-node') {
    var title = document.getElementById('node-title-input').value.trim();
    if (!title) { toast('请输入节点标题'); return; }
    var desc = document.getElementById('node-desc-input').value.trim();
    await updateWorkflowNode(editingNodeId, { title: title, description: desc });
    toast('节点已更新');
    hideWorkflowModal();
    await renderWorkflowNodes(currentWorkflowId);
  }
}

async function renderWorkflows() {
  var workflows = await getWorkflows();
  var container = document.getElementById('workflows-grid');
  if (workflows.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-12 text-sm col-span-full">还没有工作流，点击上方按钮创建</div>';
    return;
  }
  container.innerHTML = '';
  for (var i = 0; i < workflows.length; i++) {
    var w = workflows[i];
    var nodes = await getWorkflowNodes(w.id);
    var doneCount = nodes.filter(function(n) { return n.done; }).length;
    var progress = nodes.length > 0 ? Math.round(doneCount / nodes.length * 100) : 0;
    var div = document.createElement('div');
    div.className = 'bg-white/80 backdrop-blur rounded-xl p-4 card-hover cursor-pointer shadow-sm';
    div.onclick = function(wf) { return function() { enterWorkflow(wf.id); }; }(w);
    div.innerHTML = '<div class="flex items-start justify-between mb-2">'
      + '<h4 class="font-semibold text-gray-800 text-sm flex-1 min-w-0">' + esc(w.name) + '</h4>'
      + '<button onclick="event.stopPropagation();deleteWorkflowById(' + w.id + ')" class="icon-btn-del shrink-0 ml-2" title="删除"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
      + '</div>'
      + '<div class="flex items-center gap-2 text-xs text-gray-400 mb-2">'
        + '<span>' + nodes.length + ' 个节点</span>'
        + '<span>·</span>'
        + '<span>' + doneCount + ' 已完成</span>'
      + '</div>'
      + '<div class="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">'
        + '<div class="h-full rounded-full transition-all duration-500" style="width:' + progress + '%; background: linear-gradient(90deg, #10b981, #34d399);"></div>'
      + '</div>';
    container.appendChild(div);
  }
}

async function enterWorkflow(id) {
  currentWorkflowId = id;
  var workflows = await getWorkflows();
  var w = workflows.find(function(x) { return x.id === id; });
  if (!w) return;
  document.getElementById('workflows-list-view').classList.add('hidden');
  document.getElementById('workflow-detail-view').classList.remove('hidden');
  document.getElementById('workflow-detail-title').textContent = w.name;
  await renderWorkflowNodes(id);
}

function backToWorkflowsList(silent) {
  currentWorkflowId = null;
  var listView = document.getElementById('workflows-list-view');
  var detailView = document.getElementById('workflow-detail-view');
  if (listView) listView.classList.remove('hidden');
  if (detailView) detailView.classList.add('hidden');
  if (!silent) {
    refreshAll();
  }
}

async function deleteWorkflowById(id) {
  if (!await confirmDialog('确定删除该工作流及其所有节点？')) return;
  await deleteWorkflow(id);
  toast('工作流已删除');
  if (currentWorkflowId === id) backToWorkflowsList();
  await refreshAll();
}

async function deleteCurrentWorkflow() {
  if (!currentWorkflowId) return;
  await deleteWorkflowById(currentWorkflowId);
}

async function renderWorkflowNodes(workflowId) {
  var nodes = await getWorkflowNodes(workflowId);
  var container = document.getElementById('workflow-nodes');
  if (!container) return;
  if (nodes.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-12 text-sm">还没有节点，点击上方按钮添加</div>';
    return;
  }
  container.innerHTML = '<div class="flow-line-container">'
    + nodes.map(function(n, i) {
      var doneClass = n.done ? 'flow-node-done' : '';
      var isLast = i === nodes.length - 1 ? ' flow-node-last' : '';
      return '<div class="flow-node ' + doneClass + isLast + '">'
        + '<div class="flow-node-dot"></div>'
        + '<div class="flow-node-card bg-white/80 backdrop-blur rounded-xl p-4 card-hover shadow-sm">'
          + '<div class="flex items-start justify-between">'
            + '<div class="flex-1 min-w-0">'
              + '<div class="flex items-center gap-2 mb-1">'
                + '<span class="text-xs font-bold text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0" style="background:' + (n.done ? '#10b981' : '#d1d5db') + '">' + (n.done ? '✓' : (i+1)) + '</span>'
                + '<h4 class="font-semibold text-gray-800 text-sm ' + (n.done ? 'line-through text-gray-400' : '') + '">' + esc(n.title) + '</h4>'
              + '</div>'
              + (n.description ? '<p class="text-xs text-gray-500 ml-7">' + esc(n.description) + '</p>' : '')
            + '</div>'
            + '<div class="flex flex-col items-end gap-1 shrink-0 ml-2">'
              + '<button onclick="event.stopPropagation();toggleNodeDone(' + n.id + ')" class="text-xs px-2 py-0.5 rounded-full font-medium transition-all '
                + (n.done ? 'bg-mint-100 text-mint-600 hover:bg-mint-200' : 'bg-gray-100 text-gray-500 hover:bg-green-50 hover:text-green-600') + '">'
                + (n.done ? '取消' : '完成') + '</button>'
              + '<div class="flex gap-0.5">'
                + '<button onclick="event.stopPropagation();showEditNode(' + n.id + ')" class="icon-btn-edit" title="编辑"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>'
                + '<button onclick="event.stopPropagation();deleteNodeById(' + n.id + ')" class="icon-btn-del" title="删除"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
              + '</div>'
            + '</div>'
          + '</div>'
        + '</div>'
      + '</div>';
    }).join('')
    + '</div>';
  var badge = document.getElementById('header-badge');
  if (badge) badge.textContent = nodes.length + ' 个节点';
}

async function toggleNodeDone(nodeId) {
  var nodes = await getWorkflowNodes(currentWorkflowId);
  var node = nodes.find(function(n) { return n.id === nodeId; });
  if (!node) return;
  await updateWorkflowNode(nodeId, { done: !node.done });
  await renderWorkflowNodes(currentWorkflowId);
}

async function deleteNodeById(nodeId) {
  if (!await confirmDialog('确定删除该节点？')) return;
  await deleteWorkflowNode(nodeId);
  toast('节点已删除');
  await renderWorkflowNodes(currentWorkflowId);
  var nodes = await getWorkflowNodes(currentWorkflowId);
  var badge = document.getElementById('header-badge');
  if (badge) badge.textContent = nodes.length + ' 个节点';
}

// ── Helpers ───────────────────────────────
function esc(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Bootstrap ─────────────────────────────
init().catch(function(e) {
  console.error('Init failed:', e);
  toast('初始化失败，请刷新页面: ' + (e && e.message ? e.message : String(e)));
});
