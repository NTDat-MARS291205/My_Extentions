// background.js — Service Worker
// Chạy nền liên tục, poll tiến trình download kể cả khi popup đóng

const SERVER = 'http://localhost:9876';

// ── Lắng nghe message từ popup ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startPoll') {
    startPolling(msg.jobId, msg.videoInfo, msg.format, msg.genre);
    sendResponse({ ok: true });
  }
  if (msg.action === 'getActiveJob') {
    chrome.storage.local.get('activeJob', data => {
      sendResponse(data.activeJob || null);
    });
    return true; // async
  }
  if (msg.action === 'clearJob') {
    chrome.storage.local.remove('activeJob');
    sendResponse({ ok: true });
  }
});

// ── Polling loop ──────────────────────────────────────────────────────────
function startPolling(jobId, videoInfo, format, genre) {
  // Lưu job đang chạy vào storage để popup mở lại biết
  chrome.storage.local.set({
    activeJob: {
      jobId,
      videoInfo,
      format,
      genre,
      status: 'downloading',
      percent: 0,
      speed: '',
      filename: '',
      error: ''
    }
  });

  poll(jobId, videoInfo, format, genre);
}

async function poll(jobId, videoInfo, format, genre) {
  try {
    const res  = await fetch(`${SERVER}/progress/${jobId}`);
    const data = await res.json();

    const percent = data.percent || 0;
    const speed   = data.speed   || '';

    // Cập nhật storage để popup đọc được
    chrome.storage.local.set({
      activeJob: {
        jobId,
        videoInfo,
        format,
        genre,
        status:   data.status,
        percent,
        speed,
        filename: data.filename || '',
        error:    data.error    || ''
      }
    });

    if (data.status === 'done') {
      // Lưu vào library
      addToLibrary(videoInfo, format, genre, data.filename);
      // Thông báo cho popup nếu đang mở
      chrome.runtime.sendMessage({ action: 'jobDone', filename: data.filename }).catch(() => {});
      return; // dừng poll
    }

    if (data.status === 'error') {
      chrome.runtime.sendMessage({ action: 'jobError', error: data.error }).catch(() => {});
      return;
    }

    // Còn đang tải → poll tiếp sau 800ms
    setTimeout(() => poll(jobId, videoInfo, format, genre), 800);

  } catch (e) {
    // Lỗi mạng → thử lại sau 2s
    setTimeout(() => poll(jobId, videoInfo, format, genre), 2000);
  }
}

// ── Lưu vào library (dùng chrome.storage.local thay localStorage) ─────────
async function addToLibrary(videoInfo, format, genre, filename) {
  const result = await chrome.storage.local.get('ytms_library');
  let library  = result.ytms_library || [];

  // Xoá bản cũ nếu trùng videoId
  library = library.filter(i => i.videoId !== videoInfo.videoId);
  library.unshift({
    videoId:   videoInfo.videoId,
    title:     videoInfo.title,
    channel:   videoInfo.channel,
    thumbnail: videoInfo.thumbnail,
    genre:     genre || 'Khác',
    format:    format,
    filename:  filename || '',
    date:      new Date().toLocaleDateString('vi-VN')
  });

  await chrome.storage.local.set({ ytms_library: library });
}