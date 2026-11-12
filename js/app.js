if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/pdf.worker.min.js';
}

window.addEventListener('unhandledrejection', function(e) {
  console.error('未捕获的Promise错误:', e.reason);
  toast('系统错误: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason)));
});

const COLORS = [
  '#a855f7','#c084fc','#e879f9','#f472b6','#ec4899','#f43f5e',
  '#fb923c','#f97316','#ef4444','#dc2626','#f59e0b','#eab308',
  '#22c55e','#10b981','#34d399','#14b8a6','#06b6d4','#22d3ee',
  '#3b82f6','#60a5fa','#6366f1','#8b5cf6','#7c3aed','#6d28d9'
];

const APP_VERSION = '1.2.7';
let selectedColor = COLORS[0];
let selectedFile = null;
let selectedUploadCat = null;
let currentFilterCat = null;
let _rfId = 0;
let pdfDoc = null;
let pdfCurrentPage = 1;
let pdfBaseScale = 1;
let previewFileId = null;
let zoomLevel = 1;
let pinchDist0 = 0;
let pinchZoom0 = 1;

// ── Widget Registry ────────────────────────
// 图标统一用内联 SVG：系统 emoji 在不同手机上字体不同，尺寸与造型都不可控。
// 24×24 线性图标，颜色继承卡片文字色，随主题自动适配。
const WIDGET_ICON_ATTRS = 'class="widget-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const WIDGET_ICONS = {
  tomato: '<svg ' + WIDGET_ICON_ATTRS + '><circle cx="12" cy="14" r="7"/><path d="M12 7.2c-1.6 0-2.8-.8-3.4-2M12 7.2c1.6 0 2.8-.8 3.4-2M12 7.2V4.4"/></svg>',
  folder: '<svg ' + WIDGET_ICON_ATTRS + '><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  note: '<svg ' + WIDGET_ICON_ATTRS + '><path d="M6 3.5h7L17.5 8v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 20V5A1.5 1.5 0 0 1 6 3.5Z"/><path d="M13 3.5V8h4.5"/><path d="M8 12h6M8 15.5h4"/></svg>',
  brain: '<svg ' + WIDGET_ICON_ATTRS + '><path d="M9.5 3.5a3 3 0 0 0-3 3 2.6 2.6 0 0 0-1.4 4.6A2.9 2.9 0 0 0 6 15.6a3 3 0 0 0 3.5 2.9V3.5Z"/><path d="M14.5 3.5a3 3 0 0 1 3 3 2.6 2.6 0 0 1 1.4 4.6A2.9 2.9 0 0 1 18 15.6a3 3 0 0 1-3.5 2.9V3.5Z"/><path d="M12 6v11"/></svg>',
  calendar: '<svg ' + WIDGET_ICON_ATTRS + '><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M8 3v3M16 3v3M3 9.5h18"/><path d="M8 13h2M14 13h2M8 17h2M14 17h2"/></svg>',
  quizzes: '<svg ' + WIDGET_ICON_ATTRS + '><rect x="3.5" y="5" width="12" height="15" rx="3"/><path d="M8 5V4a1.5 1.5 0 0 1 1.5-1.5H18A2.5 2.5 0 0 1 20.5 5v9.5A1.5 1.5 0 0 1 19 16h-1"/><path d="M7.5 10h4M7.5 13.5h2.5"/></svg>',
  robot: '<svg ' + WIDGET_ICON_ATTRS + '><rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 8V5.5"/><circle cx="12" cy="4" r="1"/><circle cx="9" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><path d="M9.5 16.5h5"/></svg>'
};
const WIDGETS = [
  {
    id: 'focus', name: '专注', icon: WIDGET_ICONS.tomato, desc: '任务计时、学习时长统计与打卡', color: '#f97316',
    tabs: [
      { id: 'pomodoro', name: '计时', shortName: '计时', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>' },
      { id: 'stats', name: '数据统计', shortName: '统计', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>' },
      { id: 'focus-calendar', name: '日历', shortName: '日历', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>' },
      { id: 'focus-data', name: '数据', shortName: '数据', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3-3.582-3-8-3-8 1.343-8 3zm0 5c0 1.657 3.582 3 8 3s8-1.343 8-3"/>' }
    ]
  },
  {
    id: 'schedule', name: '课表', icon: WIDGET_ICONS.calendar, desc: '课程表、手动排课与 Excel/CSV 导入', color: '#0ea5e9',
    tabs: [
      { id: 'timetable', name: '课程表', shortName: '课表', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>' },
      { id: 'schedule-import', name: '导入课表', shortName: '导入', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>' },
      { id: 'schedule-settings', name: '课表设置', shortName: '设置', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>' }
    ]
  },
  {
    id: 'shua', name: '刷题', icon: WIDGET_ICONS.quizzes, desc: '导入题库，五种模式离线刷题', color: '#8b5cf6',
    tabs: [
      { id: 'shua-banks', name: '题库', shortName: '题库', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5.5A2.5 2.5 0 016.5 3H19v15H6.5A2.5 2.5 0 004 20.5V5.5z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 18.5A2.5 2.5 0 016.5 16H19"/>' },
      { id: 'shua-study', name: '刷题', shortName: '刷题', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 20h9"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>' },
      { id: 'shua-wrong', name: '错题', shortName: '错题', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 21V4"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 4h11l-1.6 3.5L16 11H5"/>' },
      { id: 'shua-stats', name: '统计', shortName: '统计', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 20h16"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20v-6M12 20v-9M17 20v-4"/>' }
    ]
  },
  {
    id: 'review', name: '资料管理', icon: WIDGET_ICONS.folder, desc: '分类管理、上传和预览各类资料', color: '#8b5cf6',
    tabs: [
      { id: 'categories', name: '分类管理', shortName: '分类', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>' },
      { id: 'files', name: '资料列表', shortName: '资料', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' },
      { id: 'upload', name: '上传资料', shortName: '上传', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>' }
    ]
  },
  {
    id: 'memo', name: '备忘录', icon: WIDGET_ICONS.note, desc: '记录待办事项，查看日历', color: '#10b981',
    tabs: [
      { id: 'memos', name: '备忘录', shortName: '备忘', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' },
      { id: 'calendar', name: '日历', shortName: '日历', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>' },
      { id: 'memo-data', name: '数据', shortName: '数据', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3-3.582-3-8-3-8 1.343-8 3zm0 5c0 1.657 3.582 3 8 3s8-1.343 8-3"/>' }
    ]
  },
  {
    id: 'mindmap', name: '思维导图', icon: WIDGET_ICONS.brain, desc: '工作流 + 知识梳理 | 可导出 PNG/JPEG，PDF/Word 需电脑端', color: '#f43f5e',
    tabs: [
      { id: 'workflows', name: '工作流', shortName: '工作流', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>' },
      { id: 'knowledge', name: '知识导图', shortName: '知识', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>' }
    ]
  }
];
let currentWidget = null;
let currentWorkflowId = null;
let editingMemoId = null;
let memoFilter = 'all'; // all | linked
let workflowModalMode = null;
let editingNodeId = null;
let calendarYear = null;
let calendarMonth = null;
let selectedDateStr = null;
let currentMindmapType = 'workflow';
let currentAboutItem = null; // 关于页当前打开的二级条目（theme/version/intro/opensource）

function renderWidgets() {
  var grid = document.getElementById('widgets-grid');
  if (!grid) return;
  // 长按卡片不弹系统菜单（拷贝、分享、搜索等）；只绑一次，卡片内容重绘不受影响
  if (!grid.dataset.noContextMenu) {
    grid.dataset.noContextMenu = '1';
    grid.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  }
  var filesCount = 0;
  grid.innerHTML = WIDGETS.map(function(w) {
    return `<div onclick="enterWidget('${w.id}')" class="widget-card-outer rounded-[24px] p-4 cursor-pointer card-hover">
      <div class="widget-icon-wrap mb-2">${w.icon}</div>
      <h3 class="font-bold text-[15px] mb-1 leading-snug" style="color: var(--card-text);">${esc(w.name)}</h3>
      <p class="text-[11px] leading-relaxed widget-card-desc" style="color: var(--card-subtext);">${w.desc}</p>
    </div>`;
  }).join('');
}

function enterWidget(id) {
  currentWidget = id;
  currentAboutItem = null;
  var w = WIDGETS.find(function(x){ return x.id === id; });
  if (!w) return;

  // Show widget pages
  document.getElementById('page-home').classList.remove('active');
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  var firstTabId = w.tabs[0].id;
  var firstPage = document.getElementById('page-' + firstTabId);
  if (firstPage) {
    firstPage.classList.add('active');
    animatePageIn(firstPage, true);
  }

  // Header
  document.getElementById('header-back-btn').classList.remove('hidden');
  document.getElementById('header-title').textContent = w.name;
  document.getElementById('header-badge').style.display = '';

  // Bottom nav
  document.getElementById('bottom-nav').classList.remove('hidden');
  document.querySelector('.main-content').classList.add('has-nav');

  // Hide home switch bar
  document.getElementById('home-switch-bar').style.display = 'none';

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
  if (id === 'focus' && typeof initFocus === 'function') initFocus();
  if (id === 'schedule' && typeof initSchedule === 'function') initSchedule();
  if (id === 'shua' && typeof initShua === 'function') initShua();
}

function goHome() {
  currentWidget = null;
  currentWorkflowId = null;
  currentAboutItem = null;

  // Hide widget pages, show home
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.getElementById('page-home').classList.add('active');
  animatePageIn(document.getElementById('page-home'), false);
  switchHomeTab('widgets'); // reset to widgets tab

  // Header
  document.getElementById('header-back-btn').classList.add('hidden');
  document.getElementById('header-title').textContent = '实用部件';
  document.getElementById('header-badge').style.display = '';
  updateHomeBadge();

  // Bottom nav
  document.getElementById('bottom-nav').classList.add('hidden');
  document.querySelector('.main-content').classList.remove('has-nav');

  // Show home switch bar
  document.getElementById('home-switch-bar').style.display = '';

  // Sidebar
  document.getElementById('sidebar-back-btn').classList.add('hidden');
  document.getElementById('sidebar-back-label').textContent = '实用部件';
  document.getElementById('sidebar-footer').classList.add('hidden');
  document.getElementById('sidebar-tabs-container').innerHTML = '';
  document.getElementById('bottom-nav-tabs-container').innerHTML = '';

  closePreview();
  renderWidgets();
}

// ── 系统返回键（Android / 鸿蒙）─────────────
// 由原生 MainActivity 通过 evaluateJavascript 同步调用：
// 返回 true 表示已在 App 内处理（留在当前页面），false 表示已在首页、交给系统退出。
function androidBackCloseOverlay() {
  var overlays = [
    ['preview-overlay', 'closePreview'],
    ['category-modal', 'hideCategoryModal'],
    ['memo-modal', 'hideMemoModal'],
    ['workflow-modal', 'hideWorkflowModal'],
    ['focus-task-modal', 'hideFocusTaskModal'],
    ['focus-settings-modal', 'hideFocusSettings'],
    ['focus-manual-modal', 'hideFocusManualModal'],
    ['shua-rename-modal', 'shuaCancelRename'],
    ['shua-bank-menu-modal', 'shuaCloseBankMenu'],
    ['shua-import-modal', 'shuaCloseImport'],
    ['shua-setup-modal', 'shuaCloseSetup'],
    ['shua-sheet-modal', 'shuaCloseSheet']
  ];
  for (var i = 0; i < overlays.length; i++) {
    var el = document.getElementById(overlays[i][0]);
    var close = window[overlays[i][1]];
    // 关闭函数可能定义在 focus.js，未加载时跳过该项，不影响其它层
    if (el && !el.classList.contains('hidden') && typeof close === 'function') {
      close();
      return true;
    }
  }
  return false;
}

function handleAndroidBack() {
  // 1. 公告弹窗：有就关掉，不因返回键直接退出 App
  var ann = document.getElementById('announce-mask');
  if (ann) {
    var annBtn = ann.querySelector('.announce-secondary') || ann.querySelector('.announce-primary');
    if (annBtn) annBtn.click();
    return true;
  }
  // 2. 打开着的浮层 / 弹窗
  if (androidBackCloseOverlay()) return true;
  // 3. 思维导图：具体导图退回导图列表
  if (currentWidget === 'mindmap' && currentWorkflowId) {
    backToWorkflowsList();
    return true;
  }
  // 4. 部件内页退回首页
  if (currentWidget) { goHome(); return true; }
  // 5. 关于二级页退回关于首页
  if (currentAboutItem) { backToAbout(); return true; }
  // 6. 首页的「关于」页退回「部件」页
  var aboutPage = document.getElementById('page-about');
  if (aboutPage && aboutPage.classList.contains('active')) { switchHomeTab('widgets'); return true; }
  // 7. 已经在首页，交给系统退出
  return false;
}

// ── 关于页：条目入口与二级页 ──────────────────
var ABOUT_ITEMS = [
  { id: 'theme', name: '主题样式', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/>' },
  { id: 'version', name: '版本更新', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>' },
  { id: 'intro', name: '介绍', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>' },
  { id: 'opensource', name: '开源', svg: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>' }
];

// 顶部 / 侧边栏返回按钮：关于二级页回关于首页，其余回首页
function goBack() {
  if (currentAboutItem) { backToAbout(); return; }
  goHome();
}

function gotoAboutItem(item) {
  var found = ABOUT_ITEMS.find(function(x){ return x.id === item; });
  if (!found) return;
  currentAboutItem = item;

  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  var page = document.getElementById('page-about-' + item);
  if (page) page.classList.add('active');

  // Header
  document.getElementById('header-back-btn').classList.remove('hidden');
  document.getElementById('header-title').textContent = found.name;
  document.getElementById('header-badge').style.display = 'none';

  // Bottom nav / 首页切换栏
  document.getElementById('bottom-nav').classList.add('hidden');
  document.querySelector('.main-content').classList.remove('has-nav');
  document.getElementById('home-switch-bar').style.display = 'none';

  // Sidebar：显示关于条目导航
  document.getElementById('sidebar-back-btn').classList.remove('hidden');
  document.getElementById('sidebar-back-label').textContent = '关于';
  document.getElementById('sidebar-footer').classList.add('hidden');
  renderAboutSidebar(item);
  document.getElementById('bottom-nav-tabs-container').innerHTML = '';

  updateAboutVersion();
  updateThemeSelection();
  // 打开版本页时自动检查一次，有新版本直接展示更新内容
  if (item === 'version' && typeof checkVersionPage === 'function') setTimeout(checkVersionPage, 120);
}

function backToAbout() {
  currentAboutItem = null;

  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.getElementById('page-about').classList.add('active');

  // Header
  document.getElementById('header-back-btn').classList.add('hidden');
  document.getElementById('header-title').textContent = '实用部件';
  document.getElementById('header-badge').style.display = '';
  updateHomeBadge();

  // 恢复首页切换栏
  document.getElementById('home-switch-bar').style.display = '';

  // Sidebar
  document.getElementById('sidebar-back-btn').classList.add('hidden');
  document.getElementById('sidebar-back-label').textContent = '实用部件';
  document.getElementById('sidebar-footer').classList.add('hidden');
  document.getElementById('sidebar-tabs-container').innerHTML = '';
  document.getElementById('bottom-nav-tabs-container').innerHTML = '';

  switchHomeTab('about');
}

function renderAboutSidebar(active) {
  var container = document.getElementById('sidebar-tabs-container');
  if (!container) return;
  container.innerHTML = ABOUT_ITEMS.map(function(t){
    return '<button onclick="gotoAboutItem(\'' + t.id + '\')" class="sidebar-tab flex items-center gap-3 px-3 py-2.5 rounded-[20px] text-sm ' + (t.id === active ? 'active font-semibold' : 'font-medium text-gray-500') + '" data-tab="' + t.id + '">'
      + '<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' + t.svg + '</svg>'
      + '<span class="hidden lg:inline">' + esc(t.name) + '</span>'
    + '</button>';
  }).join('');
}

function switchHomeTab(tab) {
  var widgetsBtn = document.getElementById('home-switch-widgets');
  var aboutBtn = document.getElementById('home-switch-about');
  var aiBtn = document.getElementById('home-switch-ai');
  var homePage = document.getElementById('page-home');
  var aboutPage = document.getElementById('page-about');

  // AI 小助手目前只作为一级入口占位，点击只弹测试提示
  if (tab === 'ai') {
    showAiBetaModal();
    return;
  }

  if (aiBtn) {
    aiBtn.style.background = 'transparent';
    aiBtn.style.color = 'var(--text-secondary)';
    aiBtn.style.fontWeight = '500';
  }

  if (tab === 'about') {
    homePage.classList.remove('active');
    aboutPage.classList.add('active');
    animatePageIn(aboutPage, true);
    widgetsBtn.style.background = 'transparent';
    widgetsBtn.style.color = 'var(--text-tertiary)';
    widgetsBtn.style.fontWeight = '500';
    aboutBtn.style.background = 'rgba(0,0,0,0.06)';
    aboutBtn.style.color = 'var(--text-primary)';
    aboutBtn.style.fontWeight = '600';
    updateAboutVersion();
    updateThemeSelection();
  } else {
    aboutPage.classList.remove('active');
    homePage.classList.add('active');
    animatePageIn(homePage, false);
    aboutBtn.style.background = 'transparent';
    aboutBtn.style.color = 'var(--text-tertiary)';
    aboutBtn.style.fontWeight = '500';
    widgetsBtn.style.background = 'rgba(0,0,0,0.06)';
    widgetsBtn.style.color = 'var(--text-primary)';
    widgetsBtn.style.fontWeight = '600';
  }
}

function showAiBetaModal() {
  var mask = document.getElementById('ai-beta-modal');
  if (!mask) return;
  mask.classList.remove('hidden');
  mask.classList.add('flex');
}

function hideAiBetaModal() {
  var mask = document.getElementById('ai-beta-modal');
  if (!mask) return;
  mask.classList.add('hidden');
  mask.classList.remove('flex');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('app-theme', theme);
  var colors = { glass: '#edeff4', white: '#ffffff', dark: '#1c1c1e' };
  document.querySelector('meta[name="theme-color"]').setAttribute('content', colors[theme] || '#e5e5ea');
  // 系统栏（状态栏/导航栏）图标黑白与底色跟随主题
  if (typeof window.syncSystemBars === 'function') window.syncSystemBars(theme);
  updateThemeSelection();
  // 统计页图表、计时环与任务/日历列表都依赖强调色，切主题后重绘
  if (currentWidget === 'focus') {
    if (typeof renderStats === 'function') setTimeout(renderStats, 60);
    if (typeof updateFocusModeUI === 'function') updateFocusModeUI();
    if (typeof updateFocusTimerDisplay === 'function') updateFocusTimerDisplay();
    if (typeof renderFocusTasks === 'function') renderFocusTasks();
    if (typeof renderFocusCalendar === 'function') renderFocusCalendar();
  }
}

function updateThemeSelection() {
  var current = document.documentElement.getAttribute('data-theme') || 'glass';
  ['glass', 'white', 'dark'].forEach(function(t) {
    var opt = document.getElementById('theme-opt-' + t);
    if (opt) {
      var active = current === t;
      opt.style.borderColor = active ? 'var(--text-primary)' : 'transparent';
      opt.style.boxShadow = active ? '0 0 0 1px var(--text-primary)' : 'none';
    }
  });
  // 关于首页条目上显示当前主题
  var entry = document.getElementById('about-theme-entry');
  if (entry) {
    var names = { glass: '玻璃 · iOS 风格', white: '白色 · 清爽纯白', dark: '暗黑 · 护眼深色' };
    entry.textContent = names[current] || names.glass;
  }
}

// 各版本的更新内容：版本页展示当前安装版本对应的条目
var APP_CHANGELOG = {
  '1.2.7': [
    '新增「刷题」部件：导入题库后可在本机离线刷题',
    '支持 JSON、CSV/TSV 与纯文本题库，带解析预览与题型统计',
    '五种模式：标准、速刷、背题、随机、测试；可按状态、章节、题型筛选',
    '单选、多选、判断、填空、简答均可作答，即时判分并显示答案解析',
    '答题卡跳题、收藏与斩题、错题本单独重刷、分库进度统计',
    '题库与作答记录存本机 IndexedDB，退出后可继续上次进度'
  ],
  '1.2.6': [
    '页面切换加入过渡动画：按标签顺序左右滑动进出，返回时反向',
    '所有弹窗改为升起式入场，关闭时先收回再消失',
    '列表与卡片逐条错开淡入，首页部件、分类、资料、备忘录、导图与专注任务均可感知',
    '系统开启「减少动态效果」时自动关闭全部动画'
  ],
  '1.2.4': [
    '课表星期下方显示具体日期，只有本周的今天会高亮',
    '课表设置改为逐节自定义上下课时间，可一键按 45 分钟自动排满',
    '当前时间落在某一节课时，课表对应整行高亮，每半分钟刷新',
    '课表设置新增「清空当前课表」，二次确认后删除；关联备忘录保留但解除关联',
    '专注配色改为柿红/珊瑚色，开始按钮使用渐变，暗黑主题改用暖桃与砖红',
    '修复跨天后课表日期不会自动更新的问题'
  ],
  '1.2.3': [
    '课表设置独立成标签页：开学日期、总周数、每天节数、第一节上课时间、每节时长与课间休息',
    '按设置自动计算每节课的上下课时间，并显示在课表左侧',
    '加课弹窗改为与专注「新建任务」一致的底部弹层，自动聚焦输入框',
    '课程颜色扩充到 20 种，重复导入时优先分配不同颜色',
    '课表按钮改用青蓝渐变，不再沿用专注的番茄橙',
    '内嵌浏览器支持通用课表识别：自动读取课表表格、iframe、role=grid 网格与课表数据数组',
    '网页识别结果在导入前先展示课程清单确认，避免误导入'
  ],
  '1.2.2': [
    '课表改为整块实色卡片，七天完整铺满一个屏幕，不再左右滑动',
    '支持直接导入教务系统导出的整表（星期为列、节次为行）',
    '自动识别多段周次与单双周、合并同一门课的不同教师',
    '导入时自动读取开学日期与总周数',
    '修复内嵌浏览器地址栏与状态栏重叠，可正常输入网址',
    '修复教务系统登录被拦：支持 http、普通浏览器 UA、登录弹窗与第三方 Cookie'
  ],
  '1.2.1': [
    '新增课表模块：手动新增/编辑/删除课程，支持星期、节次、周次与单双周',
    '课程与备忘录双向关联：课程详情可管理笔记，备忘录可筛选并跳转课程',
    '支持 Excel / CSV 导入课表，自动识别字段，重复课程可覆盖或跳过',
    '新增课表导入内嵌浏览器框架，预留教务系统 DOM 解析钩子',
    '课程与关联关系全部本地保存，数据表预留扩展字段'
  ],
  '1.2.0': [
    '全新应用图标，各机型上居中显示一致',
    '新增「AI 小助手」一级入口，与部件、关于并列；功能仍在测试中',
    '公告与版本更新拆分：仅旧版本提示升级，版本页单独展示更新内容',
    '关于页「介绍」内容更新'
  ],
  '1.1.28': [
    '关于页四个条目图标改为线性矢量图标',
    '专注时长分布新增「今天」和「自定义」时间范围',
    '暗黑主题下专注页改用低饱和陶土色强调色'
  ],
  '1.1.27': [
    '玻璃主题进一步提透并移除彩色底斑',
    '按钮新增按压缩放与原生触感反馈',
    '五个部件图标统一为线性矢量图标'
  ]
};

function updateAboutVersion() {
  var el = document.getElementById('about-version');
  if (el) el.textContent = 'v' + APP_VERSION;
  // 关于首页条目上的版本号
  var entry = document.getElementById('about-version-entry');
  if (entry) entry.textContent = 'v' + APP_VERSION;
  renderVersionCurrentNotes();
}

function renderVersionCurrentNotes() {
  var box = document.getElementById('version-current-notes');
  if (!box) return;
  var notes = APP_CHANGELOG[APP_VERSION] || ['本版本为常规修复与体验优化。'];
  box.innerHTML = notes.map(function(n) {
    return '<li style="display:flex;gap:7px;"><span style="color:var(--focus-accent);flex-shrink:0;">·</span><span>' + esc(n) + '</span></li>';
  }).join('');
}

function renderSidebarTabs(w) {
  var container = document.getElementById('sidebar-tabs-container');
  if (!container) return;
  container.innerHTML = w.tabs.map(function(t, i) {
    return '<button onclick="switchTab(\'' + t.id + '\')" class="sidebar-tab flex items-center gap-3 px-3 py-2.5 rounded-[20px] text-sm ' + (i === 0 ? 'active font-semibold' : 'font-medium text-gray-500') + '" data-tab="' + t.id + '">'
      + '<svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">' + t.svg + '</svg>'
      + '<span class="hidden lg:inline">' + esc(t.name) + '</span>'
    + '</button>';
  }).join('');
}

function renderBottomNavTabs(w) {
  var container = document.getElementById('bottom-nav-tabs-container');
  if (!container) return;
  container.innerHTML = w.tabs.map(function(t, i) {
    return '<button onclick="switchTab(\'' + t.id + '\')" class="nav-tab flex flex-col items-center gap-0.5 py-1 px-4 rounded-[28px] transition-all' + (i === 0 ? ' active' : ' text-gray-400') + '" style="' + (i === 0 ? 'color: var(--nav-active-color);' : '') + '" data-tab="' + t.id + '">'
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
  updateAboutVersion();
  updateThemeSelection();
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
  } else if (currentWidget === 'focus') {
    if (typeof refreshFocus === 'function') await refreshFocus();
  } else if (currentWidget === 'schedule') {
    if (typeof refreshSchedule === 'function') await refreshSchedule();
    var scCount = (typeof scheduleCourses !== 'undefined' && scheduleCourses.length) || 0;
    var scBadge = document.getElementById('header-badge');
    if (scBadge) scBadge.textContent = scCount + ' 门课程';
    var scFoot = document.getElementById('sidebar-footer-text');
    if (scFoot) scFoot.textContent = scCount + ' 门课程';
  } else if (currentWidget === 'shua') {
    if (typeof initShua === 'function') await initShua();
  }
}

// ── Tab Navigation ────────────────────────
function tabIndexFor(id) {
  var w = WIDGETS.find(function(x){ return x.id === currentWidget; });
  if (!w) return -1;
  for (var i = 0; i < w.tabs.length; i++) if (w.tabs[i].id === id) return i;
  return -1;
}

function animatePageIn(page, forward) {
  if (!page) return;
  page.classList.remove('page-in-forward', 'page-in-back');
  void page.offsetWidth;
  page.classList.add(forward ? 'page-in-forward' : 'page-in-back');
  clearTimeout(page.__motionTimer);
  page.__motionTimer = setTimeout(function() {
    page.classList.remove('page-in-forward', 'page-in-back');
  }, 260);
}

function switchTab(tab) {
  if (!currentWidget) return;
  var page = document.getElementById('page-' + tab);
  var wasActive = !!page && page.classList.contains('active');
  var activePage = document.querySelector('.page.active');
  var prevTab = activePage && activePage.id.indexOf('page-') === 0 ? activePage.id.slice(5) : '';
  var prevIdx = tabIndexFor(prevTab);
  var nextIdx = tabIndexFor(tab);
  var forward = (prevIdx < 0 || nextIdx < 0) ? true : nextIdx >= prevIdx;

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  if (page) {
    page.classList.add('active');
    if (!wasActive) animatePageIn(page, forward);
  }

  // Bottom nav buttons (mobile)
  document.querySelectorAll('.nav-tab').forEach(function(b) {
    b.style.color = ''; b.classList.add('text-gray-400'); b.classList.remove('active');
  });
  var navBtn = document.querySelector('.nav-tab[data-tab="' + tab + '"]');
  if (navBtn) { navBtn.classList.remove('text-gray-400'); navBtn.classList.add('active'); navBtn.style.color = 'var(--nav-active-color)'; }

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
    if (tab === 'memo-data' && typeof initDataPage === 'function') initDataPage('memo');
  } else if (currentWidget === 'mindmap') {
    document.getElementById('page-workflows').classList.add('active');
    if (tab === 'workflows') currentMindmapType = 'workflow';
    if (tab === 'knowledge') currentMindmapType = 'knowledge';
    backToWorkflowsList(true); renderWorkflows();
  } else if (currentWidget === 'focus') {
    if (tab === 'stats') {
      if (typeof renderStats === 'function') renderStats();
    } else if (tab === 'focus-calendar') {
      if (typeof renderFocusCalendar === 'function') renderFocusCalendar();
    } else if (tab === 'focus-data') {
      if (typeof initDataPage === 'function') initDataPage('focus');
    } else {
      if (typeof renderFocusTasks === 'function') renderFocusTasks();
      if (typeof updateFocusTimerDisplay === 'function') updateFocusTimerDisplay();
    }
  } else if (currentWidget === 'schedule') {
    if (tab === 'timetable' && typeof renderTimetable === 'function') renderTimetable();
    if (tab === 'schedule-settings' && typeof renderScheduleSettingsPage === 'function') renderScheduleSettingsPage();
  } else if (currentWidget === 'shua') {
    if (tab !== 'shua-study' && typeof shuaPauseAutoNext === 'function') shuaPauseAutoNext();
    if (typeof renderShua === 'function') renderShua(tab);
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

// ── 弹层动画 ──────────────────────────────
// 打开时由 CSS 自动播放入场；关闭时先播放收回动画，再真正加上 hidden
(function initOverlayMotion() {
  if (typeof MutationObserver === 'undefined') return;
  var SELECTOR = '.modal-sheet, #schedule-clear-modal';
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var observed = [];
  var pending = [];
  var scheduled = false;

  var observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      if (record.attributeName !== 'class') return;
      if (pending.indexOf(record.target) < 0) pending.push(record.target);
    });
    if (scheduled || !pending.length) return;
    scheduled = true;
    setTimeout(flush, 0);
  });

  // 同一轮里可能连续开关，统一按最终状态处理一次
  function flush() {
    scheduled = false;
    var list = pending.slice();
    pending.length = 0;
    if (reduceMotion) return;
    list.forEach(handle);
  }

  function handle(el) {
    if (!el.classList) return;
    if (!el.classList.contains('hidden')) {
      if (!el.__closing) return;
      clearTimeout(el.__closeTimer);
      el.__closing = false;
      paused(function () { el.classList.remove('is-closing'); });
      return;
    }
    if (el.__closing || el.classList.contains('is-closing')) return;
    el.__closing = true;
    paused(function () {
      el.classList.remove('hidden');
      el.classList.add('is-closing');
    });
    el.__closeTimer = setTimeout(function () {
      paused(function () {
        el.classList.remove('is-closing');
        el.classList.add('hidden');
      });
      el.__closing = false;
    }, 160);
  }

  function observeAll() {
    observer.disconnect();
    observed = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));
    observed.forEach(function (el) {
      observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
  }

  // 自己改 class 时暂停观察，避免递归触发
  function paused(fn) {
    observer.disconnect();
    try { fn(); } finally { observeAll(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeAll);
  } else {
    observeAll();
  }
})();

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
    `<button type="button" onclick="selectColor('${c}')" class="w-10 h-10 rounded-full transition-all btn-jelly flex items-center justify-center shadow-md hover:scale-110 hover:shadow-xl" style="background:${c}; box-shadow: 0 2px 8px ${c}66, 0 0 16px ${c}33">${
      selectedColor === c ? '<svg class="w-5 h-5 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''
    }</button>`
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
    return `<div class="rounded-[20px] p-4 flex items-center gap-3 cursor-pointer shadow-sm card-hover" style="background:${c.color}; color:#fff;" onclick="goToCategory(${c.id})">
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-sm" style="color:#fff;">${esc(c.name)}</p>
        <p class="text-xs" style="color:rgba(255,255,255,0.75);">${count} 份资料</p>
      </div>
      <button onclick="event.stopPropagation();removeCategory(${c.id})" class="icon-btn-del cat-card-del" title="删除分类"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
    </div>`;
  }).join('');
}

function goToCategory(catId) {
  currentFilterCat = catId;
  switchTab('files');
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
  var id = ++_rfId;
  var catFilter = currentFilterCat;
  const files = await getFiles(catFilter);
  if (id !== _rfId) return;
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
    return `<div class="theme-card rounded-[20px] p-4 flex items-center gap-3 card-hover cursor-pointer" onclick="previewFile(${f.id})">
      <span class="text-2xl shrink-0">${icon}</span>
      <div class="flex-1 min-w-0">
        <span id="fname-${f.id}" class="font-medium text-sm truncate block" style="color: var(--card-text);">${esc(f.name)}</span>
        <p class="text-xs" style="color: var(--card-subtext);">${sizeStr}，${new Date(f.createdAt).toLocaleDateString('zh-CN')}</p>
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
  bar.innerHTML = `<button onclick="filterFiles(null)" class="cat-filter-btn shrink-0 px-4 py-1.5 rounded-full text-sm font-semibold btn-jelly transition-all ${currentFilterCat === null ? 'text-white btn-gradient shadow-md' : 'font-medium bg-gray-100 text-gray-600'}" data-cat="all">全部 (${files.length})</button>` +
    cats.map(c => {
      const count = files.filter(f => f.categoryId === c.id).length;
      const isActive = currentFilterCat === c.id;
      return `<button onclick="filterFiles(${c.id})" class="cat-filter-btn shrink-0 px-4 py-1.5 rounded-full text-sm btn-jelly transition-transform ${isActive ? 'font-semibold text-white btn-gradient shadow-md' : 'font-medium bg-gray-100 text-gray-600'}" data-cat="${c.id}">${esc(c.name)} (${count})</button>`;
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
  el.innerHTML = '<input id="rename-input-' + id + '" value="' + esc(oldName) + '" class="w-full text-sm font-medium rounded-[10px] px-2 py-0.5 outline-none border border-primary-500" style="background: rgba(128,128,128,0.18); color: var(--card-text);">';
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
    el.classList.toggle('ring-gray-400', sel);
    el.style.transform = sel ? 'scale(1.02)' : '';
  });
  updateUploadBtn();
}

function updateUploadBtn() {
  const btn = document.getElementById('upload-btn');
  if (selectedFile && selectedUploadCat !== null) {
    btn.disabled = false;
    btn.classList.remove('bg-gray-300');
    btn.classList.add('btn-gradient','shadow-lg');
  } else {
    btn.disabled = true;
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
  container.innerHTML = cats.map(c => `<div onclick="selectUploadCategory(${c.id})" class="upload-cat-option theme-card rounded-[20px] p-3 flex items-center gap-3 card-hover cursor-pointer transition-all" data-cat="${c.id}">
    <span class="cat-color" style="background:${c.color}"></span>
    <span class="text-sm font-medium" style="color: var(--card-text);">${esc(c.name)}</span>
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
    document.querySelectorAll('.upload-cat-option').forEach(el => { el.classList.remove('ring-2','ring-gray-400'); el.style.transform = ''; });
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
  container.innerHTML = '<img src="' + url + '" class="max-w-full max-h-full object-contain rounded-[10px]" style="transition: transform 0.15s ease; transform: scale(1); transform-origin: center center" alt="preview">';
}

async function renderWord(data, name) {
  var container = document.getElementById('preview-content');
  container.innerHTML = '<div class="text-white text-sm">正在加载 Word 预览组件...</div>';
  var ext = (name || '').toLowerCase().split('.').pop();
  if (ext !== 'docx') {
    container.innerHTML = '<div class="bg-white rounded-[20px] p-6 max-w-lg mx-auto text-center"><p class="text-gray-600 text-sm">.doc 格式无法直接在浏览器中预览</p><p class="text-gray-400 text-xs mt-2">请用 Word 打开后另存为 .docx 格式再上传</p></div>';
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
      container.innerHTML = '<div class="doc-paper rounded-[20px] p-4 md:p-6 max-w-3xl mx-auto word-preview" style="zoom:' + zoomLevel + '">' + result.value + '</div>';
      if (result.messages && result.messages.length > 0) {
        console.warn('Mammoth warnings:', result.messages);
      }
    }).catch(function(err) {
      container.innerHTML = '<div class="bg-white rounded-[20px] p-6 max-w-lg mx-auto text-center"><p class="text-red-500 text-sm">Word 解析失败</p><p class="text-gray-400 text-xs mt-2">' + esc(String(err)) + '</p></div>';
    });
  } catch (e) {
    container.innerHTML = '<div class="bg-white rounded-[20px] p-6 max-w-lg mx-auto text-center"><p class="text-red-500 text-sm">Word 解析失败</p><p class="text-gray-400 text-xs mt-2">' + esc(String(e)) + '</p></div>';
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
    container.innerHTML = '<div class="doc-paper rounded-[20px] p-2 md:p-4 max-w-full mx-auto excel-preview" style="zoom:' + zoomLevel + '">' + html + '</div>';
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
    container.innerHTML = '<div class="bg-white rounded-[20px] p-6 max-w-lg mx-auto text-center"><p class="text-red-500 text-sm">Excel 解析失败</p><p class="text-gray-400 text-xs mt-2">' + esc(String(e)) + '</p></div>';
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
async function populateMemoCourseOptions(selectedId) {
  var sel = document.getElementById('memo-course-input');
  if (!sel) return;
  var courses = [];
  try { courses = await getCourses(); scheduleCourses = courses; } catch (e) { courses = []; }
  courses.sort(function(a, b) { return (a.dayOfWeek - b.dayOfWeek) || (a.startSection - b.startSection) || String(a.name).localeCompare(String(b.name)); });
  sel.innerHTML = '<option value="">不关联课程</option>' + courses.map(function(c) {
    return '<option value="' + c.id + '">' + esc(c.name) + (c.teacher ? ' · ' + esc(c.teacher) : '') + '</option>';
  }).join('');
  sel.value = selectedId ? String(selectedId) : '';
  if (sel.value !== String(selectedId || '')) sel.value = '';
}

function showAddMemo(courseId) {
  editingMemoId = null;
  document.getElementById('memo-modal-title').textContent = '新建备忘录';
  document.getElementById('memo-confirm-btn').textContent = '确认创建';
  document.getElementById('memo-title-input').value = '';
  document.getElementById('memo-content-input').value = '';
  document.getElementById('memo-deadline-input').value = '';
  document.getElementById('memo-autodelete-check').checked = false;
  populateMemoCourseOptions(courseId || '');
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
    populateMemoCourseOptions(m.courseId || '');
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
  var courseIdVal = document.getElementById('memo-course-input').value;
  var courseId = courseIdVal ? Number(courseIdVal) : null;

  if (editingMemoId) {
    await updateMemo(editingMemoId, { title: title, content: content, deadline: deadline, autoDelete: autoDelete, courseId: courseId });
    toast('备忘录已更新');
  } else {
    await addMemo(title, content, deadline, autoDelete, courseId);
    toast('备忘录已创建');
  }
  hideMemoModal();
  await refreshAll();
  if (currentWidget === 'schedule' && typeof renderCourseDetail === 'function' && scheduleDetailCourseId) renderCourseDetail();
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
  if (now > deadline) return { label: '已过期，' + days + '天后自动删除', color: '#f97316', urgent: true };
  var daysToDeadline = Math.ceil((deadline - now) / (24 * 60 * 60 * 1000));
  if (daysToDeadline <= 1) return { label: '即将到期，' + days + '天后删除', color: '#e11d48', urgent: true };
  if (daysToDeadline <= 3) return { label: daysToDeadline + '天后到期，' + days + '天后删除', color: '#f97316', urgent: false };
  return { label: daysToDeadline + '天后到期', color: '#6b7280', urgent: false };
}

function setMemoFilter(mode) {
  memoFilter = mode === 'linked' ? 'linked' : 'all';
  var all = document.getElementById('memo-filter-all');
  var linked = document.getElementById('memo-filter-linked');
  if (all) {
    all.style.background = memoFilter === 'all' ? 'rgba(128,128,128,0.12)' : 'transparent';
    all.style.color = memoFilter === 'all' ? 'var(--text-primary)' : 'var(--text-secondary)';
  }
  if (linked) {
    linked.style.background = memoFilter === 'linked' ? 'rgba(128,128,128,0.12)' : 'transparent';
    linked.style.color = memoFilter === 'linked' ? 'var(--text-primary)' : 'var(--text-secondary)';
  }
  renderMemos();
}

async function renderMemos() {
  await cleanupExpiredMemos();
  var memos = await getMemos();
  if (typeof scheduleCourses !== 'undefined' && !scheduleCourses.length) {
    try { scheduleCourses = await getCourses(); } catch (e) { /* ignore */ }
  }
  if (memoFilter === 'linked') memos = memos.filter(function(m) { return !!m.courseId; });
  var container = document.getElementById('memos-list');
  if (memos.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-400 py-12 text-sm col-span-full">'
      + (memoFilter === 'linked' ? '还没有关联课程的备忘录，新建时可以选择课程' : '还没有备忘录，点击上方按钮创建')
      + '</div>';
    return;
  }
  container.innerHTML = memos.sort(function(a,b){ return b.createdAt - a.createdAt; }).map(function(m) {
    var info = getDaysInfo(m);
    var preview = (m.content || '').substring(0, 80);
    if ((m.content || '').length > 80) preview += '...';
    var course = m.courseId ? (typeof courseById === 'function' ? courseById(m.courseId) : null) : null;
    var courseTag = '';
    if (m.courseId) {
      courseTag = '<div class="mb-2"><button onclick="event.stopPropagation();jumpToCourse(' + m.courseId + ')" class="memo-course-tag">'
        + '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>'
        + '<span>' + esc(course ? course.name : '关联课程已删除') + '</span></button></div>';
    }
    return '<div class="theme-card rounded-[20px] p-4 card-hover memo-card">'
      + '<div class="flex items-start justify-between mb-2">'
        + '<h4 class="font-semibold text-sm flex-1 min-w-0" style="color: var(--card-text);">' + esc(m.title) + '</h4>'
        + '<div class="flex gap-0.5 shrink-0 ml-2">'
          + '<button onclick="event.stopPropagation();showEditMemo(' + m.id + ')" class="icon-btn-edit" title="编辑"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>'
          + '<button onclick="event.stopPropagation();deleteMemoById(' + m.id + ')" class="icon-btn-del" title="删除"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
        + '</div>'
      + '</div>'
      + (preview ? '<p class="text-xs mb-2" style="color: var(--card-subtext);">' + esc(preview) + '</p>' : '')
      + courseTag
      + '<div class="flex items-center justify-between text-xs">'
        + '<span style="color: var(--card-subtext);">' + new Date(m.createdAt).toLocaleDateString('zh-CN') + (m.autoDelete ? '，自动删除' : '') + '</span>'
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
    memoContainer.innerHTML = '<div class="flex items-center gap-2 mb-3"><h3 class="font-semibold text-sm" style="color: var(--text-primary);">' + selectedDateStr + ' (' + dayMemos.length + ' 条备忘)</h3></div>'
      + dayMemos.sort(function(a,b){ return b.createdAt - a.createdAt; }).map(function(m) {
        var info = getDaysInfo(m);
        var preview = (m.content || '').substring(0, 80);
        if ((m.content || '').length > 80) preview += '...';
        return '<div class="theme-card rounded-[20px] p-4 card-hover memo-card mb-2">'
          + '<div class="flex items-start justify-between mb-2">'
            + '<h4 class="font-semibold text-sm flex-1 min-w-0" style="color: var(--card-text);">' + esc(m.title) + '</h4>'
            + '<div class="flex gap-0.5 shrink-0 ml-2">'
              + '<button onclick="event.stopPropagation();showEditMemo(' + m.id + ')" class="icon-btn-edit" title="编辑"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>'
              + '<button onclick="event.stopPropagation();deleteMemoById(' + m.id + ')" class="icon-btn-del" title="删除"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
            + '</div>'
          + '</div>'
          + (preview ? '<p class="text-xs mb-2" style="color: var(--card-subtext);">' + esc(preview) + '</p>' : '')
          + '<div class="flex items-center justify-between text-xs">'
            + '<span style="color: var(--card-subtext);">' + (m.autoDelete ? '自动删除' : '手动删除') + '</span>'
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
let mmPanX = 0;
let mmPanY = 0;
let mmPan = null; // { startX, startY, panX, panY }

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
      b.classList.add('border-gray-400','bg-gray-100','text-gray-600');
      b.classList.remove('border-gray-200','text-gray-500');
    } else {
      b.classList.remove('border-gray-400','bg-gray-100','text-gray-600');
      b.classList.add('border-gray-200','text-gray-500');
    }
  });
}

function selectNodeSize(size) {
  document.querySelectorAll('.node-size-btn').forEach(function(b) {
    if (b.dataset.size === size) {
      b.classList.add('border-gray-400','bg-gray-100','text-gray-600');
      b.classList.remove('border-gray-200','text-gray-500');
    } else {
      b.classList.remove('border-gray-400','bg-gray-100','text-gray-600');
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
    var selShapeBtn = document.querySelector('.node-shape-btn.border-gray-400');
    var shape = selShapeBtn ? selShapeBtn.dataset.shape : 'rounded';
    var selSizeBtn = document.querySelector('.node-size-btn.border-gray-400');
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
    div.className = 'theme-card rounded-[20px] p-4 card-hover cursor-pointer';
    div.onclick = function(wf) { return function() { enterWorkflow(wf.id); }; }(w);
    var infoHtml = '';
    if (isKnowledge) {
      infoHtml = '<div class="flex items-center gap-2 text-xs mb-2" style="color: var(--card-subtext);"><span>' + total + ' 个节点</span></div>';
    } else {
      var doneCount = nodes.filter(function(n) { return n.done; }).length;
      var progress = total > 0 ? Math.round(doneCount / total * 100) : 0;
      infoHtml = '<div class="flex items-center gap-2 text-xs mb-2" style="color: var(--card-subtext);">'
        + '<span>' + total + ' 个节点</span>'
        + '<span>，</span>'
        + '<span>' + doneCount + ' 已完成</span>'
        + '</div>'
        + '<div class="w-full rounded-full h-1.5 overflow-hidden" style="background: rgba(128,128,128,0.18);">'
          + '<div class="h-full rounded-full transition-all duration-500" style="width:' + progress + '%; background: linear-gradient(90deg, #10b981, #34d399);"></div>'
        + '</div>';
    }
    div.innerHTML = '<div class="flex items-start justify-between mb-2">'
      + '<h4 class="font-semibold text-sm flex-1 min-w-0" style="color: var(--card-text);">' + esc(w.name) + '</h4>'
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
    mmPanX = 0;
    mmPanY = 0;
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

  var H_GAP = 80, V_GAP = 40;

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
  var pad = 120;
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
  var canvasW = Math.max(layout.w, 900);
  var canvasH = Math.max(layout.h, 700);

  var svgLines = drawConnections(nodes, positions, isKnowledge);

  // Compute node depth levels for aria-level
  var levelMap = {};
  function assignLevel(nid, level) {
    levelMap[nid] = level;
    nodes.filter(function(x) { return x.parentId === nid; }).forEach(function(child) {
      assignLevel(child.id, level + 1);
    });
  }
  var rootNode = nodes.find(function(x) { return x.parentId == null; });
  if (rootNode) assignLevel(rootNode.id, 1);

  // Arrow SVG for direction buttons (replaces "+" to avoid ad-blocker false positives)
  var arrowUp = '<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 15l7-7 7 7"/></svg>';
  var arrowDown = '<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7"/></svg>';
  var arrowLeft = '<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M15 5l-7 7 7 7"/></svg>';
  var arrowRight = '<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7"/></svg>';

  var nodesHtml = nodes.map(function(n) {
    var pos = positions[n.id];
    if (!pos) return '';
    var isRoot = n.parentId == null;
    var nodeLevel = levelMap[n.id] || 1;
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
      bottomHtml = '<div class="flex justify-end mt-2 pt-2" style="border-top:1px solid rgba(128,128,128,0.22)">'
        + '<div class="flex gap-0.5">'
          + '<button onclick="event.stopPropagation();showEditNode(' + n.id + ')" class="icon-btn-edit" title="编辑"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>'
          + '<button onclick="event.stopPropagation();deleteNodeById(' + n.id + ')" class="icon-btn-del" title="删除"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
        + '</div>'
      + '</div>';
    } else {
      bottomHtml = '<div class="flex items-center justify-between mt-2 pt-2" style="border-top:1px solid rgba(128,128,128,0.22)">'
        + '<button onclick="event.stopPropagation();toggleNodeDone(' + n.id + ')" class="text-xs px-2 py-0.5 rounded-full font-medium transition-all" style="font-size:0.7rem;'
          + (n.done ? 'background:rgba(16,185,129,0.18);color:#34d399' : 'background:rgba(128,128,128,0.18);color:var(--card-subtext)') + '">'
          + (n.done ? '取消' : '完成') + '</button>'
        + '<div class="flex gap-0.5">'
          + '<button onclick="event.stopPropagation();showEditNode(' + n.id + ')" class="icon-btn-edit" title="编辑"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>'
          + '<button onclick="event.stopPropagation();deleteNodeById(' + n.id + ')" class="icon-btn-del" title="删除"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>'
        + '</div>'
      + '</div>';
    }
    return '<div class="mindmap-node' + knowledgeClass + doneClass + rootClass + shapeClass + sizeClass + '" role="treeitem" aria-level="' + nodeLevel + '" aria-label="' + esc(n.title) + '" style="left:' + pos.x + 'px; top:' + pos.y + 'px;" data-node-id="' + n.id + '">'
      + '<button class="mindmap-dir-btn top" onclick="event.stopPropagation();quickAddNode(' + n.id + ',\'up\')" aria-label="在上方添加子节点">' + arrowUp + '</button>'
      + '<button class="mindmap-dir-btn bottom" onclick="event.stopPropagation();quickAddNode(' + n.id + ',\'down\')" aria-label="在下方添加子节点">' + arrowDown + '</button>'
      + '<button class="mindmap-dir-btn left" onclick="event.stopPropagation();quickAddNode(' + n.id + ',\'left\')" aria-label="在左侧添加子节点">' + arrowLeft + '</button>'
      + '<button class="mindmap-dir-btn right" onclick="event.stopPropagation();quickAddNode(' + n.id + ',\'right\')" aria-label="在右侧添加子节点">' + arrowRight + '</button>'
      + '<div class="mindmap-node-title">' + esc(n.title) + '</div>'
      + (descSnippet ? '<div class="text-xs" style="color: var(--card-subtext);">' + esc(descSnippet) + '</div>' : '')
      + bottomHtml
    + '</div>';
  }).join('');

  canvas.innerHTML = ''
    + '<div id="mindmap-zoom-container" role="tree" aria-label="思维导图" style="transform:scale(' + mindmapZoom + '); transform-origin:0 0; width:' + canvasW + 'px; height:' + canvasH + 'px;">'
    + '<svg class="mindmap-svg" style="width:' + canvasW + 'px; height:' + canvasH + 'px;">' + svgLines + '</svg>'
    + '<div role="presentation" style="position:relative; width:' + canvasW + 'px; height:' + canvasH + 'px;">'
    + nodesHtml
    + '</div>'
    + '</div>';
  applyMindmapTransform();
  canvas.onwheel = onMindmapWheel;
  canvas.onpointerdown = onMindmapPointerDown;
  canvas.ontouchstart = onMindmapTouchStart;
  canvas.ontouchmove = onMindmapTouchMove;
  canvas.ontouchend = onMindmapTouchEnd;

  if (!document._mmPanBound) {
    document._mmPanBound = true;
    document.addEventListener('pointermove', onPanPointerMove);
    document.addEventListener('pointerup', onPanPointerUp);
  }

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

  // Center on root
  var rootPos = positions[layout.rootId];
  if (rootPos) {
    var rootNode = nodes.find(function(n) { return n.id === layout.rootId; });
    var rSize = rootNode ? (rootNode.size || 'medium') : 'medium';
    var rootW = rSize === 'small' ? 120 : rSize === 'large' ? 210 : 160;
    var rootH = rSize === 'small' ? 55 : rSize === 'large' ? 90 : 70;
    mmPanX = canvas.clientWidth / (2 * mindmapZoom) - rootPos.x - rootW / 2;
    mmPanY = canvas.clientHeight / (2 * mindmapZoom) - rootPos.y - rootH / 2;
    applyMindmapTransform();
  }

  } catch (err) {
    console.error('renderMindMap error:', err);
    canvas.innerHTML = '<div class="text-center text-red-400 py-12 text-sm">加载失败: ' + esc(err.message || String(err)) + '<br><button onclick="backToWorkflowsList()" class="text-gray-500 underline mt-2 text-xs">返回列表</button></div>';
  }
}

// ── Mind Map Zoom ──────────────────────────
function updateMindmapZoomLabel() {
  var label = document.getElementById('mindmap-zoom-label');
  if (label) label.textContent = Math.round(mindmapZoom * 100) + '%';
}

function applyMindmapTransform() {
  var container = document.getElementById('mindmap-zoom-container');
  if (container) {
    container.style.transform = 'translate(' + mmPanX + 'px, ' + mmPanY + 'px) scale(' + mindmapZoom + ')';
    container.style.transformOrigin = '0 0';
  }
  updateMindmapZoomLabel();
}

function applyMindmapZoom(oldZoom, anchorX, anchorY) {
  var canvas = document.getElementById('mindmap-canvas');
  if (canvas && oldZoom && oldZoom !== mindmapZoom) {
    var ratio = mindmapZoom / oldZoom;
    var ax = anchorX != null ? anchorX : canvas.clientWidth / 2;
    var ay = anchorY != null ? anchorY : canvas.clientHeight / 2;
    mmPanX = ax - ratio * (ax - mmPanX);
    mmPanY = ay - ratio * (ay - mmPanY);
  }
  applyMindmapTransform();
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

async function renderMindmapToCanvas(scale) {
  var nodes = await getWorkflowNodes(currentWorkflowId);
  if (!nodes.length) return null;
  var isKnowledge = currentMindmapType === 'knowledge';
  var layout = calcLayout(nodes);
  var positions = layout.positions;
  var canvasW = Math.max(layout.w, 900);
  var canvasH = Math.max(layout.h, 700);
  scale = scale || 2;
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
    var borderColor = n.done ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.18)';

    ctx.save();
    var radius = shape === 'pill' ? h / 2 : 12;
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, w, h);

    if (isRoot) {
      var grad = ctx.createLinearGradient(x, y, x + w, y + h);
      grad.addColorStop(0, 'rgba(0,0,0,0.03)');
      grad.addColorStop(1, 'rgba(0,0,0,0.01)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    }

    if (n.done && !isKnowledge) {
      ctx.fillStyle = 'rgba(0,0,0,0.04)';
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
  // Open window synchronously (before any await) to avoid popup blocker
  var w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { toast('请允许浏览器弹窗后重试'); return; }
  w.document.write('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#888"><p>正在生成...</p></body></html>');
  try {
    var result = await renderMindmapToCanvas();
    if (!result) { w.close(); toast('没有可导出的节点'); return; }
    var dataUrl = result.canvas.toDataURL('image/png');
    w.document.open();
    w.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + result.name + '</title>');
    w.document.write('<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;margin:30px;text-align:center;color:#333}img{max-width:100%;height:auto;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,0.1)}h1{margin-bottom:20px;font-size:20px}@media print{body{margin:0}img{max-width:100%;box-shadow:none;border-radius:0}}</style>');
    w.document.write('</head><body><h1>' + result.name + '</h1><img src="' + dataUrl + '" /></body></html>');
    w.document.close();
    w.focus();
    setTimeout(function() { w.print(); }, 800);
    toast('请在打印对话框中保存为 PDF');
  } catch (err) {
    w.close();
    console.error('exportMindmapPDF error:', err);
    toast('导出失败: ' + (err.message || String(err)));
  }
}

async function exportMindmapWord() {
  try {
    // Use 1x scale for smaller image size in Word
    var result = await renderMindmapToCanvas(1);
    if (!result) { toast('没有可导出的节点'); return; }
    // Use JPEG for much smaller data URL than PNG
    var dataUrl = result.canvas.toDataURL('image/jpeg', 0.85);
    var nodes = result.nodes;

    // Build hierarchical outline (text-only, no image dependency)
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
    html += '<style>body{font-family:"Microsoft YaHei",sans-serif;margin:30px;color:#333}h1{font-size:22px;border-bottom:2px solid #374151;padding-bottom:8px}h2{font-size:16px;margin-top:24px;color:#374151}img{max-width:100%;border-radius:12px}ul{margin-left:20px}li{margin:2px 0}</style>';
    html += '</head><body>';
    html += '<h1>' + result.name + '</h1>';
    html += '<p style="color:#888">类型：' + (result.isKnowledge ? '知识导图' : '工作流思维导图') + ' | 节点数：' + nodes.length + ' | 导出时间：' + new Date().toLocaleString() + '</p>';
    html += '<img src="' + dataUrl + '" style="margin:20px 0;border:1px solid #eee" />';
    html += '<h2>节点大纲</h2>';
    html += outline;
    html += '</body></html>';

    var blob = new Blob(['﻿' + html], { type: 'application/octet-stream' });
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

function onMindmapPointerDown(e) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target.closest('.mindmap-node') || e.target.closest('button')) return;
  if (e.target.closest('#mindmap-quick-add')) return;
  var canvas = document.getElementById('mindmap-canvas');
  mmPan = { startX: e.clientX, startY: e.clientY, panX: mmPanX, panY: mmPanY };
  canvas.style.cursor = 'grabbing';
  canvas.setPointerCapture(e.pointerId);
}

function onPanPointerMove(e) {
  if (!mmPan) return;
  mmPanX = mmPan.panX + (e.clientX - mmPan.startX) / mindmapZoom;
  mmPanY = mmPan.panY + (e.clientY - mmPan.startY) / mindmapZoom;
  applyMindmapTransform();
}

function onPanPointerUp(e) {
  if (!mmPan) return;
  var canvas = document.getElementById('mindmap-canvas');
  if (canvas) canvas.style.cursor = '';
  mmPan = null;
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
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', '添加子节点');

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

  popup.innerHTML = '<div style="font-size:0.7rem; color:var(--text-tertiary); margin-bottom:4px">向' + (dirLabels[direction] || direction) + '添加子节点</div>'
    + '<input id="quick-add-input" placeholder="节点标题" onkeydown="if(event.key===\'Enter\')confirmQuickAdd()">'
    + '<div style="display:flex; gap:6px; margin:6px 0;" id="quick-shape-select">'
      + '<button onclick="event.stopPropagation();document.getElementById(\'quick-shape-select\').dataset.shape=\'rounded\';renderQuickShapeBtns()" class="quick-shape-btn quick-opt active" data-shape="rounded" style="border-radius:12px; font-size:0.65rem;">圆角</button>'
      + '<button onclick="event.stopPropagation();document.getElementById(\'quick-shape-select\').dataset.shape=\'pill\';renderQuickShapeBtns()" class="quick-shape-btn quick-opt" data-shape="pill" style="border-radius:30px; font-size:0.65rem;">胶囊</button>'
    + '</div>'
    + '<div style="display:flex; gap:6px; margin:0 0 6px 0;" id="quick-size-select" data-size="' + (currentMindmapType === 'knowledge' ? 'large' : 'medium') + '">'
      + '<button onclick="event.stopPropagation();document.getElementById(\'quick-size-select\').dataset.size=\'small\';renderQuickSizeBtns()" class="quick-size-btn quick-opt" data-size="small" style="border-radius:10px; font-size:0.6rem;">小</button>'
      + '<button onclick="event.stopPropagation();document.getElementById(\'quick-size-select\').dataset.size=\'medium\';renderQuickSizeBtns()" class="quick-size-btn quick-opt' + (currentMindmapType === 'knowledge' ? '' : ' active') + '" data-size="medium" style="border-radius:6px; font-size:0.6rem;">中</button>'
      + '<button onclick="event.stopPropagation();document.getElementById(\'quick-size-select\').dataset.size=\'large\';renderQuickSizeBtns()" class="quick-size-btn quick-opt' + (currentMindmapType === 'knowledge' ? ' active' : '') + '" data-size="large" style="border-radius:6px; font-size:0.6rem;">大</button>'
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
    b.classList.toggle('active', b.dataset.shape === selected);
  });
}

function renderQuickSizeBtns() {
  var container = document.getElementById('quick-size-select');
  if (!container) return;
  var selected = container.dataset.size || 'medium';
  var btns = container.querySelectorAll('.quick-size-btn');
  btns.forEach(function(b) {
    b.classList.toggle('active', b.dataset.size === selected);
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
