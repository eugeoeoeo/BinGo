/**
 * BinGo — app.js
 * Teachable Machine Image + TF.js, local model
 * Labels from metadata.json: RECYCLABLE, RESIDUAL, BIODEGRADEABLE, NONE
 */

'use strict';

// ── Config ──────────────────────────────────────────────
const MODEL_URL    = './waste_sorting_ai/model.json';
const METADATA_URL = './waste_sorting_ai/metadata.json';
const THRESHOLD    = 0.75;   // confidence required to show a result
const SMOOTH_N     = 6;      // consecutive frames before updating UI

// ── Bin data (keyed to the EXACT label strings the model emits) ──
const BIN = {
  RECYCLABLE: {
    display: 'RECYCLABLE',
    binLabel: 'Put it in the Blue Bin',
    color:    '#3b82f6',
    swatchBg: 'background:#3b82f6; box-shadow:0 0 8px rgba(59,130,246,0.6)',
    tip:      'Clean bottles, cans, cardboard, and paper can often be processed and reused.',
    icon:     '♻️',
    attr:     'recycle',
    guideId:  'guideRecycle',
  },
  RESIDUAL: {
    display: 'RESIDUAL',
    binLabel: 'Put it in the Black Bin',
    color:    '#71717a',
    swatchBg: 'background:#71717a; box-shadow:0 0 8px rgba(113,113,122,0.5)',
    tip:      'Some waste cannot be composted or recycled through the available system.',
    icon:     '🗑️',
    attr:     'residual',
    guideId:  'guideResidual',
  },
  // Model uses typo "BIODEGRADEABLE" — handle both spellings
  BIODEGRADEABLE: {
    display: 'BIODEGRADABLE',
    binLabel: 'Put it in the Green Bin',
    color:    '#22c55e',
    swatchBg: 'background:#22c55e; box-shadow:0 0 8px rgba(34,197,94,0.6)',
    tip:      'Food scraps and leaves can naturally break down — great for composting!',
    icon:     '🌿',
    attr:     'bio',
    guideId:  'guideBio',
  },
  BIODEGRADABLE: {
    display: 'BIODEGRADABLE',
    binLabel: 'Put it in the Green Bin',
    color:    '#22c55e',
    swatchBg: 'background:#22c55e; box-shadow:0 0 8px rgba(34,197,94,0.6)',
    tip:      'Food scraps and leaves can naturally break down — great for composting!',
    icon:     '🌿',
    attr:     'bio',
    guideId:  'guideBio',
  },
};

// ── DOM ─────────────────────────────────────────────────
const get = id => document.getElementById(id);

const webcam       = get('webcam');
const btnStart     = get('btnStart');
const btnStop      = get('btnStop');
const camIdle      = get('camIdle');
const camError     = get('camError');
const scanOverlay  = get('scanOverlay');
const statusDot    = get('statusDot');
const statusText   = get('statusText');
const errorMsg     = get('errorMsg');

const resultPlaceholder = get('resultPlaceholder');
const resultCard        = get('resultCard');
const resultUnsure      = get('resultUnsure');
const resultNoItem      = get('resultNoItem');

// Result card parts
const rcIcon      = get('rcIcon');
const rcName      = get('rcName');
const rcBinTag    = get('rcBinTag');
const rcBinSwatch = get('rcBinSwatch');
const rcBinLabel  = get('rcBinLabel');
const rcTip       = get('rcTip');
const rcPct       = get('rcPct');
const rcFill      = get('rcFill');
const rcProgressBar = get('rcProgressBar');

// Unsure card parts
const rcPctU  = get('rcPctU');
const rcFillU = get('rcFillU');

// ── State ────────────────────────────────────────────────
let tmModel  = null;
let rafId    = null;
let stream   = null;
let history  = [];  // rolling label window for smoothing

// ── Model loading ────────────────────────────────────────
async function loadModel() {
  // Must be served over HTTP/HTTPS — file:// blocks fetch
  if (location.protocol === 'file:') {
    setStatus('error', 'Open via a server, not file://');
    showError('⚠️', 'Open via a server', 'You must open BinGo through a local server (e.g. npx serve .) or a deployed URL — not by double-clicking the HTML file.');
    return;
  }

  setStatus('loading', 'Loading AI model…');

  // Wait for tmImage to be defined (CDN loads async)
  let attempts = 0;
  while (typeof tmImage === 'undefined' && attempts < 30) {
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }

  if (typeof tmImage === 'undefined') {
    setStatus('error', 'AI library failed to load');
    showError('⚠️', 'Network error', 'Could not load the AI library. Check your internet connection and refresh.');
    btnStart.disabled = false;
    return;
  }

  try {
    tmModel = await tmImage.load(MODEL_URL, METADATA_URL);
    setStatus('ready', 'AI model ready');
    startCamera(); // auto-start camera + request permission
  } catch (err) {
    console.error('[BinGo] Model load failed:', err);
    const msg = err.message || '';
    if (msg.includes('404') || msg.includes('fetch')) {
      setStatus('error', 'Model files not found');
      showError('⚠️', 'Model not found', 'Make sure the waste_sorting_ai/ folder is in the same directory as index.html.');
    } else {
      setStatus('error', 'Could not load AI model');
      showError('⚠️', 'Model error', 'Failed to load: ' + msg);
    }
    btnStart.disabled = false;
  }
}

function showError(icon, title, body) {
  camIdle.hidden  = true;
  camError.hidden = false;
  camError.querySelector('.cam-state-icon').textContent = icon;
  camError.querySelector('.cam-state-title').textContent = title;
  document.getElementById('errorMsg').textContent = body;
}

function setStatus(state, label) {
  statusDot.className = 'mpill-dot ' + state;
  statusText.textContent = label;
}

// ── Camera start / stop ───────────────────────────────────
btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);

async function startCamera() {
  if (!tmModel) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
      audio: false,
    });
    webcam.srcObject = stream;
    webcam.classList.add('active');
    camIdle.hidden     = true;
    camError.hidden    = true;
    scanOverlay.hidden = false;
    btnStart.disabled  = true;
    btnStop.disabled   = false;
    history = [];
    rafId = requestAnimationFrame(predict);
  } catch (err) {
    handleCameraError(err);
  }
}

function stopCamera() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  webcam.srcObject = null;
  webcam.classList.remove('active');
  camIdle.hidden     = false;
  scanOverlay.hidden = true;
  btnStart.disabled  = false;
  btnStop.disabled   = true;
  history = [];
  showPanel('placeholder');
  highlightGuide(null);
}

function handleCameraError(err) {
  camIdle.hidden  = true;
  camError.hidden = false;
  const msg = {
    NotAllowedError:       'Camera permission denied. Please allow camera access in your browser settings.',
    PermissionDeniedError: 'Camera permission denied.',
    NotFoundError:         'No camera found on this device.',
    NotReadableError:      'Camera is in use by another application.',
  }[err.name] || 'Could not access the camera. Please try again.';
  errorMsg.textContent = msg;
  btnStart.disabled = false;
  btnStop.disabled  = true;
}

// ── Prediction loop ───────────────────────────────────────
async function predict() {
  if (!tmModel || !webcam.srcObject) return;
  try {
    const preds = await tmModel.predict(webcam);
    processPredictions(preds);
  } catch (e) {
    // Transient errors during prediction — log and continue
    console.warn('[BinGo] Predict error:', e);
  }
  rafId = requestAnimationFrame(predict);
}

function processPredictions(preds) {
  // Top class by raw probability
  const top = preds.reduce((a, b) => a.probability > b.probability ? a : b);
  const rawLabel = top.className.toUpperCase().trim();
  const rawConf  = top.probability;

  // Smoothing: majority vote over recent N frames
  history.push(rawLabel);
  if (history.length > SMOOTH_N) history.shift();

  const counts = {};
  history.forEach(l => counts[l] = (counts[l] || 0) + 1);
  const smoothed = Object.keys(counts).reduce((a, b) => counts[a] >= counts[b] ? a : b);

  // Use the live confidence of the smoothed winner
  const smoothedConf = preds.find(p => p.className.toUpperCase().trim() === smoothed)?.probability ?? rawConf;

  renderResult(smoothed, smoothedConf);
}

function renderResult(label, conf) {
  // Always clear guide highlights first
  highlightGuide(null);

  if (label === 'NONE') {
    showPanel('noitem');
    return;
  }

  const bin = BIN[label];

  if (!bin || conf < THRESHOLD) {
    showPanel('unsure');
    const pct = Math.round(conf * 100);
    rcPctU.textContent     = pct + '%';
    rcFillU.style.width    = pct + '%';
    return;
  }

  // Confident result
  showPanel('result');

  rcIcon.textContent = bin.icon;
  rcName.textContent = bin.display;
  rcName.dataset.bin = bin.attr;

  rcBinSwatch.style.cssText = bin.swatchBg;
  rcBinLabel.textContent    = bin.binLabel;

  rcTip.textContent = bin.tip;

  const pct = Math.round(conf * 100);
  rcPct.textContent  = pct + '%';
  rcFill.style.width = pct + '%';
  rcFill.dataset.bin = bin.attr;
  rcProgressBar.setAttribute('aria-valuenow', pct);

  // Card accent via data-bin attribute (styled in CSS)
  resultCard.dataset.bin = bin.attr;

  highlightGuide(bin.guideId);
}

// ── UI panel switcher ─────────────────────────────────────
function showPanel(panel) {
  resultPlaceholder.hidden = panel !== 'placeholder';
  resultCard.hidden        = panel !== 'result';
  resultUnsure.hidden      = panel !== 'unsure';
  resultNoItem.hidden      = panel !== 'noitem';
}

// ── Guide highlight ────────────────────────────────────────
function highlightGuide(id) {
  document.querySelectorAll('.guide-tile').forEach(el => el.classList.remove('highlighted'));
  if (id) {
    const tile = get(id);
    if (tile) tile.classList.add('highlighted');
  }
}

// ── Init ────────────────────────────────────────────────
(function init() {
  btnStart.disabled = true;
  btnStop.disabled  = true;
  showPanel('placeholder');
  loadModel(); // loads model then auto-starts camera
}());
