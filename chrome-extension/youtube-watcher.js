// Tells the extension when a YouTube video starts playing, so it can pause
// Spotify. Muted videos, like the hover previews on the home page, don't count,
// and neither do plays the extension started itself (see resumeVideo).
document.addEventListener(
  'play',
  (event) => {
    const video = event.target;
    if (video instanceof HTMLVideoElement && !video.muted && !window.__mediaSwapperResuming) {
      chrome.runtime.sendMessage({ type: 'youtube-play' });
    }
  },
  true, // media events don't bubble, so listen during the capture phase
);
