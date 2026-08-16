/**
 * scanner.js
 * ---------------------------------------------------------------
 * Bulletproof, zero-crash camera & QR scanner engine.
 * - Multi-tier camera fallback ({ facingMode: "environment" } -> camera list).
 * - Safe viewport-independent QR decoding.
 * - Hardware torch / flashlight detection & control.
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

  function getQrConfig() {
    return {
      fps: 15,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minDim = Math.min(viewfinderWidth || 280, viewfinderHeight || 280);
        const size = Math.max(180, Math.floor(minDim * 0.85));
        return { width: size, height: size };
      },
      aspectRatio: 1.0,
      disableFlip: false,
    };
  }

  async function start(onDecode) {
    onDecodeCallback = onDecode;
    if (isRunning) return;

    // 1. Clean up any previous dangling instance
    if (html5QrCode) {
      try {
        await html5QrCode.stop();
        html5QrCode.clear();
      } catch (e) {}
      html5QrCode = null;
    }

    // 2. Initialize instance safely
    try {
      html5QrCode = new Html5Qrcode(READER_ELEMENT_ID, {
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
        verbose: false,
      });
    } catch (e) {
      // Fallback if BarcodeDetector configuration fails
      html5QrCode = new Html5Qrcode(READER_ELEMENT_ID, /* verbose= */ false);
    }

    const config = getQrConfig();

    // 3. Multi-tier camera start sequence (Environment -> Device ID -> User)
    let started = false;

    // Tier 1: Standard Back Camera (facingMode: environment)
    try {
      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => handleDecode(decodedText),
        () => {}
      );
      started = true;
    } catch (envError) {
      console.warn("Tier 1 environment camera failed, trying camera enumerate:", envError);
    }

    // Tier 2: Enumerate devices and pick back camera or primary camera
    if (!started) {
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length > 0) {
          // Prefer camera with "back" or "rear" in label, else first camera
          const backCam = cameras.find((c) =>
            /back|rear|environment/i.test(c.label)
          );
          const chosenCamId = backCam ? backCam.id : cameras[0].id;

          await html5QrCode.start(
            chosenCamId,
            config,
            (decodedText) => handleDecode(decodedText),
            () => {}
          );
          started = true;
        }
      } catch (enumError) {
        console.warn("Tier 2 camera enumeration failed:", enumError);
      }
    }

    // Tier 3: Universal fallback without facing constraints
    if (!started) {
      await html5QrCode.start(
        { facingMode: "user" },
        config,
        (decodedText) => handleDecode(decodedText),
        () => {}
      );
      started = true;
    }

    isRunning = true;
    isPaused = false;
    isTorchOn = false;

    // Try applying continuous autofocus if device track supports it
    try {
      const track = getVideoTrack();
      if (track && track.applyConstraints) {
        track.applyConstraints({
          advanced: [{ focusMode: "continuous" }],
        }).catch(() => {});
      }
    } catch (e) {}
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
      const capabilities = track.getCapabilities();
      return !!capabilities.torch;
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
      console.warn("Torch constraint failed:", err);
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
