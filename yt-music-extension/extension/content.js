// content.js — chạy trên trang YouTube, lấy thông tin video

function getVideoInfo() {
  const url = new URL(window.location.href);
  const videoId = url.searchParams.get('v');
  const listId  = url.searchParams.get('list');
  if (!videoId) return null;

  const titleEl   = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string, h1.style-scope.ytd-watch-metadata yt-formatted-string');
  const title     = titleEl ? titleEl.textContent.trim() : document.title.replace(' - YouTube', '').trim();
  const channelEl = document.querySelector('#channel-name a, ytd-channel-name a');
  const channel   = channelEl ? channelEl.textContent.trim() : 'Unknown';

  return {
    videoId,
    title,
    channel,
    thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
    cleanUrl:  `https://www.youtube.com/watch?v=${videoId}`,
    hasPlaylist: !!listId,
    playlistId: listId || null
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getVideoInfo') sendResponse(getVideoInfo());
});
