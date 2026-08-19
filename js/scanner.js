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

    html5QrCode = new Html5Qrcode(READER_ELEMENT_ID, /* verbose= */ false);

    const config = {
      fps: 15,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minDim = Math.min(viewfinderWidth || 280, viewfinderHeight || 280);
        const size = Math.floor(minDim * 0.85); // 85% wide scanning area
        return { width: size, height: size };
      },
      aspectRatio: 1.0,
    };

    try {
      // Tier 1: Rear environment camera
      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => handleDecode(decodedText),
        () => {}
      );
      isRunning = true;
      isPaused = false;
      isTorchOn = false;
    } catch (err) {
      console.warn("Back camera failed, trying user camera:", err);
      // Tier 2: Front / user camera
      try {
        await html5QrCode.start(
          { facingMode: "user" },
          config,
          (decodedText) => handleDecode(decodedText),
          () => {}
        );
        isRunning = true;
        isPaused = false;
        isTorchOn = false;
      } catch (fallbackErr) {
        console.warn("User camera failed, trying generic device camera:", fallbackErr);
        try {
          // Tier 3: Generic default camera constraint
          await html5QrCode.start(
            {},
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
