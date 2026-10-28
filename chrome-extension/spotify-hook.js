(() => {
  const elements = new Set();
  const originalPlay = HTMLMediaElement.prototype.play;

  HTMLMediaElement.prototype.play = function (...args) {
    elements.add(this);
    return originalPlay.apply(this, args);
  };

  window.__mediaSwapper = {
    isPlaying: () => (elements.size ? [...elements].some((el) => !el.paused) : null),
  };
})();
