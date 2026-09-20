// Hold-to-reveal for hidden developer info: visible only while the key is held.

const isTextField = target => Boolean(
  target && target.tagName && (/^(input|textarea|select)$/i.test(target.tagName) || target.isContentEditable)
);

// Event handlers that call setVisible(true / false) as the key goes down / up.
// Kept free of DOM globals so they can be tested directly.
export function createHoldReveal(setVisible, key = 'v') {
  let visible = false;

  const show = value => {
    if (value === visible) return; // key repeat and repeated cancels report once
    visible = value;
    setVisible(value);
  };
  const isRevealKey = e => e.key === key || e.key === key.toUpperCase();

  return {
    keydown(e) {
      const modified = e.ctrlKey || e.metaKey || e.altKey; // Ctrl+V etc. is not a reveal
      if (isRevealKey(e) && !modified && !isTextField(e.target)) show(true);
    },
    keyup(e) {
      if (isRevealKey(e)) show(false);
    },
    cancel() {
      show(false);
    },
  };
}

// Wire the handlers to the page. Also hides when the window loses focus or the tab is hidden,
// because the keyup would be missed.
export function installHoldReveal(setVisible, key = 'v') {
  const reveal = createHoldReveal(setVisible, key);
  addEventListener('keydown', reveal.keydown);
  addEventListener('keyup', reveal.keyup);
  addEventListener('blur', reveal.cancel);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) reveal.cancel();
  });
  return reveal;
}
