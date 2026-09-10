'use strict';
/**
 * BinGo — app.js
 * Full-screen camera app. AI result overlaid at bottom.
 * Model: waste_sorting_ai/ (RECYCLABLE, RESIDUAL, BIODEGRADEABLE, NONE)
 */

const MODEL_URL    = './waste_sorting_ai/model.json';
const METADATA_URL = './waste_sorting_ai/metadata.json';
const THRESHOLD    = 0.75;
const SMOOTH_N     = 6;

const BIN = {
  RECYCLABLE: {
    display: 'RECYCLABLE', bin: 'Blue Bin', icon: '♻️',
    color: '#3b82f6', guideId: 'guideRecycle',
    tip: 'Clean bottles, cans, cardboard and paper can be recycled.',
  },
  RESIDUAL: {
    display: 'RESIDUAL', bin: 'Black Bin', icon: '🗑️',
    color: '#71717a', guideId: 'guideResidual',
    tip: 'This waste cannot be composted or recycled.',
  },
  BIODEGRADEABLE: {
    display: 'BIODEGRADABLE', bin: 'Green Bin', icon: '🌿',
    color: '#22c55e', guideId: 'guideBio',
    tip: 'Food scraps and organic matter that naturally break down.',
  },
  BIODEGRADABLE: {
    display: 'BIODEGRADABLE', bin: 'Green Bin', icon: '🌿',
    color: '#22c55e', guideId: 'guideBio',
    tip: 'Food scraps and organic matter that naturally break down.',
  },
};

// DOM Elements
const $ = id => document.getElementById(id);

const webcam       = $('webcam');
const btnStart     = $('btnStart');
const btnStop      = $('btnStop');
const btnRetry     = $('btnRetry');
const screenIdle   = $('screenIdle');
const screenError  = $('screenError');
const scanOverlay  = $('scanOverlay');
const resultSheet  = $('resultSheet');
const resultCard   = $('resultCard');
const resultPill   = $('resultPill');
const resultUnsure = $('resultUnsure');
const pillText     = $('pillText');
const pillDot      = $('pillDot');
const statusDot    = $('statusDot');
const statusText   = $('statusText');
const modelHint    = $('modelHint');
const guideToggle  = $('guideToggle');
const guideModal   = $('guideModal');
const guideClose   = $('guideClose');

// Result card elements
const rcCategory   = $('rcCategory');
const rcBinDot     = $('rcBinDot');
const rcBinText    = $('rcBinText');
const rcIcon       = $('rcIcon');
const rcConfPct    = $('rcConfPct');
const rcBarFill    = $('rcBarFill');
const rcTip        = $('rcTip');
const unsureConfPct= $('unsureConfPct');

let tmModel          = null;
let rafId            = null;
let stream           = null;
let history          = [];
let isStartingCamera = false;

// ── UI State Machine ──
function setUIState(state) {
  // 'idle' | 'scanning' | 'error'
  const isIdle     = state === 'idle';
  const isScanning = state === 'scanning';
  const isError    = state === 'error';

  screenIdle.hidden  = !isIdle;
  screenError.hidden = !isError;
  scanOverlay.hidden = !isScanning;
  resultSheet.hidden = !isScanning;
  guideToggle.hidden = !isScanning;

  btnStart.disabled  = isScanning;
  btnStop.disabled   = !isScanning;
}

function showErrorScreen(title, body) {
  $('errorTitle').textContent = title;
  $('errorBody').textContent  = body;
  setUIState('error');
}

function setStatus(state, label) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = label;
}

// ── Guide modal ──
function openGuide()  { guideModal.classList.add('open'); }
function closeGuide() { guideModal.classList.remove('open'); }

guideToggle.addEventListener('click', openGuide);
guideClose.addEventListener('click',  closeGuide);
guideModal.addEventListener('click', e => {
  if (e.target === guideModal) closeGuide();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeGuide();
});

// ── Camera Management ──
async function getCameraStream() {
  const attempts = [
    // 1. Back camera for phone waste scanning
    {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    },
    // 2. Any camera with ideal width
    {
      video: { width: { ideal: 1280 } },
      audio: false
    },
    // 3. Fallback: bare minimum video constraint (laptop webcams / external cams)
    {
      video: true,
      audio: false
    }
  ];

  let lastErr = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
      // If user denied permission or system blocked it, don't spam attempts
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.name === 'SecurityError') {
        throw err;
      }
    }
  }
  throw lastErr;
}

async function startCamera(isUserGesture = false) {
  if (isStartingCamera || (stream && webcam.srcObject)) return;
  isStartingCamera = true;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showErrorScreen('Camera not supported', 'Your browser does not support camera access or the connection is not secure (HTTPS required).');
    isStartingCamera = false;
    return;
  }

  try {
    stream = await getCameraStream();
    webcam.srcObject = stream;
    webcam.classList.add('active');

    try {
      await webcam.play();
    } catch (playErr) {
      console.warn('[BinGo] video.play() warning:', playErr);
    }

    setUIState('scanning');

    if (tmModel) {
      showResult('pill', 'Point at an item to sort it');
      history = [];
      if (!rafId) rafId = requestAnimationFrame(predict);
    } else {
      showResult('pill', 'Loading AI model…');
    }
  } catch (err) {
    console.error('[BinGo] Camera error:', err);
    // If auto-start on load failed due to browser autoplay policy (NotAllowedError without user gesture),
    // keep the clean idle screen ready so user can tap "Start Scanning" directly.
    if (!isUserGesture && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      console.info('[BinGo] Browser requires user tap to start camera.');
      setUIState('idle');
      modelHint.textContent = tmModel ? 'AI ready — tap Start Scanning below' : 'Tap Start Scanning below';
    } else {
      handleCamError(err);
    }
  } finally {
    isStartingCamera = false;
  }
}

function stopCamera() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  webcam.srcObject = null;
  webcam.classList.remove('active');

  setUIState('idle');
  closeGuide();
  history = [];
}

function handleCamError(err) {
  const msgs = {
    NotAllowedError:       'Camera access was blocked. Please click the lock or camera icon in your browser address bar to allow camera access, then tap Try Again.',
    PermissionDeniedError: 'Camera permission was denied. Please allow camera access in your browser settings, then tap Try Again.',
    NotFoundError:         'No camera detected on this device. Please connect or enable a camera.',
    NotReadableError:      'Camera is in use by another application. Please close other camera apps and tap Try Again.',
    OverconstrainedError:  'Requested camera format is not supported by your device.',
  };
  showErrorScreen('Camera unavailable', msgs[err.name] || 'Could not access the camera. Please allow camera access and try again.');
}

// Camera buttons
btnStart.addEventListener('click', () => startCamera(true));
btnStop.addEventListener('click',  stopCamera);
btnRetry.addEventListener('click', () => {
  setUIState('idle');
  startCamera(true);
});

// ── Model Loading ──
async function loadModel() {
  if (location.protocol === 'file:') {
    showErrorScreen('Open via a server', 'Open BinGo through a deployed URL or a local server — not by double-clicking the HTML file.');
    setStatus('error', 'Must use HTTP/HTTPS');
    return;
  }

  setStatus('loading', 'Loading AI…');
  modelHint.textContent = 'Loading AI model…';

  // Wait up to 8s for tmImage global to be available
  let wait = 0;
  while (typeof tmImage === 'undefined' && wait < 40) {
    await new Promise(r => setTimeout(r, 200));
    wait++;
  }

  if (typeof tmImage === 'undefined') {
    showErrorScreen('Library failed to load', 'Check your internet connection and refresh the page.');
    setStatus('error', 'Library error');
    modelHint.textContent = 'Library not loaded';
    return;
  }

  try {
    tmModel = await tmImage.load(MODEL_URL, METADATA_URL);
    setStatus('ready', 'AI ready');
    modelHint.textContent = 'AI model loaded ✓';

    // If camera is already active, start predictions immediately
    if (stream && webcam.srcObject) {
      showResult('pill', 'Point at an item to sort it');
      history = [];
      if (!rafId) rafId = requestAnimationFrame(predict);
    }
  } catch (err) {
    console.error('[BinGo] Model load error:', err);
    const msg = (err.message || '').includes('404')
      ? 'Model files not found. Make sure waste_sorting_ai/ is in the project folder.'
      : 'Failed to load the AI model. Check console for details.';
    showErrorScreen('Model error', msg);
    setStatus('error', 'Model error');
    modelHint.textContent = 'Model failed to load';
  }
}

// ── Prediction Loop ──
async function predict() {
  if (!tmModel || !webcam.srcObject) return;
  try {
    const preds = await tmModel.predict(webcam);
    processPredictions(preds);
  } catch (e) {
    /* transient prediction frame error */
  }
  rafId = requestAnimationFrame(predict);
}

function processPredictions(preds) {
  const top = preds.reduce((a, b) => a.probability > b.probability ? a : b);
  const label = top.className.toUpperCase().trim();
  const conf  = top.probability;

  history.push(label);
  if (history.length > SMOOTH_N) history.shift();

  const counts = {};
  history.forEach(l => counts[l] = (counts[l] || 0) + 1);
  const smoothed = Object.keys(counts).reduce((a, b) => counts[a] >= counts[b] ? a : b);
  const smoothedConf = preds.find(p => p.className.toUpperCase().trim() === smoothed)?.probability ?? conf;

  renderResult(smoothed, smoothedConf);
}

function renderResult(label, conf) {
  // Clear guide highlights
  document.querySelectorAll('.guide-item').forEach(el => el.style.outline = '');

  if (label === 'NONE') {
    showResult('pill', 'Point at an item to sort it');
    pillDot.style.background = '#71717a';
    return;
  }

  const bin = BIN[label];

  if (!bin || conf < THRESHOLD) {
    showResult('unsure');
    const pct = Math.round(conf * 100);
    unsureConfPct.textContent = pct + '%';
    return;
  }

  // Confident result
  showResult('card');

  rcCategory.textContent = bin.display;
  rcIcon.textContent     = bin.icon;
  rcBinDot.style.cssText = `background:${bin.color}; box-shadow:0 0 8px ${bin.color}`;
  rcBinText.textContent  = bin.bin;
  rcTip.textContent      = bin.tip;

  const pct = Math.round(conf * 100);
  rcConfPct.textContent    = pct + '%';
  rcBarFill.style.width    = pct + '%';

  // Apply bin color as accent
  resultCard.style.setProperty('--accent-color', bin.color);
  rcBarFill.style.background = bin.color;

  // Highlight guide
  const guideEl = $(bin.guideId);
  if (guideEl) guideEl.style.outline = `2px solid ${bin.color}`;
}

function showResult(mode, text) {
  resultPill.hidden   = mode !== 'pill';
  resultCard.hidden   = mode !== 'card';
  resultUnsure.hidden = mode !== 'unsure';
  if (mode === 'pill' && text) {
    pillText.textContent = text;
    pillDot.style.background = '#22c55e';
  }
}

// ── Application Initialization ──
(function init() {
  setUIState('idle');
  // Load AI model and request camera permission immediately
  loadModel();
  startCamera(false);
}());
