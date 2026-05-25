pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.min.js';

window.addEventListener('unhandledrejection', function(e) {
  console.error('未捕获的Promise错误:', e.reason);
  toast('系统错误: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
});

const COLORS = ['#8b5cf6','#ec4899','#f97316','#10b981','#3b82f6','#f43f5e','#0ea5e9','#84cc16'];
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

// ── Init ──────────────────────────────────
async function init() {
  await refreshAll();
  renderColorPicker();
}

async function refreshAll() {
  const [cats, files] = await Promise.all([getCategories(), getFiles()]);
  const count = files.length;
  document.getElementById('file-count-badge').textContent = count + ' 份资料';
  var sc = document.getElementById('sidebar-file-count');
  if (sc) sc.textContent = '共 ' + count + ' 份资料';
  renderCategories();
  renderFiles();
  renderUploadCategories();
  renderCategoryFilter();
}

// ── Tab Navigation ────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + tab).classList.add('active');

  // Bottom nav buttons (mobile)
  document.querySelectorAll('.nav-tab').forEach(b => {
    b.style.color = ''; b.classList.add('text-gray-400'); b.classList.remove('active');
  });
  var navBtn = document.querySelector('.nav-tab[data-tab="' + tab + '"]');
  if (navBtn) { navBtn.classList.remove('text-gray-400'); navBtn.classList.add('active'); navBtn.style.color = '#7c3aed'; }

  // Sidebar nav buttons (tablet+)
  document.querySelectorAll('.sidebar-tab').forEach(b => {
    b.classList.remove('active'); b.classList.add('text-gray-500'); b.classList.remove('font-semibold'); b.classList.add('font-medium');
  });
  var sideBtn = document.querySelector('.sidebar-tab[data-tab="' + tab + '"]');
  if (sideBtn) { sideBtn.classList.remove('text-gray-500','font-medium'); sideBtn.classList.add('active','font-semibold'); }

  var titles = { categories:'分类管理', files:'资料列表', upload:'上传资料' };
  document.getElementById('header-title').textContent = titles[tab] || '复习资料';
  if (tab === 'files') { renderCategoryFilter(); renderFiles(); }
  if (tab === 'upload') renderUploadCategories();
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
    `<button onclick="selectColor('${c}')" class="w-10 h-10 rounded-full transition-all active:scale-90 flex items-center justify-center shadow-md hover:scale-110 hover:shadow-lg" style="background:${c}">
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
      <button onclick="removeCategory(${c.id})" class="text-gray-300 hover:text-dopa-coral-400 text-xs px-2 py-1 active:scale-90 transition-all">删除</button>
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
      <button onclick="event.stopPropagation();startRename(${f.id})" class="text-gray-300 hover:text-dopa-purple-400 text-sm px-1 py-1 active:scale-90 transition-all shrink-0" title="重命名">✎</button>
      <button onclick="event.stopPropagation();removeFile(${f.id})" class="text-gray-300 hover:text-dopa-coral-400 text-xs px-1 py-1 active:scale-90 transition-all shrink-0">🗑</button>
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
