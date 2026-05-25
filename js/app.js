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
    id: 'memo', name: '备忘录', icon: '📝', desc: '记录待办事项，查看日历', color: '#10b981',
    tabs: [
      { id: 'memos', name: '备忘录', shortName: '备忘', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' },
      { id: 'calendar', name: '日历', shortName: '日历', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>' }
    ]
  },
  {
    id: 'mindmap', name: '思维导图', icon: '🧠', desc: '工作流管理 + 知识归纳梳理', color: '#f43f5e',
    tabs: [
      { id: 'workflows', name: '工作流', shortName: '工作流', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>' },
      { id: 'knowledge', name: '知识导图', shortName: '知识', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>' }
    ]
  }
];
let currentWidget = null;
let currentWorkflowId = null;
let editingMemoId = null;
let workflowModalMode = null;
let editingNodeId = null;
let calendarYear = null;
let calendarMonth = null;
let selectedDateStr = null;
let currentMindmapType = 'workflow';

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
  if (id === 'memo') { var now = new Date(); calendarYear = now.getFullYear(); calendarMonth = now.getMonth(); selectedDateStr = null; }
  if (id === 'mindmap') { currentWorkflowId = null; currentMindmapType = 'workflow'; backToWorkflowsList(true); }
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
    var memos = await getMemos();
    var badge = document.getElementById('header-badge');
    if (badge) badge.textContent = memos.length + ' 条备忘';
    var sc = document.getElementById('sidebar-footer-text');
    if (sc) sc.textContent = memos.length + ' 条备忘';
    renderMemos();
    if (document.getElementById('page-calendar') && document.getElementById('page-calendar').classList.contains('active')) renderCalendar();
  } else if (currentWidget === 'mindmap') {
    var workflows = await getWorkflowsByType(currentMindmapType);
    var label = currentMindmapType === 'knowledge' ? '知识导图' : '工作流';
    var badge = document.getElementById('header-badge');
    if (badge) badge.textContent = workflows.length + ' 个' + label;
    var sc = document.getElementById('sidebar-footer-text');
    if (sc) sc.textContent = workflows.length + ' 个' + label;
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
    if (tab === 'calendar') renderCalendar();
  } else if (currentWidget === 'mindmap') {
    document.getElementById('page-workflows').classList.add('active');
    if (tab === 'workflows') currentMindmapType = 'workflow';
    if (tab === 'knowledge') currentMindmapType = 'knowledge';
    backToWorkflowsList(true); renderWorkflows();
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
    var oldZoom = parseFloat(docTarget.style.zoom) || 1;
    docTarget.style.zoom = zoomLevel;
    if (oldZoom !== zoomLevel) {
      var ratio = zoomLevel / oldZoom;
      var cx = content.clientWidth / 2;
      var cy = content.clientHeight / 2;
      content.scrollLeft = (content.scrollLeft + cx) * ratio - cx;
      content.scrollTop = (content.scrollTop + cy) * ratio - cy;
    }
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
  document.getElementById('memo-autodelete-check').checked = false;
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
    document.getElementById('memo-autodelete-check').checked = !!m.autoDelete;
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
  var autoDelete = document.getElementById('memo-autodelete-check').checked;

  if (editingMemoId) {
    await updateMemo(editingMemoId, { title: title, content: content, deadline: deadline, autoDelete: autoDelete });
    toast('备忘录已更新');
  } else {
    await addMemo(title, content, deadline, autoDelete);
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
      if (memos[i].autoDelete && memos[i].deadline && (memos[i].deadline + GRACE) < now) {
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
        + '<span class="text-gray-400">' + new Date(m.createdAt).toLocaleDateString('zh-CN') + (m.autoDelete ? ' · 自动删除' : '') + '</span>'
        + '<span class="font-medium" style="color:' + info.color + '">' + info.label + '</span>'
      + '</div>'
    + '</div>';
  }).join('');
}

// ── Calendar ────────────────────────────────
function getMemosByDate(memos) {
  var map = {};
  memos.forEach(function(m) {
    if (!m.deadline) return;
    var d = new Date(m.deadline);
    var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    if (!map[key]) map[key] = [];
    map[key].push(m);
  });
  return map;
}

function getDateUrgency(memos) {
  var now = Date.now();
  var maxUrgency = 0; // 0=green, 1=orange, 2=red
  memos.forEach(function(m) {
    var info = getDaysInfo(m);
    if (info.urgent && info.color === '#ef4444') maxUrgency = Math.max(maxUrgency, 2);
    else if (info.urgent || info.color === '#f97316') maxUrgency = Math.max(maxUrgency, 1);
  });
  return ['#34d399', '#fb923c', '#ef4444'][maxUrgency];
}

async function renderCalendar() {
  var memos = await getMemos();
  var memosByDate = getMemosByDate(memos);
  var year = calendarYear || new Date().getFullYear();
  var month = calendarMonth !== null ? calendarMonth : new Date().getMonth();

  // Update label
  document.getElementById('calendar-month-label').textContent = year + '年 ' + (month + 1) + '月';

  // First day of month (0=Sun), days in month
  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var prevMonthDays = new Date(year, month, 0).getDate();

  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

  var grid = document.getElementById('calendar-grid');
  var cells = [];

  // Previous month padding
  for (var i = firstDay - 1; i >= 0; i--) {
    var d = prevMonthDays - i;
    cells.push('<div class="cal-day other-month"><span>' + d + '</span></div>');
  }

  // Current month days
  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var dayMemos = memosByDate[dateStr] || [];
    var isToday = dateStr === todayStr;
    var isSelected = dateStr === selectedDateStr;

    var cls = 'cal-day';
    if (isToday) cls += ' today';
    if (isSelected) cls += ' selected';

    var dotsHtml = '';
    if (dayMemos.length > 0) {
      var urgency = getDateUrgency(dayMemos);
      dotsHtml = '<span class="cal-dot" style="background:' + urgency + '; box-shadow: 0 0 4px ' + urgency + ';"></span>';
    }

    cells.push('<div class="' + cls + '" onclick="selectDate(\'' + dateStr + '\')"><span>' + d + '</span>' + (dotsHtml ? '<div class="cal-day-legend">' + dotsHtml + '</div>' : '') + '</div>');
  }

  // Fill remaining cells to complete 6 rows
  var totalCells = firstDay + daysInMonth;
  var remaining = totalCells % 7 === 0 ? 0 : 7 - totalCells % 7;
  // Ensure at least 6 rows
  if (firstDay + daysInMonth + remaining < 42) remaining += 7;
  for (var d = 1; d <= remaining; d++) {
    cells.push('<div class="cal-day other-month"><span>' + d + '</span></div>');
  }

  grid.innerHTML = cells.join('');

  // Render selected date memos
  var memoContainer = document.getElementById('calendar-memos');
  if (selectedDateStr && memosByDate[selectedDateStr]) {
    var dayMemos = memosByDate[selectedDateStr];
    memoContainer.innerHTML = '<div class="flex items-center gap-2 mb-3"><h3 class="font-semibold text-sm text-gray-700">' + selectedDateStr + ' (' + dayMemos.length + ' 条备忘)</h3></div>'
      + dayMemos.sort(function(a,b){ return b.createdAt - a.createdAt; }).map(function(m) {
        var info = getDaysInfo(m);
        var preview = (m.content || '').substring(0, 80);
        if ((m.content || '').length > 80) preview += '...';
        return '<div class="bg-white/80 backdrop-blur rounded-xl p-4 card-hover shadow-sm memo-card mb-2">'
          + '<div class="flex items-start justify-between mb-2">'
            + '<h4 class="font-semibold text-gray-800 text-sm flex-1 min-w-0">' + esc(m.title) + '</h4>'
            + '<div class="flex gap-0.5 shrink-0 ml-2">'
              + '<button onclick="event.stopPropagation();showEditMemo(' + m.id + ')" class="icon-btn-edit" title="编辑"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>'
              + '<button onclick="event.stopPropagation();deleteMemoById(' + m.id + ')" class="icon-btn-del" title="删除"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
            + '</div>'
          + '</div>'
          + (preview ? '<p class="text-xs text-gray-500 mb-2">' + esc(preview) + '</p>' : '')
          + '<div class="flex items-center justify-between text-xs">'
            + '<span class="text-gray-400">' + (m.autoDelete ? '自动删除' : '手动删除') + '</span>'
            + '<span class="font-medium" style="color:' + info.color + '">' + info.label + '</span>'
          + '</div>'
        + '</div>';
      }).join('');
  } else if (selectedDateStr) {
    memoContainer.innerHTML = '<div class="text-center text-gray-400 py-6 text-sm">当天无待办事项</div>';
  } else {
    memoContainer.innerHTML = '';
  }

  // Update badge
  var badge = document.getElementById('header-badge');
  if (badge) {
    var totalDue = Object.keys(memosByDate).length;
    badge.textContent = totalDue + ' 天有截止';
  }
}

function navigateMonth(delta) {
  calendarMonth += delta;
  if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
  if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
  renderCalendar();
}

function goToToday() {
  var now = new Date();
  calendarYear = now.getFullYear();
  calendarMonth = now.getMonth();
  selectedDateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  renderCalendar();
}

function selectDate(dateStr) {
  selectedDateStr = selectedDateStr === dateStr ? null : dateStr;
  renderCalendar();
}

// ── Workflow / Mind Map ──────────────────────
let quickAddParentId = null;
let quickAddDirection = null;
let mindmapZoom = 1;
let mmPinchDist0 = 0;
let mmPinchZoom0 = 1;
let mmDragInfo = null; // { nodeId, nodeEl, startX, startY, nodeLeft, nodeTop, timer, isDragging }

function showAddWorkflow() {
  workflowModalMode = 'create-workflow';
  document.getElementById('workflow-modal-title').textContent = currentMindmapType === 'knowledge' ? '新建知识导图' : '新建工作流';
  document.getElementById('workflow-name-input').value = '';
  document.getElementById('workflow-name-input').style.display = '';
  document.getElementById('workflow-node-fields').classList.add('hidden');
  document.getElementById('workflow-modal').classList.remove('hidden');
  document.getElementById('workflow-name-input').focus();
}

function selectNodeShape(shape) {
  document.querySelectorAll('.node-shape-btn').forEach(function(b) {
    if (b.dataset.shape === shape) {
      b.classList.add('border-dopa-purple-400','bg-dopa-purple-50','text-dopa-purple-500');
      b.classList.remove('border-gray-200','text-gray-500');
    } else {
      b.classList.remove('border-dopa-purple-400','bg-dopa-purple-50','text-dopa-purple-500');
      b.classList.add('border-gray-200','text-gray-500');
    }
  });
}

function selectNodeSize(size) {
  document.querySelectorAll('.node-size-btn').forEach(function(b) {
    if (b.dataset.size === size) {
      b.classList.add('border-dopa-purple-400','bg-dopa-purple-50','text-dopa-purple-500');
      b.classList.remove('border-gray-200','text-gray-500');
    } else {
      b.classList.remove('border-dopa-purple-400','bg-dopa-purple-50','text-dopa-purple-500');
      b.classList.add('border-gray-200','text-gray-500');
    }
  });
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
    selectNodeShape(n.shape || 'rounded');
    selectNodeSize(n.size || 'medium');
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
    if (!name) { toast('请输入名称'); return; }
    var id = await addWorkflow(name, currentMindmapType);
    toast(currentMindmapType === 'knowledge' ? '知识导图已创建' : '工作流已创建');
    hideWorkflowModal();
    enterWorkflow(id);
    await refreshAll();
  } else if (workflowModalMode === 'edit-node') {
    var title = document.getElementById('node-title-input').value.trim();
    if (!title) { toast('请输入节点标题'); return; }
    var desc = document.getElementById('node-desc-input').value.trim();
    var selShapeBtn = document.querySelector('.node-shape-btn.border-dopa-purple-400');
    var shape = selShapeBtn ? selShapeBtn.dataset.shape : 'rounded';
    var selSizeBtn = document.querySelector('.node-size-btn.border-dopa-purple-400');
    var size = selSizeBtn ? selSizeBtn.dataset.size : 'medium';
    await updateWorkflowNode(editingNodeId, { title: title, description: desc, shape: shape, size: size });
    toast('节点已更新');
    hideWorkflowModal();
    await renderMindMap(currentWorkflowId);
  }
}

async function renderWorkflows() {
  var workflows = await getWorkflowsByType(currentMindmapType);
  var container = document.getElementById('workflows-grid');
  var isKnowledge = currentMindmapType === 'knowledge';
  var emptyLabel = isKnowledge ? '还没有知识导图，点击上方按钮创建' : '还没有工作流，点击上方按钮创建';
  if (workflows.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-12 text-sm col-span-full">' + emptyLabel + '</div>';
    return;
  }
  container.innerHTML = '';
  for (var i = 0; i < workflows.length; i++) {
    var w = workflows[i];
    var nodes = await getWorkflowNodes(w.id);
    var total = nodes.length;
    var div = document.createElement('div');
    div.className = 'bg-white/80 backdrop-blur rounded-xl p-4 card-hover cursor-pointer shadow-sm';
    div.onclick = function(wf) { return function() { enterWorkflow(wf.id); }; }(w);
    var infoHtml = '';
    if (isKnowledge) {
      infoHtml = '<div class="flex items-center gap-2 text-xs text-gray-400 mb-2"><span>' + total + ' 个节点</span></div>';
    } else {
      var doneCount = nodes.filter(function(n) { return n.done; }).length;
      var progress = total > 0 ? Math.round(doneCount / total * 100) : 0;
      infoHtml = '<div class="flex items-center gap-2 text-xs text-gray-400 mb-2">'
        + '<span>' + total + ' 个节点</span>'
        + '<span>·</span>'
        + '<span>' + doneCount + ' 已完成</span>'
        + '</div>'
        + '<div class="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">'
          + '<div class="h-full rounded-full transition-all duration-500" style="width:' + progress + '%; background: linear-gradient(90deg, #10b981, #34d399);"></div>'
        + '</div>';
    }
    div.innerHTML = '<div class="flex items-start justify-between mb-2">'
      + '<h4 class="font-semibold text-gray-800 text-sm flex-1 min-w-0">' + esc(w.name) + '</h4>'
      + '<button onclick="event.stopPropagation();deleteWorkflowById(' + w.id + ')" class="icon-btn-del shrink-0 ml-2" title="删除"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
      + '</div>'
      + infoHtml;
    container.appendChild(div);
  }
}

async function enterWorkflow(id) {
  try {
    currentWorkflowId = id;
    mindmapZoom = 1;
    var workflows = await getWorkflows();
    var w = workflows.find(function(x) { return x.id === id; });
    if (!w) return;
    currentMindmapType = w.type || 'workflow';
    document.getElementById('workflows-list-view').classList.add('hidden');
    document.getElementById('workflow-detail-view').classList.remove('hidden');
    document.getElementById('workflow-detail-title').textContent = w.name;
    await renderMindMap(id);
  } catch (err) {
    console.error('enterWorkflow error:', err);
    toast('打开导图失败: ' + (err.message || String(err)));
    backToWorkflowsList(true);
  }
}

function backToWorkflowsList(silent) {
  currentWorkflowId = null;
  cancelQuickAdd();
  var listView = document.getElementById('workflows-list-view');
  var detailView = document.getElementById('workflow-detail-view');
  if (listView) listView.classList.remove('hidden');
  if (detailView) detailView.classList.add('hidden');
  if (!silent) refreshAll();
}

async function deleteWorkflowById(id) {
  if (!await confirmDialog('确定删除该思维导图及其所有节点？')) return;
  await deleteWorkflow(id);
  toast('思维导图已删除');
  if (currentWorkflowId === id) backToWorkflowsList();
  await refreshAll();
}

async function deleteCurrentWorkflow() {
  if (!currentWorkflowId) return;
  await deleteWorkflowById(currentWorkflowId);
}

// ── Mind Map Layout & Rendering ─────────────
function calcLayout(nodes) {
  var root = nodes.find(function(n) { return n.parentId == null; });
  if (!root) return { positions: {}, rootId: null, w: 0, h: 0 };

  var H_GAP = 60, V_GAP = 30;

  function nodeW(n) {
    var s = n.size || 'medium';
    if (s === 'small') return 120;
    if (s === 'large') return 210;
    return 160;
  }

  function nodeH(n) {
    var s = n.size || 'medium';
    if (s === 'small') return 55;
    if (s === 'large') return 90;
    return 70;
  }

  var positions = {};
  // Use custom position if set, otherwise default to 0,0 for root
  positions[root.id] = { x: (root.posX != null) ? root.posX : 0, y: (root.posY != null) ? root.posY : 0 };

  function getBounds(nodeId) {
    var p = positions[nodeId];
    var n = nodes.find(function(x) { return x.id === nodeId; });
    var w = n ? nodeW(n) : 160;
    var h = n ? nodeH(n) : 70;
    if (!p) return { minX: 0, maxX: w, minY: 0, maxY: h };
    var minX = p.x, maxX = p.x + w, minY = p.y, maxY = p.y + h;
    var children = nodes.filter(function(n) { return n.parentId === nodeId; });
    children.forEach(function(c) {
      var b = getBounds(c.id);
      minX = Math.min(minX, b.minX);
      maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY);
      maxY = Math.max(maxY, b.maxY);
    });
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function layoutChildren(nodeId) {
    var p = positions[nodeId];
    if (!p) return;
    var parentNode = nodes.find(function(x) { return x.id === nodeId; });
    var pw = parentNode ? nodeW(parentNode) : 160;
    var children = nodes.filter(function(n) { return n.parentId === nodeId; });

    var groups = { up: [], down: [], left: [], right: [] };
    children.forEach(function(c) {
      var d = c.direction || 'right';
      if (groups[d]) groups[d].push(c); else groups[d] = [c];
    });

    // Right: stack vertically, extend right
    var ry = p.y;
    groups.right.forEach(function(c) {
      var cw = nodeW(c);
      if (c.posX != null && c.posY != null) {
        positions[c.id] = { x: c.posX, y: c.posY };
      } else {
        positions[c.id] = { x: p.x + pw + H_GAP, y: ry };
        layoutChildren(c.id);
        var b = getBounds(c.id);
        ry = b.maxY + V_GAP;
      }
      layoutChildren(c.id);
    });

    // Left: stack vertically, extend left
    var ly = p.y;
    groups.left.forEach(function(c) {
      var cw = nodeW(c);
      if (c.posX != null && c.posY != null) {
        positions[c.id] = { x: c.posX, y: c.posY };
      } else {
        positions[c.id] = { x: p.x - cw - H_GAP, y: ly };
        layoutChildren(c.id);
        var b = getBounds(c.id);
        ly = b.maxY + V_GAP;
      }
      layoutChildren(c.id);
    });

    // Down: stack horizontally, extend down
    var dx = p.x;
    groups.down.forEach(function(c) {
      var cw = nodeW(c);
      if (c.posX != null && c.posY != null) {
        positions[c.id] = { x: c.posX, y: c.posY };
      } else {
        positions[c.id] = { x: dx, y: p.y + nodeH(parentNode) + V_GAP };
        layoutChildren(c.id);
        var b = getBounds(c.id);
        dx = b.maxX + V_GAP;
      }
      layoutChildren(c.id);
    });

    // Up: stack horizontally, extend up
    var ux = p.x;
    groups.up.forEach(function(c) {
      var cw = nodeW(c);
      if (c.posX != null && c.posY != null) {
        positions[c.id] = { x: c.posX, y: c.posY };
      } else {
        positions[c.id] = { x: ux, y: p.y - nodeH(c) - V_GAP };
        layoutChildren(c.id);
        var b = getBounds(c.id);
        ux = b.maxX + V_GAP;
      }
      layoutChildren(c.id);
    });
  }

  layoutChildren(root.id);

  var bounds = getBounds(root.id);
  var pad = 80;
  var offsetX = -bounds.minX + pad;
  var offsetY = -bounds.minY + pad;

  Object.keys(positions).forEach(function(id) {
    var node = nodes.find(function(n) { return n.id === parseInt(id) || n.id === id; });
    if (node && node.posX != null && node.posY != null) return;
    positions[id].x += offsetX;
    positions[id].y += offsetY;
  });

  return {
    positions: positions,
    rootId: root.id,
    w: bounds.maxX - bounds.minX + pad * 2,
    h: bounds.maxY - bounds.minY + pad * 2
  };
}

function drawConnections(nodes, positions, isKnowledge) {
  function nw(n) {
    var s = n.size || 'medium';
    if (s === 'small') return 120;
    if (s === 'large') return 210;
    return 160;
  }
  function nh(n) {
    var s = n.size || 'medium';
    if (s === 'small') return 55;
    if (s === 'large') return 90;
    return 70;
  }
  var lines = '';
  nodes.forEach(function(n) {
    if (n.parentId == null) return;
    var parentPos = positions[n.parentId];
    var childPos = positions[n.id];
    if (!parentPos || !childPos) return;

    // Start from edge of parent
    var x1, y1, x2, y2;
    var dir = n.direction || 'right';
    var parentNode = nodes.find(function(x) { return x.id === n.parentId; });
    var pw = parentNode ? nw(parentNode) : 160;
    var cw = nw(n);
    var ph = parentNode ? nh(parentNode) : 70;
    var ch = nh(n);

    if (dir === 'right') {
      x1 = parentPos.x + pw; y1 = parentPos.y + ph / 2;
      x2 = childPos.x; y2 = childPos.y + ch / 2;
    } else if (dir === 'left') {
      x1 = parentPos.x; y1 = parentPos.y + ph / 2;
      x2 = childPos.x + cw; y2 = childPos.y + ch / 2;
    } else if (dir === 'down') {
      x1 = parentPos.x + pw / 2; y1 = parentPos.y + ph;
      x2 = childPos.x + cw / 2; y2 = childPos.y;
    } else {
      x1 = parentPos.x + pw / 2; y1 = parentPos.y;
      x2 = childPos.x + cw / 2; y2 = childPos.y + ch;
    }

    var strokeColor;
    if (isKnowledge) {
      strokeColor = '#c4b5fd';
    } else {
      strokeColor = n.done ? '#a7f3d0' : '#fecdd3';
    }
    // Auto-judge: straight line if nearly aligned, otherwise curve
    var dx = Math.abs(x2 - x1);
    var dy = Math.abs(y2 - y1);
    var path;
    if (dy < 25) {
      // nearly horizontal → straight line
      path = 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;
    } else if (dx < 40) {
      // nearly vertical → straight line
      path = 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;
    } else {
      // diagonal → bezier curve
      var cx1 = x1 + (x2 - x1) * 0.4;
      var cy1 = y1;
      var cx2 = x2 - (x2 - x1) * 0.4;
      var cy2 = y2;
      path = 'M' + x1 + ',' + y1 + ' C' + cx1 + ',' + cy1 + ' ' + cx2 + ',' + cy2 + ' ' + x2 + ',' + y2;
    }

    lines += '<path d="' + path + '" stroke="' + strokeColor + '" stroke-width="2" fill="none"/>';
  });
  return lines;
}

async function renderMindMap(workflowId) {
  var canvas = document.getElementById('mindmap-canvas');
  if (!canvas) return;
  cancelQuickAdd();

  try {
    var nodes = await getWorkflowNodes(workflowId);

    var root = nodes.find(function(n) { return n.parentId == null; });
    if (!root) {
      var workflows = await getWorkflows();
      var wf = workflows.find(function(w) { return w.id === workflowId; });
      await addWorkflowNode(workflowId, null, null, wf ? wf.name : '根节点', '');
      return renderMindMap(workflowId);
    }

    var isKnowledge = currentMindmapType === 'knowledge';

  var layout = calcLayout(nodes);
  var positions = layout.positions;
  var canvasW = Math.max(layout.w, 600);
  var canvasH = Math.max(layout.h, 520);

  var svgLines = drawConnections(nodes, positions, isKnowledge);

  var nodesHtml = nodes.map(function(n) {
    var pos = positions[n.id];
    if (!pos) return '';
    var isRoot = n.parentId == null;
    var knowledgeClass = isKnowledge ? ' knowledge' : '';
    var doneClass = (!isKnowledge && n.done) ? ' done' : '';
    var rootClass = isRoot ? ' root' : '';
    var shape = n.shape || 'rounded';
    var shapeClass = shape !== 'rounded' ? ' shape-' + shape : '';
    var descLimit = isKnowledge ? 80 : 30;
    var descSnippet = (n.description || '').substring(0, descLimit);
    if ((n.description || '').length > descLimit) descSnippet += '...';

    var sizeClass = ' size-' + (n.size || (isKnowledge ? 'large' : 'medium'));
    var bottomHtml = '';
    if (isKnowledge) {
      bottomHtml = '<div class="flex justify-end mt-2 pt-2" style="border-top:1px solid #f3f4f6">'
        + '<div class="flex gap-0.5">'
          + '<button onclick="event.stopPropagation();showEditNode(' + n.id + ')" class="icon-btn-edit" title="编辑"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>'
          + '<button onclick="event.stopPropagation();deleteNodeById(' + n.id + ')" class="icon-btn-del" title="删除"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
        + '</div>'
      + '</div>';
    } else {
      bottomHtml = '<div class="flex items-center justify-between mt-2 pt-2" style="border-top:1px solid #f3f4f6">'
        + '<button onclick="event.stopPropagation();toggleNodeDone(' + n.id + ')" class="text-xs px-2 py-0.5 rounded-full font-medium transition-all '
          + (n.done ? 'bg-mint-100 text-mint-600' : 'bg-gray-100 text-gray-500') + '" style="font-size:0.7rem">'
          + (n.done ? '取消' : '完成') + '</button>'
        + '<div class="flex gap-0.5">'
          + '<button onclick="event.stopPropagation();showEditNode(' + n.id + ')" class="icon-btn-edit" title="编辑"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>'
          + '<button onclick="event.stopPropagation();deleteNodeById(' + n.id + ')" class="icon-btn-del" title="删除"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
        + '</div>'
      + '</div>';
    }
    return '<div class="mindmap-node' + knowledgeClass + doneClass + rootClass + shapeClass + sizeClass + '" style="left:' + pos.x + 'px; top:' + pos.y + 'px;" data-node-id="' + n.id + '">'
      + '<button class="mindmap-dir-btn top" onclick="event.stopPropagation();quickAddNode(' + n.id + ',\'up\')" title="上">+</button>'
      + '<button class="mindmap-dir-btn bottom" onclick="event.stopPropagation();quickAddNode(' + n.id + ',\'down\')" title="下">+</button>'
      + '<button class="mindmap-dir-btn left" onclick="event.stopPropagation();quickAddNode(' + n.id + ',\'left\')" title="左">+</button>'
      + '<button class="mindmap-dir-btn right" onclick="event.stopPropagation();quickAddNode(' + n.id + ',\'right\')" title="右">+</button>'
      + '<div class="mindmap-node-title">' + esc(n.title) + '</div>'
      + (descSnippet ? '<div class="text-xs text-gray-400">' + esc(descSnippet) + '</div>' : '')
      + bottomHtml
    + '</div>';
  }).join('');

  canvas.innerHTML = ''
    + '<div id="mindmap-zoom-container" style="transform:scale(' + mindmapZoom + '); transform-origin:0 0; width:' + canvasW + 'px; height:' + canvasH + 'px;">'
    + '<svg class="mindmap-svg" style="width:' + canvasW + 'px; height:' + canvasH + 'px;">' + svgLines + '</svg>'
    + '<div style="position:relative; width:' + canvasW + 'px; height:' + canvasH + 'px;">'
    + nodesHtml
    + '</div>'
    + '</div>';
  updateMindmapZoomLabel();
  canvas.onwheel = onMindmapWheel;
  canvas.ontouchstart = onMindmapTouchStart;
  canvas.ontouchmove = onMindmapTouchMove;
  canvas.ontouchend = onMindmapTouchEnd;

  // Attach drag handlers to nodes
  var nodeEls = canvas.querySelectorAll('.mindmap-node');
  nodeEls.forEach(function(nodeEl) {
    var nid = parseInt(nodeEl.getAttribute('data-node-id'));
    if (!nid) return;
    nodeEl.addEventListener('pointerdown', function(e) { onNodePointerDown(e, nid, nodeEl); });
    nodeEl.addEventListener('touchstart', function(e) { onNodePointerDown(e, nid, nodeEl); }, { passive: false });
  });
  // Document-level move/up for drag (attached once)
  if (!document._mmDragBound) {
    document._mmDragBound = true;
    document.addEventListener('pointermove', onNodePointerMove);
    document.addEventListener('pointerup', onNodePointerUp);
    document.addEventListener('touchmove', onNodePointerMove, { passive: false });
    document.addEventListener('touchend', onNodePointerUp);
    // Close export dropdown on outside click
    document.addEventListener('click', function(e) {
      var dd = document.getElementById('export-dropdown');
      var wrap = document.getElementById('export-dropdown-wrapper');
      if (dd && wrap && !wrap.contains(e.target)) dd.classList.add('hidden');
    });
  }

  var badge = document.getElementById('header-badge');
  if (badge) badge.textContent = nodes.length + ' 个节点';

  // Scroll to root
  var rootPos = positions[layout.rootId];
  if (rootPos) {
    var rootNode = nodes.find(function(n) { return n.id === layout.rootId; });
    var rSize = rootNode ? (rootNode.size || 'medium') : 'medium';
    var rootW = rSize === 'small' ? 120 : rSize === 'large' ? 210 : 160;
    var rootH = rSize === 'small' ? 55 : rSize === 'large' ? 90 : 70;
    canvas.scrollLeft = rootPos.x - canvas.clientWidth / 2 + rootW / 2;
    canvas.scrollTop = rootPos.y - canvas.clientHeight / 2 + rootH / 2;
  }

  } catch (err) {
    console.error('renderMindMap error:', err);
    canvas.innerHTML = '<div class="text-center text-red-400 py-12 text-sm">加载失败: ' + esc(err.message || String(err)) + '<br><button onclick="backToWorkflowsList()" class="text-dopa-purple-500 underline mt-2 text-xs">返回列表</button></div>';
  }
}

// ── Mind Map Zoom ──────────────────────────
function updateMindmapZoomLabel() {
  var label = document.getElementById('mindmap-zoom-label');
  if (label) label.textContent = Math.round(mindmapZoom * 100) + '%';
}

function applyMindmapZoom(oldZoom, anchorX, anchorY) {
  var container = document.getElementById('mindmap-zoom-container');
  if (container) {
    container.style.transform = 'scale(' + mindmapZoom + ')';
    container.style.transformOrigin = '0 0';
  }
  var canvas = document.getElementById('mindmap-canvas');
  if (canvas && oldZoom && oldZoom !== mindmapZoom) {
    var ratio = mindmapZoom / oldZoom;
    var ax = anchorX != null ? anchorX : canvas.clientWidth / 2;
    var ay = anchorY != null ? anchorY : canvas.clientHeight / 2;
    canvas.scrollLeft = (canvas.scrollLeft + ax) * ratio - ax;
    canvas.scrollTop = (canvas.scrollTop + ay) * ratio - ay;
  }
  updateMindmapZoomLabel();
}

function mindmapZoomIn() {
  var old = mindmapZoom;
  mindmapZoom = Math.min(3, mindmapZoom + 0.1);
  applyMindmapZoom(old);
}

function mindmapZoomOut() {
  var old = mindmapZoom;
  mindmapZoom = Math.max(0.25, mindmapZoom - 0.1);
  applyMindmapZoom(old);
}

function mindmapZoomReset() {
  var old = mindmapZoom;
  mindmapZoom = 1;
  applyMindmapZoom(old);
}

// ── Export Mind Map as Image ────────────────
function toggleExportDropdown(e) {
  e.stopPropagation();
  var dd = document.getElementById('export-dropdown');
  dd.classList.toggle('hidden');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  var chars = text.split('');
  var lines = [];
  var cur = '';
  for (var i = 0; i < chars.length; i++) {
    var test = cur + chars[i];
    if (ctx.measureText(test).width > maxWidth && cur.length > 0) {
      lines.push(cur);
      cur = chars[i];
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}

async function renderMindmapToCanvas() {
  var nodes = await getWorkflowNodes(currentWorkflowId);
  if (!nodes.length) return null;
  var isKnowledge = currentMindmapType === 'knowledge';
  var layout = calcLayout(nodes);
  var positions = layout.positions;
  var canvasW = Math.max(layout.w, 600);
  var canvasH = Math.max(layout.h, 520);
  var scale = 2;
  var canvas = document.createElement('canvas');
  canvas.width = canvasW * scale;
  canvas.height = canvasH * scale;
  var ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Draw connections via SVG image
  var svgLines = drawConnections(nodes, positions, isKnowledge);
  var svgStr = '<svg xmlns="http://www.w3.org/2000/svg" width="' + canvasW + '" height="' + canvasH + '">' + svgLines + '</svg>';
  var svgBlob = new Blob([svgStr], { type: 'image/svg+xml' });
  var svgUrl = URL.createObjectURL(svgBlob);
  try {
    await new Promise(function(resolve, reject) {
      var img = new Image();
      img.onload = function() { ctx.drawImage(img, 0, 0); URL.revokeObjectURL(svgUrl); resolve(); };
      img.onerror = function() { URL.revokeObjectURL(svgUrl); reject(new Error('SVG load failed')); };
      img.src = svgUrl;
    });
  } catch(e) { URL.revokeObjectURL(svgUrl); }

  // Draw nodes
  var nodeDim = { small: [120, 55, 8], medium: [160, 70, 12], large: [210, 90, 16] };
  nodes.forEach(function(n) {
    var pos = positions[n.id];
    if (!pos) return;
    var size = n.size || (isKnowledge ? 'large' : 'medium');
    var d = nodeDim[size];
    var w = d[0], h = d[1], pad = d[2];
    var x = pos.x, y = pos.y;
    var isRoot = n.parentId == null;
    var shape = n.shape || 'rounded';
    var borderColor = isKnowledge ? '#8b5cf6' : (n.done ? '#10b981' : '#f43f5e');

    ctx.save();
    var radius = shape === 'pill' ? h / 2 : 12;
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);

    if (isRoot) {
      var grad = ctx.createLinearGradient(x, y, x + w, y + h);
      if (isKnowledge) {
        grad.addColorStop(0, 'rgba(139,92,246,0.06)');
        grad.addColorStop(1, 'rgba(168,85,247,0.04)');
      } else {
        grad.addColorStop(0, 'rgba(139,92,246,0.06)');
        grad.addColorStop(1, 'rgba(236,72,153,0.04)');
      }
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    }

    if (n.done && !isKnowledge) {
      ctx.fillStyle = 'rgba(16,185,129,0.06)';
      ctx.fillRect(x, y, w, h);
    }

    ctx.beginPath();
    roundRect(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, radius - 1));
    ctx.lineWidth = isRoot ? 3 : 2;
    ctx.strokeStyle = borderColor;
    ctx.stroke();

    var titleFontSize = size === 'small' ? 11 : (size === 'large' ? 15 : 13);
    ctx.font = (isRoot ? 'bold ' : '600 ') + titleFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = (n.done && !isKnowledge) ? '#9ca3af' : '#1f2937';
    ctx.textBaseline = 'top';
    var maxW = w - pad * 2;
    var title = n.title || '';
    var titleLines = wrapText(ctx, title, maxW);
    var maxTitleLines = size === 'small' ? 1 : 2;
    for (var i = 0; i < Math.min(titleLines.length, maxTitleLines); i++) {
      ctx.fillText(titleLines[i], x + pad, y + pad + i * (titleFontSize + 2));
    }

    var descLimit = isKnowledge ? 80 : 30;
    var desc = (n.description || '').substring(0, descLimit);
    if (desc) {
      var descFontSize = size === 'small' ? 9 : (size === 'large' ? 11 : 10);
      ctx.font = descFontSize + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.textBaseline = 'top';
      var descLines = wrapText(ctx, desc, maxW);
      var descY = y + pad + Math.min(titleLines.length, maxTitleLines) * (titleFontSize + 2) + 4;
      var maxDescLines = size === 'small' ? 1 : 2;
      for (var j = 0; j < Math.min(descLines.length, maxDescLines); j++) {
        ctx.fillText(descLines[j], x + pad, descY + j * (descFontSize + 2));
      }
    }

    ctx.restore();
  });

  var wfName = document.getElementById('workflow-detail-title');
  var name = wfName ? wfName.textContent.trim() : '思维导图';
  return { canvas: canvas, name: name, nodes: nodes, isKnowledge: isKnowledge };
}

async function exportMindmapImage(format) {
  try {
    var result = await renderMindmapToCanvas();
    if (!result) { toast('没有可导出的节点'); return; }
    var mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    var ext = format === 'jpg' ? 'jpg' : 'png';
    result.canvas.toBlob(function(blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = result.name + '.' + ext;
      a.click();
      URL.revokeObjectURL(url);
      toast('已导出 ' + result.name + '.' + ext);
    }, mimeType, 0.95);
  } catch (err) {
    console.error('exportMindmapImage error:', err);
    toast('导出失败: ' + (err.message || String(err)));
  }
}

async function exportMindmapPDF() {
  try {
    var result = await renderMindmapToCanvas();
    if (!result) { toast('没有可导出的节点'); return; }
    var dataUrl = result.canvas.toDataURL('image/png');
    var w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { toast('请允许浏览器弹窗后重试'); return; }
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + result.name + '</title>');
    w.document.write('<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;margin:30px;text-align:center;color:#333}img{max-width:100%;height:auto;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,0.1)}h1{margin-bottom:20px;font-size:20px}</style>');
    w.document.write('</head><body><h1>' + result.name + '</h1><img src="' + dataUrl + '" /></body></html>');
    w.document.close();
    w.focus();
    setTimeout(function() { w.print(); }, 600);
    toast('请在打印对话框中保存为 PDF');
  } catch (err) {
    console.error('exportMindmapPDF error:', err);
    toast('导出失败: ' + (err.message || String(err)));
  }
}

async function exportMindmapWord() {
  try {
    var result = await renderMindmapToCanvas();
    if (!result) { toast('没有可导出的节点'); return; }
    var dataUrl = result.canvas.toDataURL('image/png');
    var nodes = result.nodes;

    // Build hierarchical outline
    var childrenMap = {};
    nodes.forEach(function(n) {
      var pid = n.parentId;
      if (!childrenMap[pid]) childrenMap[pid] = [];
      childrenMap[pid].push(n);
    });

    function buildOutline(pid) {
      var children = childrenMap[pid] || [];
      if (!children.length) return '';
      var html = '<ul>';
      children.forEach(function(child) {
        var prefix = result.isKnowledge ? '' : (child.done ? '[DONE] ' : '[TODO] ');
        html += '<li style="margin-bottom:4px">';
        html += '<strong>' + prefix + esc(child.title) + '</strong>';
        if (child.description) {
          html += '<br><span style="color:#666;font-size:0.9em">' + esc(child.description.substring(0, 200)) + '</span>';
        }
        html += buildOutline(child.id);
        html += '</li>';
      });
      html += '</ul>';
      return html;
    }

    var outline = buildOutline(null);

    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="utf-8"><title>' + result.name + '</title>';
    html += '<style>body{font-family:"Microsoft YaHei",sans-serif;margin:30px;color:#333}h1{font-size:22px;border-bottom:2px solid #7c3aed;padding-bottom:8px}h2{font-size:16px;margin-top:24px;color:#7c3aed}img{max-width:100%;border-radius:8px}ul{margin-left:20px}li{margin:2px 0}</style>';
    html += '</head><body>';
    html += '<h1>' + result.name + '</h1>';
    html += '<p style="color:#888">类型：' + (result.isKnowledge ? '知识导图' : '工作流思维导图') + ' | 节点数：' + nodes.length + ' | 导出时间：' + new Date().toLocaleString() + '</p>';
    html += '<img src="' + dataUrl + '" style="margin:20px 0;border:1px solid #eee" />';
    html += '<h2>节点大纲</h2>';
    html += outline;
    html += '</body></html>';

    var blob = new Blob([html], { type: 'application/msword' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = result.name + '.doc';
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出 ' + result.name + '.doc');
  } catch (err) {
    console.error('exportMindmapWord error:', err);
    toast('导出失败: ' + (err.message || String(err)));
  }
}

function onMindmapWheel(e) {
  if (e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  var old = mindmapZoom;
  var delta = e.deltaY > 0 ? -0.05 : 0.05;
  mindmapZoom = Math.max(0.25, Math.min(3, mindmapZoom + delta));
  var canvas = document.getElementById('mindmap-canvas');
  var rect = canvas.getBoundingClientRect();
  applyMindmapZoom(old, e.clientX - rect.left, e.clientY - rect.top);
}

function onMindmapTouchStart(e) {
  if (e.touches.length === 2) {
    e.preventDefault();
    mmPinchDist0 = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    mmPinchZoom0 = mindmapZoom;
  }
}

function onMindmapTouchMove(e) {
  if (e.touches.length === 2 && mmPinchDist0 > 0) {
    e.preventDefault();
    var dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    var old = mindmapZoom;
    mindmapZoom = Math.max(0.25, Math.min(3, mmPinchZoom0 * (dist / mmPinchDist0)));
    var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    var canvas = document.getElementById('mindmap-canvas');
    var rect = canvas.getBoundingClientRect();
    applyMindmapZoom(old, cx - rect.left, cy - rect.top);
  }
}

function onMindmapTouchEnd(e) {
  if (e.touches.length < 2) {
    mmPinchDist0 = 0;
  }
}

// ── Quick Add Node ──────────────────────────
function quickAddNode(parentId, direction) {
  cancelQuickAdd();
  quickAddParentId = parentId;
  quickAddDirection = direction;

  var canvas = document.getElementById('mindmap-canvas');
  var nodeEl = canvas.querySelector('[data-node-id="' + parentId + '"]');
  if (!nodeEl) return;

  var nodeRect = nodeEl.getBoundingClientRect();
  var canvasRect = canvas.getBoundingClientRect();

  var popup = document.createElement('div');
  popup.id = 'mindmap-quick-add';
  popup.className = 'mindmap-quick-add';

  // Position near the direction button
  var top = nodeRect.top - canvasRect.top + canvas.scrollTop;
  var left = nodeRect.left - canvasRect.left + canvas.scrollLeft;
  var dirLabels = { up: '上方', down: '下方', left: '左侧', right: '右侧' };

  if (direction === 'up') top -= 60;
  if (direction === 'down') top += 80;
  if (direction === 'left') left -= 170;
  if (direction === 'right') left += 140;

  popup.style.top = Math.max(0, top) + 'px';
  popup.style.left = Math.max(0, left) + 'px';

  popup.innerHTML = '<div style="font-size:0.7rem; color:#9ca3af; margin-bottom:4px">向' + (dirLabels[direction] || direction) + '添加子节点</div>'
    + '<input id="quick-add-input" placeholder="节点标题" onkeydown="if(event.key===\'Enter\')confirmQuickAdd()">'
    + '<div style="display:flex; gap:6px; margin:6px 0;" id="quick-shape-select">'
      + '<button onclick="event.stopPropagation();document.getElementById(\'quick-shape-select\').dataset.shape=\'rounded\';renderQuickShapeBtns()" class="quick-shape-btn active" data-shape="rounded" style="flex:1; padding:3px; border-radius:8px; border:2px solid #8b5cf6; background:#ede9fe; text-align:center; font-size:0.65rem; color:#7c3aed; cursor:pointer;">圆角</button>'
      + '<button onclick="event.stopPropagation();document.getElementById(\'quick-shape-select\').dataset.shape=\'pill\';renderQuickShapeBtns()" class="quick-shape-btn" data-shape="pill" style="flex:1; padding:3px; border-radius:30px; border:2px solid #e5e7eb; background:#fff; text-align:center; font-size:0.65rem; color:#6b7280; cursor:pointer;">胶囊</button>'
    + '</div>'
    + '<div style="display:flex; gap:6px; margin:0 0 6px 0;" id="quick-size-select" data-size="' + (currentMindmapType === 'knowledge' ? 'large' : 'medium') + '">'
      + '<button onclick="event.stopPropagation();document.getElementById(\'quick-size-select\').dataset.size=\'small\';renderQuickSizeBtns()" class="quick-size-btn" data-size="small" style="flex:1; padding:3px; border-radius:6px; border:2px solid #e5e7eb; background:#fff; text-align:center; font-size:0.6rem; color:#6b7280; cursor:pointer;">小</button>'
      + '<button onclick="event.stopPropagation();document.getElementById(\'quick-size-select\').dataset.size=\'medium\';renderQuickSizeBtns()" class="quick-size-btn' + (currentMindmapType === 'knowledge' ? '' : ' active') + '" data-size="medium" style="flex:1; padding:3px; border-radius:6px; border:2px solid ' + (currentMindmapType === 'knowledge' ? '#e5e7eb' : '#8b5cf6') + '; background:' + (currentMindmapType === 'knowledge' ? '#fff' : '#ede9fe') + '; text-align:center; font-size:0.6rem; color:' + (currentMindmapType === 'knowledge' ? '#6b7280' : '#7c3aed') + '; cursor:pointer;">中</button>'
      + '<button onclick="event.stopPropagation();document.getElementById(\'quick-size-select\').dataset.size=\'large\';renderQuickSizeBtns()" class="quick-size-btn' + (currentMindmapType === 'knowledge' ? ' active' : '') + '" data-size="large" style="flex:1; padding:3px; border-radius:6px; border:2px solid ' + (currentMindmapType === 'knowledge' ? '#8b5cf6' : '#e5e7eb') + '; background:' + (currentMindmapType === 'knowledge' ? '#ede9fe' : '#fff') + '; text-align:center; font-size:0.6rem; color:' + (currentMindmapType === 'knowledge' ? '#7c3aed' : '#6b7280') + '; cursor:pointer;">大</button>'
    + '</div>'
    + '<div class="mindmap-quick-add-btns">'
      + '<button class="mindmap-quick-add-confirm" onclick="confirmQuickAdd()">添加</button>'
      + '<button class="mindmap-quick-add-cancel" onclick="cancelQuickAdd()">取消</button>'
    + '</div>';

  var existing = document.getElementById('mindmap-quick-add');
  if (existing) existing.remove();

  var innerContainer = canvas.querySelector('div[style*="position:relative"]') || canvas;
  innerContainer.appendChild(popup);

  setTimeout(function() {
    var inp = document.getElementById('quick-add-input');
    if (inp) inp.focus();
  }, 50);
}

function renderQuickShapeBtns() {
  var container = document.getElementById('quick-shape-select');
  if (!container) return;
  var selected = container.dataset.shape || 'rounded';
  var btns = container.querySelectorAll('.quick-shape-btn');
  btns.forEach(function(b) {
    if (b.dataset.shape === selected) {
      b.style.border = '2px solid #8b5cf6';
      b.style.background = '#ede9fe';
      b.style.color = '#7c3aed';
    } else {
      b.style.border = '2px solid #e5e7eb';
      b.style.background = '#fff';
      b.style.color = '#6b7280';
    }
  });
}

function renderQuickSizeBtns() {
  var container = document.getElementById('quick-size-select');
  if (!container) return;
  var selected = container.dataset.size || 'medium';
  var btns = container.querySelectorAll('.quick-size-btn');
  btns.forEach(function(b) {
    if (b.dataset.size === selected) {
      b.style.border = '2px solid #8b5cf6';
      b.style.background = '#ede9fe';
      b.style.color = '#7c3aed';
    } else {
      b.style.border = '2px solid #e5e7eb';
      b.style.background = '#fff';
      b.style.color = '#6b7280';
    }
  });
}

async function confirmQuickAdd() {
  var inp = document.getElementById('quick-add-input');
  var title = inp ? inp.value.trim() : '';
  if (!title) { toast('请输入节点标题'); return; }
  if (quickAddParentId == null) return;

  var shapeContainer = document.getElementById('quick-shape-select');
  var shape = shapeContainer ? (shapeContainer.dataset.shape || 'rounded') : 'rounded';
  var sizeContainer = document.getElementById('quick-size-select');
  var size = sizeContainer ? (sizeContainer.dataset.size || 'medium') : 'medium';

  await addWorkflowNode(currentWorkflowId, quickAddParentId, quickAddDirection, title, '', shape, size);
  cancelQuickAdd();
  await renderMindMap(currentWorkflowId);
  var nodes = await getWorkflowNodes(currentWorkflowId);
  var badge = document.getElementById('header-badge');
  if (badge) badge.textContent = nodes.length + ' 个节点';
}

function cancelQuickAdd() {
  var el = document.getElementById('mindmap-quick-add');
  if (el) el.remove();
  quickAddParentId = null;
  quickAddDirection = null;
}

// ── Node Drag (long-press) ───────────────────
function onNodePointerDown(e, nodeId, nodeEl) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
  var clientX = e.touches ? e.touches[0].clientX : e.clientX;
  var clientY = e.touches ? e.touches[0].clientY : e.clientY;
  var isTouch = e.pointerType === 'touch' || !!e.touches;
  mmDragInfo = {
    nodeId: nodeId,
    nodeEl: nodeEl,
    startX: clientX,
    startY: clientY,
    nodeLeft: parseFloat(nodeEl.style.left) || 0,
    nodeTop: parseFloat(nodeEl.style.top) || 0,
    timer: isTouch ? setTimeout(function() {
      mmDragInfo.isDragging = true;
      nodeEl.classList.add('dragging');
    }, 400) : null,
    isDragging: false,
    isTouch: isTouch
  };
  // Capture pointer for mouse/pen to ensure we receive all move events
  if (!isTouch && e.pointerId != null) {
    nodeEl.setPointerCapture(e.pointerId);
  }
}

function onNodePointerMove(e) {
  if (!mmDragInfo) return;
  var clientX = e.touches ? e.touches[0].clientX : e.clientX;
  var clientY = e.touches ? e.touches[0].clientY : e.clientY;
  if (!mmDragInfo.isDragging) {
    var dx = Math.abs(clientX - mmDragInfo.startX);
    var dy = Math.abs(clientY - mmDragInfo.startY);
    if (!mmDragInfo.isTouch && (dx > 3 || dy > 3)) {
      mmDragInfo.isDragging = true;
      mmDragInfo.nodeEl.classList.add('dragging');
    } else if (mmDragInfo.isTouch && (dx > 5 || dy > 5)) {
      clearTimeout(mmDragInfo.timer); mmDragInfo = null;
    }
    if (!mmDragInfo || !mmDragInfo.isDragging) return;
  }
  e.preventDefault();
  var dx = (clientX - mmDragInfo.startX) / mindmapZoom;
  var dy = (clientY - mmDragInfo.startY) / mindmapZoom;
  mmDragInfo.nodeEl.style.left = (mmDragInfo.nodeLeft + dx) + 'px';
  mmDragInfo.nodeEl.style.top = (mmDragInfo.nodeTop + dy) + 'px';
}

async function onNodePointerUp(e) {
  if (!mmDragInfo) return;
  if (mmDragInfo.isDragging) {
    var el = mmDragInfo.nodeEl;
    var nid = mmDragInfo.nodeId;
    el.classList.remove('dragging');
    if (!mmDragInfo.isTouch && e.pointerId != null) {
      try { el.releasePointerCapture(e.pointerId); } catch(ex) {}
    }
    var newX = Math.round(parseFloat(el.style.left) || 0);
    var newY = Math.round(parseFloat(el.style.top) || 0);
    mmDragInfo = null;
    await updateWorkflowNode(nid, { posX: newX, posY: newY });
    await renderMindMap(currentWorkflowId);
  } else {
    if (mmDragInfo.timer) clearTimeout(mmDragInfo.timer);
    if (!mmDragInfo.isTouch && e.pointerId != null) {
      try { mmDragInfo.nodeEl.releasePointerCapture(e.pointerId); } catch(ex) {}
    }
    mmDragInfo = null;
  }
}

// ── Node Actions ────────────────────────────
async function toggleNodeDone(nodeId) {
  if (currentMindmapType === 'knowledge') return;
  var nodes = await getWorkflowNodes(currentWorkflowId);
  var node = nodes.find(function(n) { return n.id === nodeId; });
  if (!node) return;
  await updateWorkflowNode(nodeId, { done: !node.done });
  await renderMindMap(currentWorkflowId);
}

async function deleteNodeById(nodeId) {
  if (!await confirmDialog('确定删除该节点及其所有子节点？')) return;
  await deleteWorkflowNode(nodeId);
  toast('节点已删除');
  await renderMindMap(currentWorkflowId);
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
