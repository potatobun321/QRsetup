/**
 * scanner.js
 * ---------------------------------------------------------------
 * Thin wrapper around the html5-qrcode library (loaded via CDN in
 * index.html). Owns starting/stopping the camera and debouncing
 * duplicate reads of the same frame while a result is on screen.
 * ---------------------------------------------------------------
 */
const Scanner = (() => {
  let html5QrCode = null;
  let isRunning = false;
  let isPaused = false;
  let onDecodeCallback = null;

  const READER_ELEMENT_ID = "qr-reader";

  async function start(onDecode) {
    onDecodeCallback = onDecode;
    if (isRunning) return;

    html5QrCode = new Html5Qrcode(READER_ELEMENT_ID, /* verbose= */ false);

    const config = {
      fps: 10,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.7);
        return { width: size, height: size };
      },
      aspectRatio: 1.0,
    };

    try {
      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => handleDecode(decodedText),
        () => {
          /* per-frame decode failures are expected and ignored */
        }
      );
      isRunning = true;
      isPaused = false;
    } catch (err) {
      isRunning = false;
      throw err; // let UI show a camera-permission error
    }
  }

  function handleDecode(decodedText) {
    if (isPaused) return; // ignore reads while a result is showing
    isPaused = true;
    if (onDecodeCallback) onDecodeCallback(decodedText.trim());
  }

  /** Call this once the result screen is dismissed to resume reading. */
  function resume() {
    isPaused = false;
  }

  async function stop() {
    if (!html5QrCode || !isRunning) return;
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch (e) {
      /* ignore — camera may already be stopped */
    }
    isRunning = false;
    isPaused = false;
  }

  return { start, stop, resume };
})();
