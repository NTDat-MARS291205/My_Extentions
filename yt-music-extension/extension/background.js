// background.js v3 — Service Worker
// Library lấy từ server (source of truth), không lưu riêng trong extension

const SERVER = 'http://localhost:9876';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'startPoll') {
    startPolling(msg.jobId, msg.videoInfo, msg.format, msg.genre);
    sendResponse({ ok: true });
  }
  if (msg.action === 'getActiveJob') {
    chrome.storage.local.get('activeJob', data => {
      sendResponse(data.activeJob || null);
    });
    return true;
  }
  if (msg.action === 'clearJob') {
    chrome.storage.local.remove('activeJob');
    sendResponse({ ok: true });
  }
});

function startPolling(jobId, videoInfo, format, genre) {
  chrome.storage.local.set({
    activeJob: { jobId, videoInfo, format, genre, status: 'downloading', percent: 0, speed: '', filename: '', error: '' }
  });
  poll(jobId, videoInfo, format, genre);
}

async function poll(jobId, videoInfo, format, genre) {
  try {
    const res  = await fetch(`${SERVER}/progress/${jobId}`);
    const data = await res.json();

    chrome.storage.local.set({
      activeJob: { jobId, videoInfo, format, genre, status: data.status, percent: data.percent || 0, speed: data.speed || '', filename: data.filename || '', error: data.error || '' }
    });

    if (data.status === 'done') {
      // Library đã được server tự lưu — chỉ cần notify popup
      chrome.runtime.sendMessage({ action: 'jobDone', filename: data.filename }).catch(() => {});
      return;
    }
    if (data.status === 'error') {
      chrome.runtime.sendMessage({ action: 'jobError', error: data.error }).catch(() => {});
      return;
    }

    setTimeout(() => poll(jobId, videoInfo, format, genre), 800);
  } catch {
    setTimeout(() => poll(jobId, videoInfo, format, genre), 2000);
  }
}