/**
 * scanner.js
 * ---------------------------------------------------------------
 * Thin wrapper around the html5-qrcode library.
 * Owns camera lifecycle, debouncing duplicate reads while a result
 * is on screen, and controlling hardware torch/flashlight capabilities.
 * ---------------------------------------------------------------
 */
const Scanner = (() => {
  let html5QrCode = null;
  let isRunning = false;
  let isPaused = false;
  let isTorchOn = false;
  let onDecodeCallback = null;

  const READER_ELEMENT_ID = "qr-reader";

  function getVideoTrack() {
    const video = document.querySelector(`#${READER_ELEMENT_ID} video`);
    if (video && video.srcObject) {
      const tracks = video.srcObject.getVideoTracks();
      if (tracks && tracks.length > 0) return tracks[0];
    }
    return null;
  }

  async function start(onDecode) {
    onDecodeCallback = onDecode;
    if (isRunning) return;

    html5QrCode = new Html5Qrcode(READER_ELEMENT_ID, /* verbose= */ false);

    const config = {
      fps: 15,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.72);
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
      isTorchOn = false;
    } catch (err) {
      isRunning = false;
      throw err; // let UI show camera-permission error
    }
  }

  function handleDecode(decodedText) {
    if (isPaused) return; // ignore reads while result is active
    isPaused = true;
    if (onDecodeCallback) onDecodeCallback(decodedText.trim());
  }

  /** Call this once the result screen is dismissed to resume reading. */
  function resume() {
    isPaused = false;
  }

  function hasTorch() {
    const track = getVideoTrack();
    if (!track || typeof track.getCapabilities !== "function") return false;
    const capabilities = track.getCapabilities();
    return !!capabilities.torch;
  }

  async function setTorch(on) {
    const track = getVideoTrack();
    if (!track || typeof track.applyConstraints !== "function") return false;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !!on }],
      });
      isTorchOn = !!on;
      return true;
    } catch (err) {
      console.warn("Torch failed:", err);
      return false;
    }
  }

  async function toggleTorch() {
    const targetState = !isTorchOn;
    const ok = await setTorch(targetState);
    return ok ? isTorchOn : false;
  }

  function getTorchState() {
    return isTorchOn;
  }

  async function stop() {
    if (isTorchOn) {
      await setTorch(false);
    }
    if (!html5QrCode || !isRunning) return;
    try {
      await html5QrCode.stop();
      html5QrCode.clear();
    } catch (e) {
      /* ignore — camera may already be stopped */
    }
    isRunning = false;
    isPaused = false;
    isTorchOn = false;
  }

  return {
    start,
    stop,
    resume,
    hasTorch,
    setTorch,
    toggleTorch,
    getTorchState,
  };
})();
