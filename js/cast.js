/* ---------- Chromecast Integration (Phase 3) ---------- */
window.__onGCastApiAvailable = function(isAvailable) {
  if (isAvailable) {
    initializeCastApi();
  }
};

let castSession = null;
let remotePlayer = null;
let remotePlayerController = null;

function initializeCastApi() {
  cast.framework.CastContext.getInstance().setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });

  remotePlayer = new cast.framework.RemotePlayer();
  remotePlayerController = new cast.framework.RemotePlayerController(remotePlayer);

  // Show cast button if supported
  const btnCast = document.getElementById('btn-cast');
  if (btnCast) btnCast.style.display = 'flex';

  remotePlayerController.addEventListener(
    cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
    function() {
      const isConnected = remotePlayer.isConnected;
      if (isConnected) {
        castSession = cast.framework.CastContext.getInstance().getCurrentSession();
        loadMediaOnCast();
      } else {
        castSession = null;
      }
    }
  );

  // Sync play/pause from remote back to local UI
  remotePlayerController.addEventListener(
    cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
    function() {
      if (remotePlayer.isPaused) {
        // sync to local state
        // assuming S and video are globally accessible from player.js
        document.getElementById('ic-play').style.display = 'block';
        document.getElementById('ic-pause').style.display = 'none';
        document.getElementById('bigPlay').classList.remove('hide');
      } else {
        document.getElementById('ic-play').style.display = 'none';
        document.getElementById('ic-pause').style.display = 'block';
        document.getElementById('bigPlay').classList.add('hide');
      }
    }
  );
}

function loadMediaOnCast() {
  if (!castSession) return;
  // S is the global state from player.js
  if (!window.S || !window.S.src) return;

  const mediaInfo = new chrome.cast.media.MediaInfo(window.S.src, 'video/mp4');
  if (window.isHls && window.isHls(window.S.src)) {
    mediaInfo.contentType = 'application/x-mpegurl';
  }

  mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
  mediaInfo.metadata.metadataType = chrome.cast.media.MetadataType.GENERIC;
  mediaInfo.metadata.title = window.S.title || 'سینما پلی';
  if (window.S.poster) {
    mediaInfo.metadata.images = [{ url: window.S.poster }];
  }

  // Handle subtitles if any are active
  // Since subtitles might be local blob URLs, casting them is tricky unless we have public URLs.
  // Assuming Subs module has a way to get public URLs.
  
  const request = new chrome.cast.media.LoadRequest(mediaInfo);
  request.currentTime = window.video ? window.video.currentTime : 0;

  castSession.loadMedia(request).then(
    function() { console.log('Cast media loaded successfully'); },
    function(error) { console.error('Cast load failed', error); }
  );
}
