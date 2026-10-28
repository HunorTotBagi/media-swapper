// Runs inside Spotify's page before its own scripts load. Spotify's audio
// element isn't necessarily in the DOM, so we record media elements as they
// start playing. background.js reads the real play/pause state from here
// instead of guessing from the (translated) button label.
(() => {
  const elements = new Set();
  const originalPlay = HTMLMediaElement.prototype.play;

  HTMLMediaElement.prototype.play = function (...args) {
    elements.add(this);
    return originalPlay.apply(this, args);
  };

  window.__mediaSwapper = {
    // null until Spotify plays something through a media element, so the
    // extension knows to fall back to other signals.
    isPlaying: () => (elements.size ? [...elements].some((el) => !el.paused) : null),
  };
})();
