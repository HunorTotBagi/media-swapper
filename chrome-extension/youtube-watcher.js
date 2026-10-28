document.addEventListener(
  'play',
  (event) => {
    const video = event.target;
    if (video instanceof HTMLVideoElement && !video.muted && !window.__mediaSwapperResuming) {
      chrome.runtime.sendMessage({ type: 'youtube-play' });
    }
  },
  true,
);
