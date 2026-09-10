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

// DOM
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

// Result card parts
const rcCategory   = $('rcCategory');
const rcBinDot     = $('rcBinDot');
const rcBinText    = $('rcBinText');
const rcIcon       = $('rcIcon');
const rcConfPct    = $('rcConfPct');
const rcBarFill    = $('rcBarFill');
const rcTip        = $('rcTip');
const unsureConfPct= $('unsureConfPct');

let tmModel = null;
let rafId   = null;
let stream  = null;
let history = [];

// ── Guide modal ──
guideToggle.addEventListener('click', () => { guideModal.hidden = false; });
guideClose.addEventListener('click',  () => { guideModal.hidden = true; });
guideModal.addEventListener('click', e => { if (e.target === guideModal) guideModal.hidden = true; });

// ── Model load ──
async function loadModel() {
  if (location.protocol === 'file:') {
    showErrorScreen('Open via a server', 'Open BinGo through a deployed URL or a local server — not by double-clicking the HTML file.');
    setStatus('error', 'Must use HTTP/HTTPS');
    return;
  }

  setStatus('loading', 'Loading AI…');
  modelHint.textContent = 'Loading AI model…';

  // Wait up to 6s for tmImage global to be available
  let wait = 0;
  while (typeof tmImage === 'undefined' && wait < 30) {
    await new Promise(r => setTimeout(r, 200));
    wait++;
  }

  if (typeof tmImage === 'undefined') {
    showErrorScreen('Library failed to load', 'Check your internet connection and refresh the page.');
    setStatus('error', 'Library error');
    modelHint.textContent = 'Library not loaded';
    btnStart.disabled = false;
    return;
  }

  try {
    tmModel = await tmImage.load(MODEL_URL, METADATA_URL);
    setStatus('ready', 'AI ready');
    modelHint.textContent = 'AI model loaded ✓';
    btnStart.disabled = false;
    // Auto-start: request camera permission immediately
    startCamera();
  } catch (err) {
    console.error('[BinGo] Model load error:', err);
    const msg = (err.message || '').includes('404')
      ? 'Model files not found. Make sure waste_sorting_ai/ is in the project folder.'
      : 'Failed to load the AI model. Check console for details.';
    showErrorScreen('Model error', msg);
    setStatus('error', 'Model error');
    modelHint.textContent = 'Model failed to load';
    btnStart.disabled = false;
  }
}

function setStatus(state, label) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = label;
}

// ── Camera ──
btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click',  stopCamera);
btnRetry.addEventListener('click', () => {
  screenError.hidden = true;
  screenIdle.hidden  = false;
  if (tmModel) startCamera();
  else loadModel();
});

async function startCamera() {
  if (!tmModel) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
      audio: false,
    });
    webcam.srcObject = stream;
    webcam.classList.add('active');

    // Hide idle screen, show scan UI
    screenIdle.hidden  = true;
    screenError.hidden = true;
    scanOverlay.hidden = false;
    resultSheet.hidden = false;
    guideToggle.hidden = false;

    btnStart.disabled = true;
    btnStop.disabled  = false;

    showResult('pill', 'Show me one item!');
    history = [];
    rafId = requestAnimationFrame(predict);
  } catch (err) {
    handleCamError(err);
  }
}

function stopCamera() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  webcam.srcObject = null;
  webcam.classList.remove('active');

  screenIdle.hidden  = false;
  scanOverlay.hidden = true;
  resultSheet.hidden = true;
  guideToggle.hidden = true;
  guideModal.hidden  = true;

  btnStart.disabled = false;
  btnStop.disabled  = true;
  history = [];
}

function handleCamError(err) {
  const msgs = {
    NotAllowedError:       'Camera permission denied. Allow access in your browser settings, then try again.',
    PermissionDeniedError: 'Camera permission denied.',
    NotFoundError:         'No camera found on this device.',
    NotReadableError:      'Camera is busy. Close other apps using the camera.',
  };
  showErrorScreen('Camera unavailable', msgs[err.name] || 'Could not access the camera.');
  btnStop.disabled = true;
  btnStart.disabled = false;
}

function showErrorScreen(title, body) {
  screenIdle.hidden  = true;
  screenError.hidden = false;
  $('errorTitle').textContent = title;
  $('errorBody').textContent  = body;
}

// ── Prediction ──
async function predict() {
  if (!tmModel || !webcam.srcObject) return;
  try {
    const preds = await tmModel.predict(webcam);
    processPredictions(preds);
  } catch(e) { /* transient */ }
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

// ── Init ──
(function init() {
  btnStart.disabled = true;
  btnStop.disabled  = true;
  guideToggle.hidden = true;
  loadModel();
}());
