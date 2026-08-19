/**
 * scanner.js
 * ---------------------------------------------------------------
 * Proven, rock-solid wrapper around html5-qrcode.
 * - Clean DOM reset before camera start.
 * - Dual-tier fallback (environment rear camera -> default camera).
 * - Safe hardware torch control without stream pollution.
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

    // Clean up previous DOM and instance
    if (html5QrCode) {
      try {
        await html5QrCode.stop();
        html5QrCode.clear();
      } catch (e) {}
      html5QrCode = null;
    }

    const container = document.getElementById(READER_ELEMENT_ID);
    if (container) container.innerHTML = "";

    html5QrCode = new Html5Qrcode(READER_ELEMENT_ID, {
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true // Native C++ GPU hardware decoder
      },
      verbose: false
    });

    const config = {
      fps: 20, // 20 FPS sampling for rapid capture
      aspectRatio: 1.0,
      disableFlip: true
    };

    const cameraConstraints = {
      facingMode: "environment",
      focusMode: "continuous",
      width: { ideal: 1280 },
      height: { ideal: 720 }
    };

    try {
      // Tier 1: Try rear camera with continuous focus and HD resolution
      await html5QrCode.start(
        cameraConstraints,
        config,
        (decodedText) => handleDecode(decodedText),
        () => {}
      );
      isRunning = true;
      isPaused = false;
      isTorchOn = false;
    } catch (err) {
      console.warn("High-res rear camera failed, trying fallback camera:", err);
      // Tier 2: Try default fallback camera
      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          config,
          (decodedText) => handleDecode(decodedText),
          () => {}
        );
        isRunning = true;
        isPaused = false;
        isTorchOn = false;
      } catch (fallbackErr) {
        try {
          // Tier 3: Any available user camera
          await html5QrCode.start(
            { facingMode: "user" },
            config,
            (decodedText) => handleDecode(decodedText),
            () => {}
          );
          isRunning = true;
          isPaused = false;
          isTorchOn = false;
        } catch (finalErr) {
          isRunning = false;
          throw finalErr;
        }
      }
    }
  }

  function handleDecode(decodedText) {
    if (isPaused) return;
    isPaused = true;
    if (onDecodeCallback) onDecodeCallback(decodedText.trim());
  }

  function resume() {
    isPaused = false;
  }

  function hasTorch() {
    const track = getVideoTrack();
    if (!track || typeof track.getCapabilities !== "function") return false;
    try {
      return !!track.getCapabilities().torch;
    } catch (e) {
      return false;
    }
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
    const target = !isTorchOn;
    const ok = await setTorch(target);
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
    } catch (e) {}
    isRunning = false;
    isPaused = false;
    isTorchOn = false;
    html5QrCode = null;
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
