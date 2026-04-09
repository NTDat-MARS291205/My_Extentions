// popup.js v2 — Library, duplicate check, server start/stop

const SERVER = 'http://localhost:9876';

// ── State ─────────────────────────────────────────────────────────────────
let videoInfo      = null;
let selectedFormat = 'mp3';
let selectedGenre  = '';
let pollInterval   = null;
let library        = [];   // [{videoId, title, channel, thumbnail, genre, format, date}]
let genres         = ['Nhạc trẻ', 'Ballad', 'V-Pop', 'K-Pop', 'EDM', 'Nhạc phim', 'Khác'];
let libFilter      = 'all';
let libSearch      = '';

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  loadStorage();
  setupTabs();
  setupFormatBtns();
  setupGenreUI();
  setupLibraryUI();
  setupServerTab();
  setupModal();

  document.getElementById('dlBtn').addEventListener('click', startDownload);

  await checkServer();
  await loadVideoInfo();
  renderLibrary();
});

// ── Storage ───────────────────────────────────────────────────────────────
function loadStorage() {
  const lib = localStorage.getItem('ytms_library');
  const gen = localStorage.getItem('ytms_genres');
  if (lib) library = JSON.parse(lib);
  if (gen) genres  = JSON.parse(gen);
}

function saveLibrary() { localStorage.setItem('ytms_library', JSON.stringify(library)); }
function saveGenres()  { localStorage.setItem('ytms_genres',  JSON.stringify(genres));  }

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

function addGenre() {
  const val = document.getElementById('genreInput').value.trim();
  if (!val) return;
  if (!genres.includes(val)) {
    genres.push(val);
    saveGenres();
    renderGenreSelect();
    // Chọn genre vừa thêm
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
  dot.className = `status-dot ${online ? 'online' : 'offline'}`;
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
    document.getElementById('notYt').style.display = 'block';
    document.getElementById('videoContent').style.display = 'none';
    return;
  }
  document.getElementById('notYt').style.display = 'none';
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
  document.getElementById('thumbnail').src   = info.thumbnail;
  document.getElementById('videoTitle').textContent    = info.title   || 'Không rõ tiêu đề';
  document.getElementById('videoChannel').textContent  = info.channel || '';

  if (info.hasPlaylist) {
    document.getElementById('playlistBadge').style.display  = 'block';
    document.getElementById('playlistWarning').style.display = 'flex';
  }

  // Kiểm tra trùng lặp
  const dup = library.find(item => item.videoId === info.videoId);
  if (dup) {
    document.getElementById('dupBadge').style.display   = 'block';
    document.getElementById('dupWarning').style.display = 'flex';
    document.getElementById('dupWarningText').innerHTML =
      `Video này đã tải <strong>${dup.genre}</strong> dạng <strong>${dup.format.toUpperCase()}</strong> vào ${dup.date}. Vẫn tải lại?`;
    // Đổi màu nút
    document.getElementById('dlBtn').style.background = '#c1121f';
    document.getElementById('dlBtn').textContent = '⬇ TẢI LẠI';
  } else {
    document.getElementById('dlBtn').textContent = '⬇ TẢI VỀ';
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
  btn.disabled = true;
  btn.textContent = '⏳ ĐANG GỬI...';
  hideStatus();
  showProgress(true);

  try {
    const res = await fetch(`${SERVER}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoInfo.cleanUrl, format: selectedFormat, title: videoInfo.title })
    });
    const data = await res.json();
    if (data.job_id) {
      btn.textContent = '⏬ ĐANG TẢI...';
      pollProgress(data.job_id);
    } else throw new Error(data.error || 'Server lỗi');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = '⬇ TẢI VỀ';
    showProgress(false);
    showError('Lỗi: ' + e.message);
  }
}

function pollProgress(jobId) {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(async () => {
    try {
      const res  = await fetch(`${SERVER}/progress/${jobId}`);
      const data = await res.json();
      updateProgress(data.percent || 0, data.speed || '');

      if (data.status === 'done') {
        clearInterval(pollInterval);
        showProgress(false);
        showSuccess(`✅ Đã lưu: <b>${data.filename || 'file'}</b>`);
        resetBtn();
        // Thêm vào library
        addToLibrary(videoInfo, selectedFormat, selectedGenre);
        renderLibrary();
      } else if (data.status === 'error') {
        clearInterval(pollInterval);
        showProgress(false);
        showError('❌ ' + (data.error || 'Lỗi không xác định'));
        resetBtn();
      }
    } catch {}
  }, 800);
}

// ── Library ───────────────────────────────────────────────────────────────
function addToLibrary(info, format, genre) {
  // Xoá bản cũ nếu trùng videoId
  library = library.filter(i => i.videoId !== info.videoId);
  library.unshift({
    videoId:   info.videoId,
    title:     info.title,
    channel:   info.channel,
    thumbnail: info.thumbnail,
    genre:     genre || 'Khác',
    format:    format,
    date:      new Date().toLocaleDateString('vi-VN')
  });
  saveLibrary();

  // Reset duplicate warning
  document.getElementById('dupBadge').style.display   = 'none';
  document.getElementById('dupWarning').style.display = 'none';
}

function setupLibraryUI() {
  document.getElementById('libSearch').addEventListener('input', e => {
    libSearch = e.target.value.toLowerCase();
    renderLibrary();
  });
}

function renderLibrary() {
  // Stats
  const allGenres  = [...new Set(library.map(i => i.genre))];
  const allFormats = [...new Set(library.map(i => i.format))];
  document.getElementById('statTotal').textContent   = library.length;
  document.getElementById('statGenres').textContent  = allGenres.length;
  document.getElementById('statFormats').textContent = allFormats.length;

  // Genre filter chips
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

  // Filter list
  const filtered = library.filter(item => {
    const matchGenre  = libFilter === 'all' || item.genre === libFilter;
    const matchSearch = !libSearch || item.title.toLowerCase().includes(libSearch) || item.channel.toLowerCase().includes(libSearch);
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
    div.querySelector('.lib-del').addEventListener('click', e => {
      const id = e.currentTarget.dataset.id;
      library = library.filter(i => i.videoId !== id);
      saveLibrary();
      renderLibrary();
      // Reset duplicate UI nếu đang xem video đó
      if (videoInfo && videoInfo.videoId === id) {
        document.getElementById('dupBadge').style.display   = 'none';
        document.getElementById('dupWarning').style.display = 'none';
        document.getElementById('dlBtn').textContent = '⬇ TẢI VỀ';
        document.getElementById('dlBtn').style.background = '';
      }
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
  const online = await pingServer();
  updateServerUI(online);
  const icon    = document.getElementById('srvIcon');
  const title   = document.getElementById('srvTitle');
  const sub     = document.getElementById('srvSubtitle');
  const badge   = document.getElementById('srvBadge');
  const bigBtn  = document.getElementById('btnStartStop');

  if (online) {
    icon.textContent    = '🟢';
    title.textContent   = 'Server đang chạy';
    sub.textContent     = 'localhost:9876 — Sẵn sàng tải';
    badge.textContent   = 'Online';
    badge.className     = 'srv-badge online';
    bigBtn.textContent  = '⏹ DỪNG SERVER';
    bigBtn.className    = 'btn-srv-big stop';
  } else {
    icon.textContent    = '🔴';
    title.textContent   = 'Server chưa chạy';
    sub.textContent     = 'localhost:9876';
    badge.textContent   = 'Offline';
    badge.className     = 'srv-badge offline';
    bigBtn.textContent  = '▶ KHỞI ĐỘNG SERVER';
    bigBtn.className    = 'btn-srv-big start';
  }
}

async function toggleServer() {
  const online = await pingServer();
  if (online) {
    // Dừng server
    const bigBtn = document.getElementById('btnStartStop');
    bigBtn.textContent = '⏳ ĐANG DỪNG...';
    bigBtn.disabled = true;
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
  bigBtn.disabled = true;

  let responded = false;

  try {
    const port = chrome.runtime.connectNative('com.ytmusicsaver.server');

    port.onMessage.addListener(msg => {
      responded = true;
      if (msg.status === 'started') {
        // Đợi server sẵn sàng rồi cập nhật UI
        setTimeout(() => { bigBtn.disabled = false; refreshServerStatus(); }, 1500);
      } else {
        bigBtn.disabled = false;
        showNativeError(msg.message || 'Native host lỗi');
      }
    });

    port.onDisconnect.addListener(() => {
      bigBtn.disabled = false;
      if (!responded) {
        // Native host chưa được đăng ký hoặc sai Extension ID
        const err = chrome.runtime.lastError;
        showNativeError(err ? err.message : 'Không kết nối được Native Host');
      }
      refreshServerStatus();
    });

    port.postMessage({ action: 'start' });

    // Timeout 8 giây nếu không có phản hồi
    setTimeout(() => {
      if (!responded) {
        bigBtn.disabled = false;
        port.disconnect();
      }
    }, 8000);

  } catch (e) {
    bigBtn.disabled = false;
    showNativeError(e.message);
  }
}

function showNativeError(msg) {
  // Xoá hint cũ
  const panel = document.querySelector('.server-panel');
  panel.querySelectorAll('.native-err').forEach(el => el.remove());

  // Phân loại lỗi để hướng dẫn cụ thể
  let hint = '';
  if (msg && msg.includes('not found')) {
    hint = `Native Host <b>chưa được đăng ký</b> đúng.<br>
      → Chạy lại <code>install.bat</code> trong thư mục <code>native-host/</code><br>
      → Sau đó vào <code>chrome://extensions/</code> nhấn <b>🔄 Reload</b> extension<br>
      → Quay lại tab Server và thử lại`;
  } else if (msg && (msg.includes('Access') || msg.includes('permission'))) {
    hint = `Lỗi quyền truy cập.<br>→ Chạy <code>install.bat</code> bằng <b>Run as Administrator</b>`;
  } else {
    hint = `Lỗi: <b>${msg}</b><br>
      → Đảm bảo đã chạy <code>install.bat</code> và reload extension<br>
      → Hoặc chạy thủ công: <code>python server.py</code> trong thư mục <code>server/</code>`;
  }

  const div = document.createElement('div');
  div.className = 'native-err';
  div.style.cssText = 'margin-top:10px;padding:11px 13px;background:rgba(230,57,70,.07);border:1px solid rgba(230,57,70,.3);border-radius:10px;font-size:11px;color:#ff8a8a;line-height:1.8;';
  div.innerHTML = hint;
  panel.appendChild(div);
}

// ── UI helpers ────────────────────────────────────────────────────────────
function updateProgress(pct, speed) {
  document.getElementById('progressBar').style.width     = pct + '%';
  document.getElementById('progressPct').textContent     = pct + '%';
  document.getElementById('progressSpeed').textContent   = speed;
}

function showProgress(show) {
  document.getElementById('progressWrap').style.display = show ? 'block' : 'none';
  if (!show) updateProgress(0, '');
}

function showSuccess(html) {
  const el = document.getElementById('statusMsg');
  el.className = 'status-msg success';
  el.innerHTML = html;
  el.style.display = 'flex';
}

function showError(html) {
  const el = document.getElementById('statusMsg');
  el.className = 'status-msg error';
  el.innerHTML = html;
  el.style.display = 'flex';
}

function hideStatus() {
  document.getElementById('statusMsg').style.display = 'none';
}

function resetBtn() {
  const btn = document.getElementById('dlBtn');
  btn.disabled = false;
  btn.textContent = '⬇ TẢI VỀ';
  btn.style.background = '';
}
