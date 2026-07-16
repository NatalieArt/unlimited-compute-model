(function (global) {
  'use strict';

  var DESKTOP_CACHE_LIMIT = 16;
  var MOBILE_CACHE_LIMIT = 10;
  var PREVIEW_SHEET_CACHE_LIMIT = 5;
  var PREVIEW_LOOKAHEAD = 4;
  var HD_PREVIEW_SHEET_CACHE_LIMIT = 4;
  var HD_PREVIEW_LOOKAHEAD = 2;
  var SETTLE_DELAY = 120;
  var MAX_DPR = 2;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function padFrame(index, width) {
    var value = String(index);
    while (value.length < width) value = '0' + value;
    return value;
  }

  function allowsHdPreview(navigatorObject) {
    var connection = navigatorObject && (
      navigatorObject.connection || navigatorObject.mozConnection || navigatorObject.webkitConnection
    );
    if (!connection) return true;
    if (connection.saveData) return false;
    if (connection.effectiveType === 'slow-2g') return false;
    if (connection.effectiveType === '2g') return false;
    return true;
  }

  function create(canvas, options) {
    options = options || {};
    if (!canvas || typeof canvas.getContext !== 'function') return null;

    var context = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!context) return null;

    var frameRoot = options.frameRoot || canvas.getAttribute('data-frame-root') || '';
    var frameCount = Number(options.frameCount || canvas.getAttribute('data-frame-count') || 0);
    var framePad = Number(options.framePad || canvas.getAttribute('data-frame-pad') || 3);
    var version = options.version || canvas.getAttribute('data-frame-version') || '';
    var isMobile = global.matchMedia && global.matchMedia('(max-width: 720px)').matches;
    var previewVariant = isMobile ? 'mobile' : 'desktop';
    var previewRootAttribute = isMobile ? 'data-preview-root-mobile' : 'data-preview-root-desktop';
    var previewWidthAttribute = isMobile ? 'data-preview-width-mobile' : 'data-preview-width-desktop';
    var previewHeightAttribute = isMobile ? 'data-preview-height-mobile' : 'data-preview-height-desktop';
    var previewRoot = options.previewRoot || canvas.getAttribute(previewRootAttribute) || '';
    var previewCount = Number(options.previewCount || canvas.getAttribute('data-preview-count') || 0);
    var previewStep = Number(options.previewStep || canvas.getAttribute('data-preview-step') || 1);
    var previewColumns = Number(options.previewColumns || canvas.getAttribute('data-preview-columns') || 1);
    var previewRows = Number(options.previewRows || canvas.getAttribute('data-preview-rows') || 1);
    var previewTileWidth = Number(options.previewTileWidth || canvas.getAttribute(previewWidthAttribute) || 0);
    var previewTileHeight = Number(options.previewTileHeight || canvas.getAttribute(previewHeightAttribute) || 0);
    var previewTilesPerSheet = previewColumns * previewRows;
    var previewSheetCount = previewTilesPerSheet > 0 ? Math.ceil(previewCount / previewTilesPerSheet) : 0;
    var hdEnabled = !isMobile && allowsHdPreview(global.navigator);
    var hdRoot = options.hdRoot || canvas.getAttribute('data-preview-root-desktop-hd') || '';
    var hdCount = Number(options.hdCount || canvas.getAttribute('data-preview-count-desktop-hd') || 0);
    var hdStep = Number(options.hdStep || canvas.getAttribute('data-preview-step-desktop-hd') || 1);
    var hdColumns = Number(options.hdColumns || canvas.getAttribute('data-preview-columns-desktop-hd') || 1);
    var hdRows = Number(options.hdRows || canvas.getAttribute('data-preview-rows-desktop-hd') || 1);
    var hdTileWidth = Number(options.hdTileWidth || canvas.getAttribute('data-preview-width-desktop-hd') || 0);
    var hdTileHeight = Number(options.hdTileHeight || canvas.getAttribute('data-preview-height-desktop-hd') || 0);
    var hdTilesPerSheet = hdColumns * hdRows;
    var hdSheetCount = hdTilesPerSheet > 0 ? Math.ceil(hdCount / hdTilesPerSheet) : 0;
    var cacheLimit = isMobile ? MOBILE_CACHE_LIMIT : DESKTOP_CACHE_LIMIT;

    if (!frameRoot || frameCount < 1) return null;

    var loaded = new Map();
    var failed = new Set();
    var previewSheets = new Map();
    var previewLoading = new Set();
    var previewFailed = new Set();
    var previewCenterSheet = 0;
    var previewDirection = 1;
    var hdSheets = new Map();
    var hdLoading = new Set();
    var hdFailed = new Set();
    var hdCenterSheet = 0;
    var hdDirection = 1;
    var hdStarted = false;
    var hdStartTimer = 0;
    var exactLoadingImage = null;
    var exactLoadingIndex = -1;
    var exactLoadToken = 0;
    var targetFrame = 0;
    var drawnFrame = -1;
    var renderMode = '';
    var lastTargetChange = Date.now();
    var drawRequest = 0;
    var settleTimer = 0;
    var destroyed = false;

    function assetUrl(root, suffix) {
      return root + suffix + '.webp' + (version ? '?v=' + encodeURIComponent(version) : '');
    }

    function frameUrl(index) {
      return assetUrl(frameRoot, padFrame(index, framePad));
    }

    function previewUrl(index) {
      return assetUrl(previewRoot, String(index));
    }

    function hdUrl(index) {
      return assetUrl(hdRoot, String(index));
    }

    function decodeImage(image, callback) {
      if (typeof image.decode !== 'function') {
        callback();
        return;
      }

      try {
        var decoding = image.decode();
        if (decoding && typeof decoding.then === 'function') {
          decoding.then(callback, callback);
          return;
        }
      } catch (error) {
        // Older browsers can expose decode() but throw when it is called.
      }
      callback();
    }

    function touch(index) {
      if (!loaded.has(index)) return;
      var image = loaded.get(index);
      loaded.delete(index);
      loaded.set(index, image);
    }

    function trimCache() {
      if (loaded.size <= cacheLimit) return;
      var keys = loaded.keys();
      var next = keys.next();
      while (!next.done && loaded.size > cacheLimit) {
        var index = next.value;
        if (index !== targetFrame && index !== drawnFrame && index !== 0) loaded.delete(index);
        next = keys.next();
      }
    }

    function nearestLoaded(index) {
      if (loaded.has(index)) return index;
      for (var distance = 1; distance < frameCount; distance += 1) {
        var before = index - distance;
        var after = index + distance;
        if (before >= 0 && loaded.has(before)) return before;
        if (after < frameCount && loaded.has(after)) return after;
      }
      return -1;
    }

    function resize() {
      if (destroyed) return;
      var width = Math.max(1, canvas.clientWidth || global.innerWidth || 1);
      var height = Math.max(1, canvas.clientHeight || global.innerHeight || 1);
      var dpr = Math.min(MAX_DPR, global.devicePixelRatio || 1);
      var pixelWidth = Math.round(width * dpr);
      var pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        scheduleDraw();
      }
    }

    function drawRegion(image, regionX, regionY, regionWidth, regionHeight, alpha, clearCanvas) {
      if (!image || destroyed) return false;

      resize();
      var canvasWidth = canvas.width;
      var canvasHeight = canvas.height;
      if (!canvasWidth || !canvasHeight || !regionWidth || !regionHeight) return false;

      var sourceRatio = regionWidth / regionHeight;
      var targetRatio = canvasWidth / canvasHeight;
      var sx = regionX;
      var sy = regionY;
      var sw = regionWidth;
      var sh = regionHeight;

      if (sourceRatio > targetRatio) {
        sw = regionHeight * targetRatio;
        sx += (regionWidth - sw) / 2;
      } else {
        sh = regionWidth / targetRatio;
        sy += (regionHeight - sh) / 2;
      }

      if (clearCanvas) context.clearRect(0, 0, canvasWidth, canvasHeight);
      context.globalAlpha = alpha;
      context.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in context) context.imageSmoothingQuality = 'high';
      context.drawImage(image, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight);
      return true;
    }

    function setRenderedState(index, mode) {
      drawnFrame = index;
      renderMode = mode;
      context.globalAlpha = 1;
      canvas.setAttribute('data-drawn-frame', String(index));
      canvas.setAttribute('data-render-mode', mode);
      canvas.classList.add('is-ready');
      if (hdEnabled && !hdStarted && hdRoot && hdSheetCount) {
        hdStarted = true;
        hdStartTimer = global.setTimeout(function () {
          hdStartTimer = 0;
          ensureHdPreview(targetFrame, previewDirection);
        }, 0);
      }
    }

    function drawFullFrame(index, mode) {
      var image = loaded.get(index);
      if (!image || destroyed) return false;
      if (renderMode === mode && drawnFrame === index) return true;

      var sourceWidth = image.naturalWidth || image.width;
      var sourceHeight = image.naturalHeight || image.height;
      if (!drawRegion(image, 0, 0, sourceWidth, sourceHeight, 1, true)) return false;

      touch(index);
      setRenderedState(index, mode);
      return true;
    }

    function previewTile(index) {
      index = clamp(index, 0, previewCount - 1);
      var sheetIndex = Math.floor(index / previewTilesPerSheet);
      var cellIndex = index % previewTilesPerSheet;
      var image = previewSheets.get(sheetIndex);
      if (!image) return null;
      return {
        image: image,
        x: (cellIndex % previewColumns) * previewTileWidth,
        y: Math.floor(cellIndex / previewColumns) * previewTileHeight
      };
    }

    function drawSharpPreview(frame) {
      if (!previewCount || !previewRoot || !previewTileWidth || !previewTileHeight) return false;
      var previewIndex = clamp(Math.round(frame / previewStep), 0, previewCount - 1);
      var previewFrame = Math.min(frameCount - 1, previewIndex * previewStep);
      if (renderMode === 'preview-sharp' && drawnFrame === previewFrame) return true;

      var tile = previewTile(previewIndex);
      if (!tile) return false;
      if (!drawRegion(
        tile.image,
        tile.x,
        tile.y,
        previewTileWidth,
        previewTileHeight,
        1,
        true
      )) return false;

      setRenderedState(previewFrame, 'preview-sharp');
      return true;
    }

    function hdTile(index) {
      index = clamp(index, 0, hdCount - 1);
      var sheetIndex = Math.floor(index / hdTilesPerSheet);
      var cellIndex = index % hdTilesPerSheet;
      var image = hdSheets.get(sheetIndex);
      if (!image) return null;
      return {
        image: image,
        x: (cellIndex % hdColumns) * hdTileWidth,
        y: Math.floor(cellIndex / hdColumns) * hdTileHeight
      };
    }

    function drawHdPreview(frame) {
      if (!hdEnabled || !hdCount || !hdRoot || !hdTileWidth || !hdTileHeight) return false;
      var hdPreviewIndex = clamp(Math.round(frame / hdStep), 0, hdCount - 1);
      var hdPreviewFrame = Math.min(frameCount - 1, hdPreviewIndex * hdStep);
      if (renderMode === 'preview-hd' && drawnFrame === hdPreviewFrame) return true;

      var tile = hdTile(hdPreviewIndex);
      if (!tile) return false;
      if (!drawRegion(tile.image, tile.x, tile.y, hdTileWidth, hdTileHeight, 1, true)) return false;

      setRenderedState(hdPreviewFrame, 'preview-hd');
      return true;
    }

    function drawBestFrame() {
      drawRequest = 0;
      if (loaded.has(targetFrame) && drawFullFrame(targetFrame, 'full')) return;
      if (drawHdPreview(targetFrame)) return;
      if (drawSharpPreview(targetFrame)) return;

      var fallback = nearestLoaded(targetFrame);
      if (fallback >= 0) drawFullFrame(fallback, 'full-fallback');
    }

    function scheduleDraw() {
      if (!drawRequest && !destroyed) drawRequest = global.requestAnimationFrame(drawBestFrame);
    }

    function armSettleDraw() {
      if (settleTimer) global.clearTimeout(settleTimer);
      settleTimer = global.setTimeout(function () {
        settleTimer = 0;
        ensureExactTarget(targetFrame);
        scheduleDraw();
      }, SETTLE_DELAY + 16);
    }

    function trimPreviewSheets(centerSheet) {
      if (previewSheets.size <= PREVIEW_SHEET_CACHE_LIMIT) return;
      var keep = new Set();
      for (var distance = 0; distance <= PREVIEW_LOOKAHEAD; distance += 1) {
        var keepIndex = centerSheet + distance * previewDirection;
        if (keepIndex >= 0 && keepIndex < previewSheetCount) keep.add(keepIndex);
      }
      var candidates = Array.from(previewSheets.keys()).sort(function (a, b) {
        if (keep.has(a) !== keep.has(b)) return keep.has(a) ? 1 : -1;
        return Math.abs(b - centerSheet) - Math.abs(a - centerSheet);
      });
      while (previewSheets.size > PREVIEW_SHEET_CACHE_LIMIT && candidates.length) {
        var index = candidates.shift();
        if (index !== centerSheet) previewSheets.delete(index);
      }
    }

    function trimHdSheets(centerSheet) {
      if (hdSheets.size <= HD_PREVIEW_SHEET_CACHE_LIMIT) return;
      var keep = new Set();
      for (var distance = 0; distance <= HD_PREVIEW_LOOKAHEAD; distance += 1) {
        var keepIndex = centerSheet + distance * hdDirection;
        if (keepIndex >= 0 && keepIndex < hdSheetCount) keep.add(keepIndex);
      }
      var candidates = Array.from(hdSheets.keys()).sort(function (a, b) {
        if (keep.has(a) !== keep.has(b)) return keep.has(a) ? 1 : -1;
        return Math.abs(b - centerSheet) - Math.abs(a - centerSheet);
      });
      while (hdSheets.size > HD_PREVIEW_SHEET_CACHE_LIMIT && candidates.length) {
        var index = candidates.shift();
        if (index !== centerSheet) hdSheets.delete(index);
      }
    }

    function loadHdSheet(index, urgent) {
      if (!hdEnabled || index < 0 || index >= hdSheetCount) return;
      if (hdSheets.has(index) || hdLoading.has(index) || hdFailed.has(index)) return;

      var image = new Image();
      var finished = false;
      hdLoading.add(index);
      if ('fetchPriority' in image) image.fetchPriority = urgent ? 'high' : 'low';
      image.decoding = 'async';
      image.onload = function () {
        decodeImage(image, function () {
          if (finished) return;
          finished = true;
          hdLoading.delete(index);
          if (!destroyed) {
            hdSheets.set(index, image);
            trimHdSheets(hdCenterSheet);
            scheduleDraw();
          }
        });
      };
      image.onerror = function () {
        if (finished) return;
        finished = true;
        hdLoading.delete(index);
        hdFailed.add(index);
        canvas.setAttribute('data-hd-errors', String(hdFailed.size));
      };
      image.src = hdUrl(index);
    }

    function ensureHdPreview(frame, direction) {
      if (!hdEnabled || !hdStarted || !hdRoot || !hdSheetCount || !hdTileWidth || !hdTileHeight) return;
      hdDirection = direction < 0 ? -1 : 1;
      var hdPreviewIndex = clamp(Math.round(frame / hdStep), 0, hdCount - 1);
      hdCenterSheet = Math.floor(hdPreviewIndex / hdTilesPerSheet);
      loadHdSheet(hdCenterSheet, true);
      for (var distance = 1; distance <= HD_PREVIEW_LOOKAHEAD; distance += 1) {
        loadHdSheet(hdCenterSheet + distance * hdDirection, false);
      }
      trimHdSheets(hdCenterSheet);
    }

    function loadPreviewAhead() {
      for (var distance = 1; distance <= PREVIEW_LOOKAHEAD; distance += 1) {
        loadPreviewSheet(previewCenterSheet + distance * previewDirection, true);
      }
    }

    function loadPreviewSheet(index, urgent) {
      if (index < 0 || index >= previewSheetCount) return;
      if (previewSheets.has(index) || previewLoading.has(index) || previewFailed.has(index)) return;

      var image = new Image();
      var finished = false;
      previewLoading.add(index);
      if ('fetchPriority' in image) image.fetchPriority = urgent ? 'high' : 'low';
      image.decoding = 'async';
      image.onload = function () {
        decodeImage(image, function () {
          if (finished) return;
          finished = true;
          previewLoading.delete(index);
          if (!destroyed) {
            previewSheets.set(index, image);
            trimPreviewSheets(previewCenterSheet);
            scheduleDraw();
            if (index === previewCenterSheet) loadPreviewAhead();
          }
        });
      };
      image.onerror = function () {
        if (finished) return;
        finished = true;
        previewLoading.delete(index);
        previewFailed.add(index);
        canvas.setAttribute('data-preview-errors', String(previewFailed.size));
      };
      image.src = previewUrl(index);
    }

    function ensurePreviewSheets(frame, direction) {
      if (!previewRoot || !previewSheetCount || !previewTileWidth || !previewTileHeight) return;
      previewDirection = direction < 0 ? -1 : 1;
      var previewIndex = clamp(Math.round(frame / previewStep), 0, previewCount - 1);
      previewCenterSheet = Math.floor(previewIndex / previewTilesPerSheet);
      loadPreviewSheet(previewCenterSheet, true);
      if (previewSheets.has(previewCenterSheet)) loadPreviewAhead();
      trimPreviewSheets(previewCenterSheet);
    }

    function loadPreviewSheets() {
      ensurePreviewSheets(0, 1);
    }

    function abortExactLoad() {
      exactLoadToken += 1;
      if (exactLoadingImage) {
        exactLoadingImage.onload = null;
        exactLoadingImage.onerror = null;
        try {
          exactLoadingImage.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
        } catch (error) {
          // The request token still prevents a late callback from being used.
        }
      }
      exactLoadingImage = null;
      exactLoadingIndex = -1;
    }

    function ensureExactTarget(index) {
      index = clamp(Math.round(index), 0, frameCount - 1);
      if (exactLoadingIndex >= 0 && exactLoadingIndex !== index) abortExactLoad();
      if (loaded.has(index) || failed.has(index) || exactLoadingIndex === index) return;

      abortExactLoad();
      exactLoadingIndex = index;
      var token = exactLoadToken;
      var image = new Image();
      exactLoadingImage = image;
      if ('fetchPriority' in image) image.fetchPriority = 'high';
      image.decoding = 'async';

      image.onload = function () {
        decodeImage(image, function () {
          if (destroyed || token !== exactLoadToken || exactLoadingIndex !== index) return;
          exactLoadingImage = null;
          exactLoadingIndex = -1;
          loaded.set(index, image);
          trimCache();
          scheduleDraw();
        });
      };
      image.onerror = function () {
        if (destroyed || token !== exactLoadToken || exactLoadingIndex !== index) return;
        exactLoadingImage = null;
        exactLoadingIndex = -1;
        failed.add(index);
        canvas.setAttribute('data-load-errors', String(failed.size));
      };
      image.src = frameUrl(index);
    }

    function setProgress(progress) {
      var nextTarget = Math.round(clamp(Number(progress) || 0, 0, 1) * (frameCount - 1));
      var direction = nextTarget >= targetFrame ? 1 : -1;
      if (nextTarget !== targetFrame) {
        targetFrame = nextTarget;
        lastTargetChange = Date.now();
        if (exactLoadingIndex >= 0 && exactLoadingIndex !== targetFrame) abortExactLoad();
        armSettleDraw();
      }
      canvas.setAttribute('data-target-frame', String(targetFrame));
      ensurePreviewSheets(targetFrame, direction);
      ensureHdPreview(targetFrame, direction);
      scheduleDraw();
    }

    function destroy() {
      destroyed = true;
      if (drawRequest) global.cancelAnimationFrame(drawRequest);
      if (settleTimer) global.clearTimeout(settleTimer);
      if (hdStartTimer) global.clearTimeout(hdStartTimer);
      abortExactLoad();
      loaded.clear();
      previewSheets.clear();
      previewLoading.clear();
      hdSheets.clear();
      hdLoading.clear();
    }

    function getState() {
      return {
        targetFrame: targetFrame,
        drawnFrame: drawnFrame,
        renderMode: renderMode,
        activeLoads: exactLoadingIndex >= 0 ? 1 : 0,
        cacheSize: loaded.size,
        failedCount: failed.size,
        queueSize: 0,
        cacheLimit: cacheLimit,
        exactLoadingIndex: exactLoadingIndex,
        previewVariant: previewVariant,
        previewSheetCount: previewSheets.size,
        previewLoadingCount: previewLoading.size,
        previewFailedCount: previewFailed.size,
        hdEnabled: hdEnabled,
        hdSheetCount: hdSheets.size,
        hdLoadingCount: hdLoading.size,
        hdFailedCount: hdFailed.size
      };
    }

    resize();
    loadPreviewSheets();
    ensureExactTarget(0);
    canvas.setAttribute('data-target-frame', '0');
    canvas.setAttribute('data-hd-enabled', hdEnabled ? 'true' : 'false');
    armSettleDraw();

    var api = {
      setProgress: setProgress,
      resize: resize,
      destroy: destroy,
      getState: getState
    };
    canvas.__sogniScrollCanvas = api;
    return api;
  }

  global.SogniScrollCanvas = { create: create };
})(window);
