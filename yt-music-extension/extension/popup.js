// popup.js v3 — Background polling, chrome.storage, realtime %

const SERVER = 'http://localhost:9876';

let videoInfo      = null;
let selectedFormat = 'mp3';
let selectedGenre  = '';
let library        = [];
let genres         = ['Nhạc trẻ', 'Ballad', 'V-Pop', 'K-Pop', 'EDM', 'Nhạc phim', 'Khác'];
let libFilter      = 'all';
let libSearch      = '';
let uiPollInterval = null; // poll UI khi popup đang mở

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadStorage();
  setupTabs();
  setupFormatBtns();
  setupGenreUI();
  setupLibraryUI();
  setupServerTab();
  setupModal();

  document.getElementById('dlBtn').addEventListener('click', startDownload);

  // Lắng nghe thông báo từ background worker
  chrome.runtime.onMessage.addListener(onBackgroundMessage);

  await checkServer();
  await loadVideoInfo();
  renderLibrary();

  // Khi popup mở lại, kiểm tra xem có job đang chạy không
  resumeActiveJob();
});

// ── Lắng nghe message từ background ──────────────────────────────────────
function onBackgroundMessage(msg) {
  if (msg.action === 'jobDone') {
    stopUIPolling();
    showProgress(false);
    showSuccess(`✅ Đã lưu: <b>${msg.filename || 'file'}</b>`);
    resetBtn();
    loadStorage().then(renderLibrary); // reload library từ storage
    // Reset duplicate badge
    if (videoInfo) renderVideoInfo(videoInfo);
  }
  if (msg.action === 'jobError') {
    stopUIPolling();
    showProgress(false);
    showError('❌ ' + (msg.error || 'Lỗi không xác định'));
    resetBtn();
  }
}

// ── Khi popup mở lại: resume job đang chạy ───────────────────────────────
async function resumeActiveJob() {
  const result = await chrome.storage.local.get('activeJob');
  const job    = result.activeJob;
  if (!job) return;

  if (job.status === 'downloading' || job.status === 'queued') {
    // Hiện lại UI đang tải
    const btn = document.getElementById('dlBtn');
    btn.disabled    = true;
    btn.textContent = '⏬ ĐANG TẢI...';
    showProgress(true);
    updateProgress(job.percent || 0, job.speed || '');
    startUIPolling(job.jobId);
  } else if (job.status === 'done') {
    showSuccess(`✅ Đã lưu: <b>${job.filename || 'file'}</b>`);
    chrome.runtime.sendMessage({ action: 'clearJob' });
  }
}

// ── UI Polling — chỉ cập nhật giao diện, background lo phần tải ──────────
function startUIPolling(jobId) {
  stopUIPolling();
  uiPollInterval = setInterval(async () => {
    const result = await chrome.storage.local.get('activeJob');
    const job    = result.activeJob;
    if (!job || job.jobId !== jobId) { stopUIPolling(); return; }

    updateProgress(job.percent || 0, job.speed || '');

    if (job.status === 'done') {
      stopUIPolling();
      showProgress(false);
      showSuccess(`✅ Đã lưu: <b>${job.filename || 'file'}</b>`);
      resetBtn();
      await loadStorage();
      renderLibrary();
      if (videoInfo) renderVideoInfo(videoInfo);
      chrome.runtime.sendMessage({ action: 'clearJob' });
    } else if (job.status === 'error') {
      stopUIPolling();
      showProgress(false);
      showError('❌ ' + (job.error || 'Lỗi không xác định'));
      resetBtn();
      chrome.runtime.sendMessage({ action: 'clearJob' });
    }
  }, 500);
}

function stopUIPolling() {
  if (uiPollInterval) { clearInterval(uiPollInterval); uiPollInterval = null; }
}

// ── Storage (chrome.storage.local thay localStorage) ─────────────────────
async function loadStorage() {
  const result = await chrome.storage.local.get(['ytms_library', 'ytms_genres']);
  if (result.ytms_library) library = result.ytms_library;
  if (result.ytms_genres)  genres  = result.ytms_genres;
}

async function saveLibrary() {
  await chrome.storage.local.set({ ytms_library: library });
}

async function saveGenres() {
  await chrome.storage.local.set({ ytms_genres: genres });
}

// ── Tabs ──────────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'library') renderLibrary();
      if (tab === 'server')  refreshServerStatus();
    });
  });
}

// ── Format buttons ────────────────────────────────────────────────────────
function setupFormatBtns() {
  document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFormat = btn.dataset.format;
    });
  });
}

// ── Genre UI ──────────────────────────────────────────────────────────────
function setupGenreUI() {
  renderGenreSelect();
  document.getElementById('genreSelect').addEventListener('change', e => {
    selectedGenre = e.target.value;
  });
  document.getElementById('addGenreBtn').addEventListener('click', () => {
    document.getElementById('genreModal').style.display = 'flex';
    document.getElementById('genreInput').value = '';
    setTimeout(() => document.getElementById('genreInput').focus(), 50);
  });
}

function renderGenreSelect() {
  const sel = document.getElementById('genreSelect');
  sel.innerHTML = '';
  genres.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    sel.appendChild(opt);
  });
  selectedGenre = genres[0] || '';
}

// ── Modal ─────────────────────────────────────────────────────────────────
function setupModal() {
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalOk').addEventListener('click', addGenre);
  document.getElementById('genreInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addGenre();
    if (e.key === 'Escape') closeModal();
  });
  document.getElementById('genreModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
}

function closeModal() { document.getElementById('genreModal').style.display = 'none'; }

async function addGenre() {
  const val = document.getElementById('genreInput').value.trim();
  if (!val) return;
  if (!genres.includes(val)) {
    genres.push(val);
    await saveGenres();
    renderGenreSelect();
    document.getElementById('genreSelect').value = val;
    selectedGenre = val;
  }
  closeModal();
}

// ── Server check ──────────────────────────────────────────────────────────
async function checkServer() {
  const online = await pingServer();
  updateServerUI(online);
  return online;
}

async function pingServer() {
  try {
    const res = await fetch(`${SERVER}/ping`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}

function updateServerUI(online) {
  const dot  = document.getElementById('serverDot');
  const qBtn = document.getElementById('quickServerBtn');
  dot.className     = `status-dot ${online ? 'online' : 'offline'}`;
  qBtn.textContent  = online ? 'Online' : 'Offline';
  qBtn.className    = `btn-server ${online ? 'running' : ''}`;
  qBtn.onclick = () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="server"]').classList.add('active');
    document.getElementById('tab-server').classList.add('active');
    refreshServerStatus();
  };
}

// ── Video info ────────────────────────────────────────────────────────────
async function loadVideoInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url || !tab.url.includes('youtube.com/watch')) {
    document.getElementById('notYt').style.display      = 'block';
    document.getElementById('videoContent').style.display = 'none';
    return;
  }
  document.getElementById('notYt').style.display      = 'none';
  document.getElementById('videoContent').style.display = 'block';
  try {
    const info = await chrome.tabs.sendMessage(tab.id, { action: 'getVideoInfo' });
    if (!info) { showError('Không lấy được thông tin video.'); return; }
    videoInfo = info;
    renderVideoInfo(info);
  } catch {
    showError('Không thể kết nối trang YouTube. Hãy reload trang.');
  }
}

function renderVideoInfo(info) {
  document.getElementById('thumbnail').src              = info.thumbnail;
  document.getElementById('videoTitle').textContent     = info.title   || 'Không rõ tiêu đề';
  document.getElementById('videoChannel').textContent   = info.channel || '';

  if (info.hasPlaylist) {
    document.getElementById('playlistBadge').style.display   = 'block';
    document.getElementById('playlistWarning').style.display = 'flex';
  }

  const dup = library.find(item => item.videoId === info.videoId);
  if (dup) {
    document.getElementById('dupBadge').style.display    = 'block';
    document.getElementById('dupWarning').style.display  = 'flex';
    document.getElementById('dupWarningText').innerHTML  =
      `Video này đã tải <strong>${dup.genre}</strong> dạng <strong>${dup.format.toUpperCase()}</strong> vào ${dup.date}. Vẫn tải lại?`;
    document.getElementById('dlBtn').style.background   = '#c1121f';
    document.getElementById('dlBtn').textContent        = '⬇ TẢI LẠI';
  } else {
    document.getElementById('dupBadge').style.display   = 'none';
    document.getElementById('dupWarning').style.display = 'none';
    document.getElementById('dlBtn').textContent        = '⬇ TẢI VỀ';
    document.getElementById('dlBtn').style.background   = '';
  }
}

// ── Download ──────────────────────────────────────────────────────────────
async function startDownload() {
  if (!videoInfo) { showError('Chưa có thông tin video.'); return; }

  const online = await checkServer();
  if (!online) {
    showError('Server chưa chạy. Vào tab <b>🖥 Server</b> để khởi động.');
    return;
  }

  const btn = document.getElementById('dlBtn');
  btn.disabled    = true;
  btn.textContent = '⏳ ĐANG GỬI...';
  hideStatus();
  showProgress(true);

  try {
    const res = await fetch(`${SERVER}/download`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: videoInfo.cleanUrl, format: selectedFormat, title: videoInfo.title })
    });
    const data = await res.json();
    if (!data.job_id) throw new Error(data.error || 'Server lỗi');

    btn.textContent = '⏬ ĐANG TẢI...';

    // Giao việc poll cho background worker — tiếp tục kể cả khi popup đóng
    chrome.runtime.sendMessage({
      action:    'startPoll',
      jobId:     data.job_id,
      videoInfo: videoInfo,
      format:    selectedFormat,
      genre:     selectedGenre
    });

    // Đồng thời poll UI ngay trong popup
    startUIPolling(data.job_id);

  } catch (e) {
    btn.disabled    = false;
    btn.textContent = '⬇ TẢI VỀ';
    showProgress(false);
    showError('Lỗi: ' + e.message);
  }
}

// ── Library ───────────────────────────────────────────────────────────────
function setupLibraryUI() {
  document.getElementById('libSearch').addEventListener('input', e => {
    libSearch = e.target.value.toLowerCase();
    renderLibrary();
  });
}

function renderLibrary() {
  const allGenres  = [...new Set(library.map(i => i.genre))];
  const allFormats = [...new Set(library.map(i => i.format))];
  document.getElementById('statTotal').textContent   = library.length;
  document.getElementById('statGenres').textContent  = allGenres.length;
  document.getElementById('statFormats').textContent = allFormats.length;

  const gf = document.getElementById('genreFilter');
  gf.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = `gf-btn ${libFilter === 'all' ? 'active' : ''}`;
  allBtn.textContent = 'Tất cả';
  allBtn.addEventListener('click', () => { libFilter = 'all'; renderLibrary(); });
  gf.appendChild(allBtn);
  allGenres.forEach(g => {
    const b = document.createElement('button');
    b.className = `gf-btn ${libFilter === g ? 'active' : ''}`;
    b.textContent = g;
    b.addEventListener('click', () => { libFilter = g; renderLibrary(); });
    gf.appendChild(b);
  });

  const filtered = library.filter(item => {
    const matchGenre  = libFilter === 'all' || item.genre === libFilter;
    const matchSearch = !libSearch || item.title.toLowerCase().includes(libSearch) || (item.channel || '').toLowerCase().includes(libSearch);
    return matchGenre && matchSearch;
  });

  const list = document.getElementById('libList');
  if (filtered.length === 0) {
    list.innerHTML = `<div class="lib-empty"><div class="big">🎵</div><p>${library.length === 0 ? 'Thư viện trống.<br>Tải bài hát đầu tiên!' : 'Không tìm thấy kết quả.'}</p></div>`;
    return;
  }
  list.innerHTML = '';
  filtered.forEach(item => {
    const div = document.createElement('div');
    div.className = 'lib-item';
    div.innerHTML = `
      <img class="lib-thumb" src="${item.thumbnail}" alt="" onerror="this.style.display='none'">
      <div class="lib-info">
        <div class="lib-title">${escHtml(item.title)}</div>
        <div class="lib-meta">
          <span class="lib-genre-tag">${escHtml(item.genre)}</span>
          <span>${item.format.toUpperCase()}</span>
          <span>${item.date}</span>
        </div>
      </div>
      <button class="lib-del" data-id="${item.videoId}" title="Xoá khỏi thư viện">✕</button>
    `;
    div.querySelector('.lib-del').addEventListener('click', async e => {
      const id = e.currentTarget.dataset.id;
      library  = library.filter(i => i.videoId !== id);
      await saveLibrary();
      renderLibrary();
      if (videoInfo && videoInfo.videoId === id) renderVideoInfo(videoInfo);
    });
    list.appendChild(div);
  });
}

function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Server tab ────────────────────────────────────────────────────────────
function setupServerTab() {
  document.getElementById('btnStartStop').addEventListener('click', toggleServer);
}

async function refreshServerStatus() {
  const online  = await pingServer();
  updateServerUI(online);
  const icon    = document.getElementById('srvIcon');
  const title   = document.getElementById('srvTitle');
  const sub     = document.getElementById('srvSubtitle');
  const badge   = document.getElementById('srvBadge');
  const bigBtn  = document.getElementById('btnStartStop');

  if (online) {
    icon.textContent   = '🟢';
    title.textContent  = 'Server đang chạy';
    sub.textContent    = 'localhost:9876 — Sẵn sàng tải';
    badge.textContent  = 'Online';
    badge.className    = 'srv-badge online';
    bigBtn.textContent = '⏹ DỪNG SERVER';
    bigBtn.className   = 'btn-srv-big stop';
  } else {
    icon.textContent   = '🔴';
    title.textContent  = 'Server chưa chạy';
    sub.textContent    = 'localhost:9876';
    badge.textContent  = 'Offline';
    badge.className    = 'srv-badge offline';
    bigBtn.textContent = '▶ KHỞI ĐỘNG SERVER';
    bigBtn.className   = 'btn-srv-big start';
  }
}

async function toggleServer() {
  const online = await pingServer();
  if (online) {
    const bigBtn = document.getElementById('btnStartStop');
    bigBtn.textContent = '⏳ ĐANG DỪNG...';
    bigBtn.disabled    = true;
    try {
      await fetch(`${SERVER}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(2000) });
    } catch {}
    setTimeout(() => { bigBtn.disabled = false; refreshServerStatus(); }, 1200);
  } else {
    launchServer();
  }
}

function launchServer() {
  const bigBtn = document.getElementById('btnStartStop');
  bigBtn.textContent = '⏳ ĐANG KHỞI ĐỘNG...';
  bigBtn.disabled    = true;
  let responded      = false;

  try {
    const port = chrome.runtime.connectNative('com.ytmusicsaver.server');

    port.onMessage.addListener(msg => {
      responded = true;
      bigBtn.disabled = false;
      if (msg.status === 'started') {
        setTimeout(() => refreshServerStatus(), 1500);
      } else {
        showNativeError(msg.message || 'Native host lỗi');
      }
    });

    port.onDisconnect.addListener(() => {
      bigBtn.disabled = false;
      if (!responded) {
        const err = chrome.runtime.lastError;
        showNativeError(err ? err.message : 'Không kết nối được Native Host');
      }
      refreshServerStatus();
    });

    port.postMessage({ action: 'start' });

    setTimeout(() => {
      if (!responded) { bigBtn.disabled = false; port.disconnect(); }
    }, 8000);

  } catch (e) {
    bigBtn.disabled = false;
    showNativeError(e.message);
  }
}

function showNativeError(msg) {
  const panel = document.querySelector('.server-panel');
  panel.querySelectorAll('.native-err').forEach(el => el.remove());

  let hint = '';
  if (msg && msg.includes('not found')) {
    hint = `Native Host <b>chưa được đăng ký</b>.<br>→ Chạy lại <code>install.bat</code><br>→ Vào <code>chrome://extensions/</code> nhấn <b>Reload</b> extension`;
  } else if (msg && (msg.includes('Access') || msg.includes('permission'))) {
    hint = `Lỗi quyền. → Chạy <code>install.bat</code> bằng <b>Run as Administrator</b>`;
  } else {
    hint = `Lỗi: <b>${msg}</b><br>→ Chạy thủ công: <code>python server.py</code> trong thư mục <code>server/</code>`;
  }

  const div = document.createElement('div');
  div.className = 'native-err';
  div.style.cssText = 'margin-top:10px;padding:11px 13px;background:rgba(230,57,70,.07);border:1px solid rgba(230,57,70,.3);border-radius:10px;font-size:11px;color:#ff8a8a;line-height:1.8;';
  div.innerHTML = hint;
  document.querySelector('.server-panel').appendChild(div);
}

// ── UI helpers ────────────────────────────────────────────────────────────
function updateProgress(pct, speed) {
  document.getElementById('progressBar').style.width   = pct + '%';
  document.getElementById('progressPct').textContent   = Math.round(pct) + '%';
  document.getElementById('progressSpeed').textContent = speed;
}

function showProgress(show) {
  document.getElementById('progressWrap').style.display = show ? 'block' : 'none';
  if (!show) updateProgress(0, '');
}

function showSuccess(html) {
  const el = document.getElementById('statusMsg');
  el.className     = 'status-msg success';
  el.innerHTML     = html;
  el.style.display = 'flex';
}

function showError(html) {
  const el = document.getElementById('statusMsg');
  el.className     = 'status-msg error';
  el.innerHTML     = html;
  el.style.display = 'flex';
}

function hideStatus() {
  document.getElementById('statusMsg').style.display = 'none';
}

function resetBtn() {
  const btn       = document.getElementById('dlBtn');
  btn.disabled    = false;
  btn.textContent = '⬇ TẢI VỀ';
  btn.style.background = '';
}