(function (global) {
  'use strict';

  var MAX_CONCURRENT = 6;
  var DESKTOP_CACHE_LIMIT = 72;
  var MOBILE_CACHE_LIMIT = 36;
  var NEIGHBOR_RADIUS = 8;
  var DESKTOP_NAVIGATION_STEP = 30;
  var MOBILE_NAVIGATION_STEP = 45;
  var MAX_DPR = 2;

  var requestIdle = global.requestIdleCallback || function requestIdleCallback(callback) {
    return global.setTimeout(function () {
      callback({ didTimeout: false, timeRemaining: function () { return 8; } });
    }, 120);
  };
  var cancelIdle = global.cancelIdleCallback || global.clearTimeout;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function padFrame(index, width) {
    var value = String(index);
    while (value.length < width) value = '0' + value;
    return value;
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
    var cacheLimit = isMobile ? MOBILE_CACHE_LIMIT : DESKTOP_CACHE_LIMIT;
    var navigationStep = isMobile ? MOBILE_NAVIGATION_STEP : DESKTOP_NAVIGATION_STEP;

    if (!frameRoot || frameCount < 1) return null;

    var loaded = new Map();
    var failed = new Set();
    var queued = new Set();
    var loading = new Set();
    var navigationFrames = new Set([0]);
    var queue = [];
    var activeLoads = 0;
    var targetFrame = 0;
    var drawnFrame = -1;
    var drawRequest = 0;
    var idleRequest = 0;
    var destroyed = false;

    function frameUrl(index) {
      return frameRoot + padFrame(index, framePad) + '.webp' + (version ? '?v=' + encodeURIComponent(version) : '');
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

    function drawFrame(index) {
      var image = loaded.get(index);
      if (!image || destroyed) return false;

      resize();
      var canvasWidth = canvas.width;
      var canvasHeight = canvas.height;
      var sourceWidth = image.naturalWidth || image.width;
      var sourceHeight = image.naturalHeight || image.height;
      if (!canvasWidth || !canvasHeight || !sourceWidth || !sourceHeight) return false;

      var sourceRatio = sourceWidth / sourceHeight;
      var targetRatio = canvasWidth / canvasHeight;
      var sx = 0;
      var sy = 0;
      var sw = sourceWidth;
      var sh = sourceHeight;

      if (sourceRatio > targetRatio) {
        sw = sourceHeight * targetRatio;
        sx = (sourceWidth - sw) / 2;
      } else {
        sh = sourceWidth / targetRatio;
        sy = (sourceHeight - sh) / 2;
      }

      context.clearRect(0, 0, canvasWidth, canvasHeight);
      context.drawImage(image, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight);
      drawnFrame = index;
      touch(index);
      canvas.setAttribute('data-drawn-frame', String(index));
      canvas.classList.add('is-ready');
      return true;
    }

    function drawBestFrame() {
      drawRequest = 0;
      var index = nearestLoaded(targetFrame);
      if (index >= 0 && index !== drawnFrame) drawFrame(index);
    }

    function scheduleDraw() {
      if (!drawRequest && !destroyed) drawRequest = global.requestAnimationFrame(drawBestFrame);
    }

    function pumpQueue() {
      while (!destroyed && activeLoads < MAX_CONCURRENT && queue.length) {
        (function loadNext(index) {
          queued.delete(index);
          if (loaded.has(index) || failed.has(index)) return;

          activeLoads += 1;
          loading.add(index);
          var image = new Image();
          image.decoding = 'async';
          image.onload = function () {
            activeLoads -= 1;
            loading.delete(index);
            if (!destroyed) {
              loaded.set(index, image);
              trimCache();
              scheduleDraw();
            }
            pumpQueue();
          };
          image.onerror = function () {
            activeLoads -= 1;
            loading.delete(index);
            failed.add(index);
            canvas.setAttribute('data-load-errors', String(failed.size));
            pumpQueue();
          };
          image.src = frameUrl(index);
        })(queue.shift());
      }
    }

    function enqueue(index, urgent) {
      index = clamp(Math.round(index), 0, frameCount - 1);
      if (loaded.has(index) || failed.has(index) || queued.has(index) || loading.has(index)) return;
      queued.add(index);
      if (urgent) queue.unshift(index);
      else queue.push(index);
      pumpQueue();
    }

    function enqueueNeighborhood(index, direction) {
      for (var distance = NEIGHBOR_RADIUS; distance >= 1; distance -= 1) {
        enqueue(index + distance * direction, true);
        enqueue(index - distance * direction, true);
      }
      enqueue(index, true);
    }

    function pruneQueue(index) {
      queue = queue.filter(function (candidate) {
        var keep = navigationFrames.has(candidate) || Math.abs(candidate - index) <= NEIGHBOR_RADIUS + 2;
        if (!keep) queued.delete(candidate);
        return keep;
      });
    }

    function warmNavigationFrames() {
      idleRequest = 0;
      if (destroyed) return;
      for (var index = navigationStep; index < frameCount; index += navigationStep) {
        navigationFrames.add(index);
        enqueue(index, false);
      }
    }

    function setProgress(progress) {
      var nextTarget = Math.round(clamp(Number(progress) || 0, 0, 1) * (frameCount - 1));
      var direction = nextTarget >= targetFrame ? 1 : -1;
      if (nextTarget !== targetFrame) pruneQueue(nextTarget);
      targetFrame = nextTarget;
      canvas.setAttribute('data-target-frame', String(targetFrame));
      enqueueNeighborhood(targetFrame, direction);
      scheduleDraw();
    }

    function destroy() {
      destroyed = true;
      if (drawRequest) global.cancelAnimationFrame(drawRequest);
      if (idleRequest) cancelIdle(idleRequest);
      queue.length = 0;
      queued.clear();
      loading.clear();
      loaded.clear();
    }

    function getState() {
      return {
        targetFrame: targetFrame,
        drawnFrame: drawnFrame,
        activeLoads: loading.size,
        cacheSize: loaded.size,
        failedCount: failed.size,
        queueSize: queue.length,
        cacheLimit: cacheLimit,
        navigationStep: navigationStep
      };
    }

    resize();
    enqueue(0, true);
    canvas.setAttribute('data-target-frame', '0');
    idleRequest = requestIdle(warmNavigationFrames);

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
