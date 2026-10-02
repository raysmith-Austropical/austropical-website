/* Austropical site script: nav toggle, marquee pause, poster-first videos (play on tap or in view), the 360 viewer (drag to turn, pinch or double-tap to zoom), flavor gallery, studio picker, flavor filter count. No cookies, no tracking. */
(function () {
  'use strict';

  // Mobile navigation
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Marquee: a pause / play button for the scrolling strip (it does not move at all under prefers-reduced-motion).
  Array.prototype.forEach.call(document.querySelectorAll('.marquee'), function (m) {
    var b = m.querySelector('.marquee-toggle');
    var label = b ? b.querySelector('.visually-hidden') : null;
    if (!b) { return; }
    b.addEventListener('click', function () {
      var paused = m.classList.toggle('is-paused');
      b.setAttribute('aria-pressed', paused ? 'true' : 'false');
      if (label) { label.textContent = paused ? 'Play the scrolling strip' : 'Pause the scrolling strip'; }
    });
  });

  // Videos: the poster image is in the page; the video plays only on tap, or when in view and motion is allowed.
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var boxes = document.querySelectorAll('.v360');

  function play(box) {
    var v = box.querySelector('video');
    if (!v) { return; }
    var p = v.play();
    if (p && p.then) {
      p.then(function () { box.classList.add('playing'); setPressed(box, true); })
       .catch(function () { /* autoplay blocked: the poster stays, the button still works */ });
    } else {
      box.classList.add('playing'); setPressed(box, true);
    }
  }
  function pause(box) {
    var v = box.querySelector('video');
    if (v && !v.paused) { v.pause(); }
    box.classList.remove('playing'); setPressed(box, false);
  }
  function setPressed(box, on) {
    var b = box.querySelector('.v360-btn');
    if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  }

  Array.prototype.forEach.call(boxes, function (box) {
    var v = box.querySelector('video');
    var btn = box.querySelector('.v360-btn');
    if (!v) { return; }
    box.userPaused = false;
    if (btn) {
      btn.addEventListener('click', function () {
        if (v.paused) { box.userPaused = false; play(box); } else { box.userPaused = true; pause(box); }
      });
    }
    v.addEventListener('playing', function () { box.classList.add('playing'); setPressed(box, true); });
    // Hero sequence: when a video with data-next ends, swap to the next file and keep going.
    v.addEventListener('ended', function () {
      var next = v.getAttribute('data-next');
      if (next) {
        var cur = v.getAttribute('src');
        v.setAttribute('data-next', cur);
        v.setAttribute('src', next);
        v.load();
        play(box);
      }
    });
    if (!reduce && box.getAttribute('data-auto') === 'yes' && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { if (!box.userPaused) { play(box); } }
          else if (!v.paused) { v.pause(); box.classList.remove('playing'); setPressed(box, false); }
        });
      }, { threshold: 0.45 });
      io.observe(box);
    }
  });

  // 360 viewer. The poster is frame 0 of the pack; the 48-frame sprite loads when the viewer is in view (or on the
  // first touch) and the pack turns on its own until someone drags it, swipes it or uses a key or button.
  // Zoom: pinch, double-tap or double-click, ctrl + wheel (the wheel alone once zoomed), the + and - buttons or keys.
  // Zoomed in, a drag pans, and the turn buttons and arrow keys still turn the pack. Whenever the pack is at rest after
  // someone has touched it, a sharp 1136 px frame of the same angle replaces the sprite frame once it has loaded.
  var ZMAX = 3, ZTAP = 2.5, TURN = 2;
  var spins = [];
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function makeSpin(wrap) {
    var el = wrap.querySelector('.spin');
    var layer = el.querySelector('.spin-layer');
    var pic = layer.querySelector('picture');
    var frames = parseInt(el.getAttribute('data-frames'), 10) || 48;
    var cols = parseInt(el.getAttribute('data-cols'), 10) || 8;
    var rows = parseInt(el.getAttribute('data-rows'), 10) || 6;
    var url = el.getAttribute('data-spin');
    var zpat = el.getAttribute('data-zoom') || '';
    var zin = wrap.querySelector('.spin-zin'), zout = wrap.querySelector('.spin-zout');
    var st = { frame: 0, loaded: false, loading: false, touched: false, running: false, visible: false, holding: false, pending: [] };
    var gen = 0, z = 1, tx = 0, ty = 0, raf = 0, anim = 0, settleTimer = 0;
    var hiEl = null, hiFrame = -1, cache = {}, order = [];
    var ptrs = {}, gest = null, tap = null, lastTap = null;

    function W() { return el.clientWidth || 320; }
    function H() { return el.clientHeight || W(); }
    function count() { return Object.keys(ptrs).length; }
    function resting() { return !st.running && !st.holding && count() === 0; }

    // ---- frames
    function paintFrame() {
      if (!st.loaded) { return; }
      var c = st.frame % cols, r = Math.floor(st.frame / cols);
      layer.style.backgroundPosition = (c * 100 / (cols - 1)) + '% ' + (r * 100 / (rows - 1)) + '%';
    }
    function label() {
      var t = st.frame === 0 ? 'Front of the pack' : Math.round(st.frame * 360 / frames) + ' degrees';
      if (z > 1.01) { t += ', zoomed in ' + (Math.round(z * 10) / 10) + ' times'; }
      el.setAttribute('aria-valuenow', String(st.frame));
      el.setAttribute('aria-valuetext', t);
    }
    function show(i) {
      st.frame = ((i % frames) + frames) % frames;
      paintFrame();
      label();
      if (hiFrame !== st.frame) { hideHi(); }
      if (resting()) { wantHi(); }
    }
    function load(cb) {
      if (st.loaded) { if (cb) { cb(); } return; }
      if (cb) { st.pending.push(cb); }
      if (st.loading) { return; }
      st.loading = true;
      var g = gen, im = new Image();
      im.onload = function () {
        if (g !== gen) { return; }
        st.loaded = true;
        layer.style.backgroundImage = 'url("' + url + '")';
        layer.style.backgroundSize = (cols * 100) + '% ' + (rows * 100) + '%';
        paintFrame();
        el.classList.add('is-sprite');
        var list = st.pending; st.pending = [];
        list.forEach(function (f) { f(); });
      };
      im.onerror = function () { if (g === gen) { st.loading = false; } };
      im.src = url;
    }

    // ---- sharp frames (a small cache, newest kept)
    function hiUrl(i) { return zpat.replace('{n}', (i < 10 ? '0' : '') + i); }
    function getHi(i) {
      var im = cache[i];
      if (!im) {
        im = new Image();
        im.className = 'spin-hi';
        im.alt = '';
        im.setAttribute('aria-hidden', 'true');
        im.draggable = false;
        im.decoding = 'async';
        im.src = hiUrl(i);
        cache[i] = im; order.push(i);
        if (order.length > 10) {
          var old = order.shift();
          if (cache[old] === hiEl) { order.push(old); } else { delete cache[old]; }
        }
      }
      return im;
    }
    function hideHi() { if (hiEl) { hiEl.classList.remove('on'); } hiFrame = -1; }
    function putHi(i, im) {
      if (hiEl !== im) {
        if (hiEl && hiEl.parentNode) { hiEl.parentNode.removeChild(hiEl); }
        layer.appendChild(im); hiEl = im;
      }
      hiFrame = i;
      im.classList.add('on');
    }
    function wantHi() {
      if (!zpat || !st.touched) { return; }
      var i = st.frame, g = gen, im = getHi(i);
      if (im.complete && im.naturalWidth) { putHi(i, im); }
      else {
        im.addEventListener('load', function () { if (g === gen && st.frame === i && resting()) { putHi(i, im); } });
      }
      if (z > 1.01) { getHi((i + TURN) % frames); getHi((i - TURN + frames) % frames); }
    }
    function settleSoon() {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(function () { if (resting()) { wantHi(); } }, 120);
    }

    // ---- zoom and pan: the layer is sized and placed in pixels (not scaled with a transform) so it stays sharp
    function clampPan() {
      var w = W(), h = H();
      tx = clamp(tx, w - z * w, 0); ty = clamp(ty, h - z * h, 0);
    }
    function apply() {
      raf = 0;
      var zoomed = z > 1;
      layer.style.left = zoomed ? tx + 'px' : '';
      layer.style.top = zoomed ? ty + 'px' : '';
      layer.style.width = layer.style.height = zoomed ? (z * 100) + '%' : '';
      wrap.classList.toggle('is-zoomed', zoomed);
      el.style.touchAction = zoomed ? 'none' : '';
      if (zin) { zin.setAttribute('aria-disabled', z >= ZMAX - 0.001 ? 'true' : 'false'); }
      if (zout) { zout.setAttribute('aria-disabled', zoomed ? 'false' : 'true'); }
    }
    function schedule() { if (!raf) { raf = window.requestAnimationFrame(apply); } }
    function zoomTo(nz, fx, fy) {
      nz = clamp(nz, 1, ZMAX);
      if (fx === undefined) { fx = W() / 2; fy = H() / 2; }
      var px = (fx - tx) / z, py = (fy - ty) / z;
      z = nz; tx = fx - z * px; ty = fy - z * py;
      if (z < 1.01) { z = 1; tx = 0; ty = 0; }
      clampPan(); schedule(); label();
    }
    function stopAnim() { if (anim) { window.cancelAnimationFrame(anim); anim = 0; } }
    function animateTo(nz, fx, fy) {
      stopAnim();
      nz = clamp(nz, 1, ZMAX);
      if (fx === undefined) { fx = W() / 2; fy = H() / 2; }
      var w = W(), h = H(), z0 = z, x0 = tx, y0 = ty;
      var px = (fx - tx) / z, py = (fy - ty) / z;
      var z1 = nz, x1 = fx - z1 * px, y1 = fy - z1 * py;
      if (z1 < 1.01) { z1 = 1; x1 = 0; y1 = 0; }
      x1 = clamp(x1, w - z1 * w, 0); y1 = clamp(y1, h - z1 * h, 0);
      function done() { z = z1; tx = x1; ty = y1; apply(); label(); settleSoon(); }
      if (reduce) { done(); return; }
      var t0 = 0;
      function step(t) {
        if (!t0) { t0 = t; }
        var k = Math.min(1, (t - t0) / 240), e = 1 - Math.pow(1 - k, 3);
        z = z0 + (z1 - z0) * e; tx = x0 + (x1 - x0) * e; ty = y0 + (y1 - y0) * e;
        apply();
        if (k < 1) { anim = window.requestAnimationFrame(step); } else { anim = 0; done(); }
      }
      anim = window.requestAnimationFrame(step);
    }

    // ---- turning on its own
    var last = 0;
    function tick(t) {
      if (!st.running) { return; }
      if (t - last > 75) { last = t; show(st.frame + 1); }
      window.requestAnimationFrame(tick);
    }
    function start() {
      if (reduce || st.touched || st.running || wrap.closest('[hidden]')) { return; }
      load(function () {
        if (st.touched || st.running || !st.visible) { return; }
        st.running = true; last = 0; window.requestAnimationFrame(tick);
      });
    }
    function stop() { st.running = false; }
    function engage() { st.touched = true; stop(); wrap.classList.add('touched'); load(); }

    // ---- pointers: one finger turns (or pans when zoomed), two fingers pinch, a double tap zooms
    function local(e) {
      var r = el.getBoundingClientRect();
      return { x: e.clientX - r.left - el.clientLeft, y: e.clientY - r.top - el.clientTop };
    }
    function begin() {
      var ids = Object.keys(ptrs);
      if (ids.length >= 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        gest = { mode: 'pinch', a: ids[0], b: ids[1], d: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z: z,
                 px: (mx - tx) / z, py: (my - ty) / z };
      } else if (ids.length === 1) {
        var p = ptrs[ids[0]];
        gest = z > 1 ? { mode: 'pan', id: ids[0], x: p.x, y: p.y, tx: tx, ty: ty } : { mode: 'turn', id: ids[0], x: p.x, f: st.frame };
      } else {
        gest = null;
      }
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) { return; }
      stopAnim(); engage();
      var id = String(e.pointerId), p = local(e);
      ptrs[id] = p;
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
      tap = count() === 1 ? { x: p.x, y: p.y, t: Date.now(), moved: false } : null;
      begin();
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', function (e) {
      var id = String(e.pointerId);
      if (!ptrs[id]) { return; }
      var p = local(e);
      ptrs[id] = p;
      if (tap && (Math.abs(p.x - tap.x) > 8 || Math.abs(p.y - tap.y) > 8)) { tap.moved = true; }
      if (!gest) { return; }
      if (gest.mode === 'turn' && id === gest.id) {
        show(gest.f + Math.round((p.x - gest.x) / W() * frames));
      } else if (gest.mode === 'pan' && id === gest.id) {
        tx = gest.tx + (p.x - gest.x); ty = gest.ty + (p.y - gest.y); clampPan(); schedule();
      } else if (gest.mode === 'pinch') {
        var a = ptrs[gest.a], b = ptrs[gest.b];
        if (!a || !b) { return; }
        z = clamp(gest.z * Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)) / gest.d, 1, ZMAX);
        tx = (a.x + b.x) / 2 - z * gest.px; ty = (a.y + b.y) / 2 - z * gest.py;
        if (z < 1.01) { z = 1; }
        clampPan(); schedule(); label();
      }
    });
    function lift(e) {
      var id = String(e.pointerId);
      if (!ptrs[id]) { return; }
      delete ptrs[id];
      if (count() > 0) { begin(); return; }   // pinch to one finger: carry on from where that finger is
      el.classList.remove('dragging');
      gest = null;
      var now = Date.now();
      if (e.type === 'pointerup' && tap && !tap.moved && now - tap.t < 350) {
        if (lastTap && now - lastTap.t < 330 && Math.abs(tap.x - lastTap.x) < 32 && Math.abs(tap.y - lastTap.y) < 32) {
          lastTap = null;
          if (z > 1) { animateTo(1); } else { animateTo(ZTAP, tap.x, tap.y); }
        } else {
          lastTap = { x: tap.x, y: tap.y, t: now };
        }
      }
      tap = null;
      if (z > 1 && z < 1.05) { animateTo(1); }
      if (resting()) { wantHi(); }
    }
    el.addEventListener('pointerup', lift);
    el.addEventListener('pointercancel', lift);
    el.addEventListener('lostpointercapture', lift);
    // Keep the page itself from scrolling or zooming under a two-finger gesture (and under any drag once zoomed).
    el.addEventListener('touchmove', function (e) { if (e.touches.length > 1 || z > 1) { e.preventDefault(); } }, { passive: false });
    el.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    el.addEventListener('wheel', function (e) {
      if (!e.ctrlKey && z <= 1) { return; }   // a plain wheel over an unzoomed pack scrolls the page
      e.preventDefault();
      stopAnim(); engage();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 400 : 1));
      var p = local(e);
      zoomTo(z * clamp(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0025)), 0.5, 2), p.x, p.y);
      settleSoon();
    }, { passive: false });

    // ---- keys: arrows turn, + and - zoom, 0 or Escape zooms out, Shift + arrows pan when zoomed
    el.addEventListener('keydown', function (e) {
      var k = e.key, step = 0;
      if (e.shiftKey && z > 1 && /^Arrow/.test(k)) {
        var d = W() * 0.12;
        if (k === 'ArrowLeft') { tx += d; } else if (k === 'ArrowRight') { tx -= d; } else if (k === 'ArrowUp') { ty += d; } else { ty -= d; }
        clampPan(); schedule(); e.preventDefault(); return;
      }
      if (k === '+' || k === '=') { engage(); animateTo(z + 1); e.preventDefault(); return; }
      if (k === '-' || k === '_') { animateTo(z - 1); e.preventDefault(); return; }
      if (k === '0' || (k === 'Escape' && z > 1)) { animateTo(1); e.preventDefault(); return; }
      if (k === 'ArrowRight' || k === 'ArrowUp') { step = 1; }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { step = -1; }
      else if (k === 'PageUp') { step = frames / 8; }
      else if (k === 'PageDown') { step = -frames / 8; }
      else if (k === 'Home') { engage(); show(0); e.preventDefault(); return; }
      else if (k === 'End') { engage(); show(frames / 2); e.preventDefault(); return; }
      if (step) { engage(); show(st.frame + step); e.preventDefault(); }
    });

    // ---- buttons
    function onPress(b, fn) {
      if (!b) { return; }
      b.addEventListener('click', function () { if (b.getAttribute('aria-disabled') !== 'true') { fn(); } });
    }
    onPress(zin, function () { engage(); animateTo(z + 1); });
    onPress(zout, function () { animateTo(z - 1); });
    function turnButton(b, dir) {
      if (!b) { return; }
      var wait = 0, rep = 0, held = false;
      function end() {
        window.clearTimeout(wait); window.clearInterval(rep); wait = rep = 0;
        if (st.holding) { st.holding = false; settleSoon(); }
      }
      b.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) { return; }
        end(); held = false;
        wait = window.setTimeout(function () {
          held = true; engage(); st.holding = true;
          rep = window.setInterval(function () { show(st.frame + dir); }, 70);
        }, 380);
      });
      b.addEventListener('pointerup', end);
      b.addEventListener('pointerleave', end);
      b.addEventListener('pointercancel', end);
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () {
        if (held) { held = false; return; }
        engage(); show(st.frame + dir * TURN);
      });
    }
    turnButton(wrap.querySelector('.spin-prev'), -1);
    turnButton(wrap.querySelector('.spin-next'), 1);
    window.addEventListener('resize', function () { if (z > 1) { clampPan(); schedule(); } });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          st.visible = en.isIntersecting;
          if (en.isIntersecting) { start(); } else { stop(); }
        });
      }, { threshold: 0.5 }).observe(el);
    }

    // The studio swaps the pack in place.
    function setSource(o) {
      gen++; stop(); stopAnim();
      url = o.sprite; zpat = o.zoom || '';
      st.loaded = false; st.loading = false; st.pending = []; st.frame = 0; st.touched = false;
      z = 1; tx = 0; ty = 0; apply();
      layer.style.backgroundImage = ''; layer.style.backgroundPosition = ''; layer.style.backgroundSize = '';
      el.classList.remove('is-sprite');
      wrap.classList.remove('touched');
      if (hiEl && hiEl.parentNode) { hiEl.parentNode.removeChild(hiEl); }
      hiEl = null; hiFrame = -1; cache = {}; order = [];
      var src = pic.querySelector('source'), img = pic.querySelector('img');
      if (src) { src.setAttribute('srcset', o.posterWebp + ' ' + o.posterW + 'w'); }
      if (img) { img.setAttribute('src', o.posterJpg); img.setAttribute('alt', o.alt); }
      el.setAttribute('aria-label', 'Turn the ' + o.name + ' pint');
      label();
      if (st.visible) { start(); }
    }

    apply();
    wrap.classList.add('is-ready');
    return { el: el, wrap: wrap, start: start, stop: stop, setSource: setSource };
  }
  Array.prototype.forEach.call(document.querySelectorAll('.spin-wrap'), function (w) {
    if (w.querySelector('.spin[data-spin]')) { spins.push(makeSpin(w)); }
  });
  function spinFor(wrap) {
    var found = null;
    spins.forEach(function (s) { if (s.wrap === wrap) { found = s; } });
    return found;
  }

  // Flavor gallery: thumbs swap the main view between the 360 viewer and the pack renders.
  var gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    var spinBox = gallery.querySelector('.gallery-spin');
    var spinCtl = spinFor(spinBox);
    var imageBox = gallery.querySelector('.gallery-image');
    var source = imageBox ? imageBox.querySelector('source') : null;
    var img = imageBox ? imageBox.querySelector('img') : null;
    var thumbs = gallery.querySelectorAll('.thumb');
    Array.prototype.forEach.call(thumbs, function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(thumbs, function (o) { o.classList.remove('is-active'); o.setAttribute('aria-pressed', 'false'); });
        t.classList.add('is-active'); t.setAttribute('aria-pressed', 'true');
        if (t.hasAttribute('data-spin-thumb')) {
          if (imageBox) { imageBox.hidden = true; }
          if (spinBox) { spinBox.hidden = false; if (spinCtl) { spinCtl.start(); } }
        } else {
          if (spinCtl) { spinCtl.stop(); }
          if (spinBox) { spinBox.hidden = true; }
          if (source) { source.setAttribute('srcset', t.getAttribute('data-webp')); }
          if (img) { img.setAttribute('src', t.getAttribute('data-jpg')); img.setAttribute('alt', t.getAttribute('data-alt')); }
          if (imageBox) { imageBox.hidden = false; }
        }
      });
    });
  }

  // Studio: one big viewer and a flavor picker. Picking a flavor swaps the pack, the caption and the link.
  Array.prototype.forEach.call(document.querySelectorAll('[data-studio]'), function (studio) {
    var wrap = studio.querySelector('.spin-wrap'), ctl = spinFor(wrap);
    var picks = studio.querySelectorAll('.pick');
    var nameEl = studio.querySelector('.studio-name'), lineEl = studio.querySelector('.studio-line');
    var zsEl = studio.querySelector('.studio-zs'), link = studio.querySelector('.studio-link');
    var linkName = link ? link.querySelector('.studio-link-name') : null;
    Array.prototype.forEach.call(picks, function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('aria-pressed') === 'true') { return; }
        Array.prototype.forEach.call(picks, function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        function d(k) { return b.getAttribute('data-' + k) || ''; }
        if (ctl) {
          ctl.setSource({ sprite: d('sprite'), zoom: d('zoom'), posterWebp: d('poster-webp'), posterJpg: d('poster-jpg'),
                          posterW: d('poster-w'), alt: d('alt'), name: d('name') });
        }
        if (nameEl) { nameEl.textContent = d('name'); }
        if (lineEl) { lineEl.textContent = d('line'); }
        if (zsEl) { zsEl.textContent = d('zs'); zsEl.hidden = !d('zs'); }
        if (link) { link.setAttribute('href', d('url')); }
        if (linkName) { linkName.textContent = d('short'); }
        var r = wrap.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
        if (r.top < 0 || r.bottom > vh) {
          try { wrap.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); } catch (err) { wrap.scrollIntoView(false); }
        }
      });
    });
  });

  // Flavor filter: the radios and CSS :has() do the filtering; this only announces the count.
  Array.prototype.forEach.call(document.querySelectorAll('.flavor-filter-wrap'), function (w) {
    var out = w.querySelector('.ff-count');
    Array.prototype.forEach.call(w.querySelectorAll('.ff-radio'), function (r) {
      r.addEventListener('change', function () {
        var shown = Array.prototype.filter.call(w.querySelectorAll('.card-flavor'), function (c) { return c.offsetParent !== null; }).length;
        if (out) { out.textContent = r.value === 'all' ? 'Showing all ten flavors.' : 'Showing ' + shown + ' of 10 flavors.'; }
      });
    });
  });
})();

// v4: reveal-on-scroll for [data-reveal]. Opacity and transform only; without JS (no html.js) nothing is hidden.
(function () {
  var els = document.querySelectorAll('[data-reveal]');
  if (!els.length) { return; }
  var show = function (e) { e.classList.add('is-in'); };
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    Array.prototype.forEach.call(els, show);
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { show(en.target); io.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  Array.prototype.forEach.call(els, function (e, i) {
    e.style.transitionDelay = (i % 5) * 70 + 'ms';
    io.observe(e);
  });
})();

// v5: forms. Posts to AUS_FORM_ENDPOINT when one is set (a Formspree-style endpoint that
// takes multipart POST and answers JSON). Until then, composes the message as an email in
// the visitor's mail app, so nothing is lost. No cookies, no tracking.
(function () {
  'use strict';
  var AUS_FORM_ENDPOINT = '';
  var forms = document.querySelectorAll('form[data-aus-form]');
  if (!forms.length) return;
  function labelFor(form, name) {
    var el = form.querySelector('[name="' + name + '"]');
    if (!el) return name;
    var id = el.id;
    var lab = id ? form.querySelector('label[for="' + id + '"]') : null;
    if (!lab && (el.type === 'checkbox' || el.type === 'radio')) { var g = el.closest('.field'); lab = g ? g.querySelector('.label') : null; }
    if (!lab) lab = el.closest('label');
    var t = lab ? lab.textContent : name;
    return t.replace(/\s*\(optional\)\s*/i, '').replace(/\s+/g, ' ').trim().replace(/:$/, '');
  }
  function lines(form) {
    var data = new FormData(form), seen = {}, out = [];
    data.forEach(function (v, k) {
      if (k.charAt(0) === '_' || !String(v).trim()) return;
      if (seen[k]) { seen[k].push(v); return; }
      seen[k] = [v]; out.push(k);
    });
    return out.map(function (k) { return labelFor(form, k) + ': ' + seen[k].join(', '); });
  }
  Array.prototype.forEach.call(forms, function (form) {
    var status = form.querySelector('.form-status');
    var to = form.getAttribute('data-to') || 'info@austropical.co';
    var subject = form.getAttribute('data-subject') || 'Message from austropical.co';
    var button = form.querySelector('button[type="submit"]');
    function say(msg, cls) { if (status) { status.textContent = msg; status.className = 'form-status ' + (cls || ''); } }
    function byMail() {
      var body = lines(form).join('\n') + '\n';
      var href = 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      form.setAttribute('data-last-mailto', href);
      window.location.href = href;
      say('Your email app should open with this message filled in. If it does not, email ' + to + '.', 'ok');
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var hp = form.querySelector('[name="_gotcha"]');
      if (hp && hp.value) return;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (!AUS_FORM_ENDPOINT) { byMail(); return; }
      if (button) button.disabled = true;
      say('Sending…');
      var data = new FormData(form);
      data.append('_subject', subject);
      fetch(AUS_FORM_ENDPOINT, { method: 'POST', body: data, headers: { 'Accept': 'application/json' } })
        .then(function (r) {
          if (r.ok) { form.reset(); say('Thank you. We have it, and we will reply by email.', 'ok'); }
          else { say('That did not go through, so we are opening it as an email instead.', 'err'); byMail(); }
        })
        .catch(function () { say('That did not go through, so we are opening it as an email instead.', 'err'); byMail(); })
        .then(function () { if (button) button.disabled = false; });
    });
  });
})();

// v6a: Work with us hub. Opens the panel for the chosen path, remembers it in the URL hash,
// and leaves every panel visible when scripting is off.
(function () {
  'use strict';
  var paths = document.querySelectorAll('.hub-path[data-path]');
  if (!paths.length) return;
  var panels = document.querySelectorAll('.hub-panel');
  function open(id, scroll) {
    var found = false;
    Array.prototype.forEach.call(panels, function (p) { var on = p.id === id; p.classList.toggle('is-open', on); if (on) found = true; });
    Array.prototype.forEach.call(paths, function (a) { if (a.getAttribute('data-path') === id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    if (found && scroll) { var p = document.getElementById(id); if (p) { p.scrollIntoView({ behavior: 'smooth', block: 'start' }); var h = p.querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } } }
    return found;
  }
  Array.prototype.forEach.call(paths, function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('data-path');
      if (open(id, true)) { e.preventDefault(); if (history.replaceState) history.replaceState(null, '', '#' + id); }
    });
  });
  var h = (location.hash || '').replace('#', '');
  if (h) open(h, false);
  window.addEventListener('hashchange', function () { var id = (location.hash || '').replace('#', ''); if (id) open(id, true); });
})();

// v13: the turn section shows the real pack in 3D (the model "Up close" uses), turning slowly on its own and drawn at the
// screen's own resolution. Drag to turn it (the page still scrolls); the button pauses it. Without WebGL, with Save-Data or
// reduced data: the sharp still. Reduced motion: the model holds still, front on. (Replaces the v7 sprite turn.)
(function () {
  'use strict';
  var sec = document.querySelector('.turn[data-turn]');
  if (!sec) return;
  var box = sec.querySelector('.turn-pint'), btn = sec.querySelector('.turn-ctl');
  var glb = box && box.getAttribute('data-3d');
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var reduceMotion = mm('(prefers-reduced-motion: reduce)');
  var reduceData = mm('(prefers-reduced-data: reduce)') || !!(navigator.connection && navigator.connection.saveData);
  function hasWebGL() { try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  function still() { if (btn) btn.hidden = true; sec.setAttribute('data-turn-mode', 'still'); }
  if (!glb || reduceData || !('customElements' in window) || !('IntersectionObserver' in window) || !('Promise' in window) || !hasWebGL()) { still(); return; }
  if (reduceMotion && btn) btn.hidden = true;
  sec.setAttribute('data-turn-mode', reduceMotion ? 'still3d' : 'auto');
  var LIB = 'assets/js/model-viewer.4.3.1.min.js', mv = null, paused = false;
  function lib() {
    if (window.customElements.get('model-viewer')) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.querySelector('script[src="' + LIB + '"]');
      if (!s) { s = document.createElement('script'); s.type = 'module'; s.src = LIB; document.head.appendChild(s); }
      s.addEventListener('error', reject);
      window.customElements.whenDefined('model-viewer').then(resolve, reject);
    });
  }
  function mount() {
    mv = document.createElement('model-viewer');
    var a = {
      src: glb, alt: 'Austropical Organic Açaí Original Sensation sorbet pint in 3D, turning slowly on a deep purple background. Drag to turn it.',
      'camera-controls': '', 'disable-zoom': '', 'disable-pan': '', 'touch-action': 'pan-y', 'interaction-prompt': 'none',
      'camera-orbit': '-18deg 76deg 105%', 'min-camera-orbit': 'auto 62deg 105%', 'max-camera-orbit': 'auto 96deg 105%', 'field-of-view': '25deg',
      exposure: '1', 'tone-mapping': 'neutral', 'environment-image': 'neutral', 'shadow-intensity': '1.1', 'shadow-softness': '0.7',
      'interpolation-decay': '160', loading: 'eager', reveal: 'auto'
    };
    var poster = box.getAttribute('data-3d-poster');
    if (poster) a.poster = poster;
    if (!reduceMotion) { a['auto-rotate'] = ''; a['auto-rotate-delay'] = '0'; a['rotation-per-second'] = '30deg'; }
    Object.keys(a).forEach(function (k) { mv.setAttribute(k, a[k]); });
    mv.addEventListener('error', function () { if (mv && mv.parentNode) mv.parentNode.removeChild(mv); mv = null; still(); });
    mv.addEventListener('load', function () { sec.classList.add('is-3d'); });
    box.insertBefore(mv, btn || null);
  }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); lib().then(mount, still); } });
  }, { rootMargin: '400px 0px' });
  io.observe(box);
  if (btn) {
    btn.addEventListener('click', function () {
      paused = !paused;
      btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      if (mv) { if (paused) mv.removeAttribute('auto-rotate'); else mv.setAttribute('auto-rotate', ''); }
    });
  }
})();

// v6c: center the current flavor chip in its row without scrolling the page.
(function () {
  'use strict';
  var row = document.querySelector('.chips'), cur = row && row.querySelector('.chip[aria-current="page"]');
  if (!row || !cur) return;
  var li = cur.parentNode;
  row.scrollLeft = Math.max(0, li.offsetLeft - (row.clientWidth - li.offsetWidth) / 2);
})();

// v9: the bowl builder on Serving ideas. The picture is a stack of images: the sorbet photo for the chosen base,
// and one transparent layer per topping. Toggling a topping fades its layer; choosing a base cross-fades the photo
// once the new one has loaded. The caption and the picture's accessible name follow. No state kept anywhere.
(function () {
  'use strict';
  var b = document.querySelector('.si-build');
  if (!b) return;
  var stack = b.querySelector('.bb-stack'), bases = stack.querySelectorAll('.bb-base'), tops = stack.querySelectorAll('.bb-top'),
      name = b.querySelector('.bb-name'), topsText = b.querySelector('.bb-tops'), link = b.querySelector('.bb-link');
  if (bases.length < 2 || !tops.length) return;
  var SIZES = bases[0].getAttribute('sizes'), cur = 0, pending = null;
  function src(key, w) { return 'assets/img/bowl/base-' + key + '-' + w + '.webp'; }
  function setBase(key) {
    if (bases[cur].getAttribute('data-key') === key) { pending = null; return; }
    var next = bases[1 - cur], from = bases[cur];
    pending = key;
    if (next.getAttribute('data-key') !== key) {
      next.setAttribute('data-key', key);
      next.setAttribute('sizes', SIZES);
      next.setAttribute('srcset', src(key, 570) + ' 570w, ' + src(key, 1140) + ' 1140w');
      next.setAttribute('src', src(key, 570));
    }
    var show = function () {
      if (pending !== key) return;
      next.classList.add('is-on'); from.classList.remove('is-on'); cur = 1 - cur; pending = null;
    };
    if (next.complete && next.naturalWidth) show();
    else { next.onload = show; next.onerror = function () { pending = null; }; }
  }
  function list(items) { return items.join(', ').replace(/, ([^,]*)$/, ' and $1'); }
  function paint() {
    var r = b.querySelector('input[name="base"]:checked');
    if (!r) return;
    var chip = r.nextElementSibling, flavour = r.getAttribute('data-name');
    setBase(r.getAttribute('data-base'));
    var on = [];
    Array.prototype.forEach.call(b.querySelectorAll('input[name="top"]'), function (c) {
      Array.prototype.forEach.call(tops, function (t) { if (t.getAttribute('data-top') === c.value) t.classList.toggle('is-on', c.checked); });
      if (c.checked) on.push(c.value);
    });
    name.textContent = flavour;
    topsText.textContent = on.length ? 'A 2/3 cup scoop, with ' + list(on) + '.' : 'A 2/3 cup scoop, nothing on top.';
    link.setAttribute('href', r.getAttribute('data-url'));
    stack.setAttribute('aria-label', (on.length ? flavour + ' sorbet in a bowl, seen from above, with ' + list(on) + '.' : flavour + ' sorbet in a bowl, seen from above, nothing on top.') + ' Serving suggestion.');
    if (chip && chip.style) b.style.setProperty('--bbg', chip.style.getPropertyValue('--cbg'));
  }
  b.addEventListener('change', paint);
  // warm the cache for a base the pointer is over, so the cross-fade is instant on the click
  var warmed = {};
  b.addEventListener('pointerover', function (e) {
    var chip = e.target.closest ? e.target.closest('.si-bases .chip') : null;
    if (!chip) return;
    var r = document.getElementById(chip.getAttribute('for')), key = r && r.getAttribute('data-base');
    if (!key || warmed[key]) return;
    warmed[key] = true;
    var im = new Image(); im.sizes = SIZES; im.srcset = src(key, 570) + ' 570w, ' + src(key, 1140) + ' 1140w'; im.src = src(key, 570);
  });
  paint();
})();

// v13b: the packs in real 3D, the pint and the Grab'n Go cup (replaces the v10 block). With WebGL (and no reduced-data
// preference) the flavor gallery, the home studio and the home Grab'n Go box draw 3D models of the real packs (labels
// rebuilt from the print files) with Google's <model-viewer> (Apache-2.0), loaded when a viewer comes near the screen.
// Drag to spin and tilt. Zoom with a pinch, the + and - buttons, ctrl+wheel, or the wheel once the pack has been clicked
// or dragged: until then the wheel scrolls the page and a short tip says how to zoom. AR where the device supports it.
// Without 3D the pint keeps its 360 viewer and the cup shows its still.
(function () {
  'use strict';
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var reduceData = mm('(prefers-reduced-data: reduce)'), reduceMotion = mm('(prefers-reduced-motion: reduce)');
  function hasWebGL() {
    try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  }
  if (!document.querySelector('[data-3d]') || reduceData || !('customElements' in window) || !('IntersectionObserver' in window) || !('Promise' in window) || !hasWebGL()) { return; }
  document.documentElement.classList.add('has-3d');
  // model-viewer lowers its render resolution when frames run slow; keep every pack at the screen's full resolution
  // (a slower turn on an old phone beats a soft label). Applies to every viewer on the page, the home turn included.
  customElements.whenDefined('model-viewer').then(function (MV) { try { (MV || customElements.get('model-viewer')).minimumRenderScale = 1; } catch (err) {} });
  var ORBIT = '-18deg 76deg 105%', FOV = '25deg';
  var libPromise = null;
  function loadLib(glb) {
    if (!libPromise) {
      libPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.type = 'module';
        s.src = glb.slice(0, glb.indexOf('assets/')) + 'assets/js/model-viewer.4.3.1.min.js';
        s.onload = function () { customElements.whenDefined('model-viewer').then(resolve, reject); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return libPromise;
  }
  function posterUrl(base) { return base ? base + '-1140.webp' : ''; }
  function isCup(glb) { return /(^|\/)cup-[^\/]+\.glb$/.test(glb || ''); }
  function altFor(glb, name, note) {
    return 'Austropical ' + (name || '') + ' sorbet ' + (isCup(glb) ? 'Grab\'n Go cup' : 'pint') + ', in 3D.' + (note ? ' ' + note : '') +
      ' Drag to spin and tilt it; zoom in to read the label.';
  }
  function viewer(glb, poster, alt, extra) {
    var mv = document.createElement('model-viewer');
    var attrs = {
      src: glb, alt: alt,
      'camera-controls': '', 'touch-action': 'pan-y', 'disable-pan': '', 'interaction-prompt': 'none',
      'shadow-intensity': '1.1', 'shadow-softness': '0.7', exposure: '1', 'tone-mapping': 'neutral', 'environment-image': 'neutral',
      'camera-orbit': ORBIT, 'min-camera-orbit': 'auto 30deg 70%', 'max-camera-orbit': 'auto 130deg 160%',
      'field-of-view': FOV, 'min-field-of-view': '10deg', 'max-field-of-view': '30deg', 'interpolation-decay': '160',
      loading: 'eager', reveal: 'auto', ar: '', 'ar-modes': 'webxr scene-viewer', 'ar-scale': 'fixed'
    };
    if (!reduceMotion) { attrs['auto-rotate'] = ''; attrs['auto-rotate-delay'] = '1200'; attrs['rotation-per-second'] = '14deg'; }
    if (poster) { attrs.poster = posterUrl(poster); }
    Object.keys(attrs).forEach(function (k) { mv.setAttribute(k, attrs[k]); });
    var ar = document.createElement('button');
    ar.type = 'button'; ar.className = 'p3-ar'; ar.setAttribute('slot', 'ar-button'); ar.textContent = 'See it on your table';
    mv.appendChild(ar);
    return mv;
  }
  // the furniture every 3D box gets: the hint, the zoom buttons, the wheel gate and its tip, the held/touched states
  function furnish(box, mv) {
    var hint = document.createElement('span');
    hint.className = 'spin-hint p3-hint'; hint.setAttribute('aria-hidden', 'true');
    hint.innerHTML = '<span class="spin-hint-ico"></span><span class="hint-fine">Drag to spin · scroll to zoom</span><span class="hint-coarse">Drag to spin · pinch to zoom</span>';
    box.appendChild(hint);
    var zoom = document.createElement('div');
    zoom.className = 'p3-zoom';
    zoom.innerHTML = '<button type="button" class="p3-zbtn" data-z="1" aria-label="Zoom in"><span aria-hidden="true">+</span></button>' +
      '<button type="button" class="p3-zbtn" data-z="-1" aria-label="Zoom out"><span aria-hidden="true">−</span></button>';
    Array.prototype.forEach.call(zoom.querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        box.classList.add('touched');
        try { mv.zoom(6 * Number(b.getAttribute('data-z'))); } catch (err) {}
      });
    });
    box.appendChild(zoom);
    var tip = document.createElement('span');
    tip.className = 'p3-tip'; tip.setAttribute('aria-hidden', 'true'); tip.textContent = 'Click the pack, then scroll to zoom';
    box.appendChild(tip);
    var held = false, tips = 0, timer = 0;
    mv.addEventListener('pointerdown', function () { held = true; box.classList.remove('show-tip'); box.classList.add('is-held'); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { mv.addEventListener(t, function () { box.classList.remove('is-held'); }); });
    box.addEventListener('pointerleave', function () { held = false; });
    // model-viewer zooms on every wheel event and cancels the page scroll. It listens inside its shadow root, so stopping
    // the event here, on the host, leaves the wheel to the page until the visitor has taken hold of the pack.
    mv.addEventListener('wheel', function (e) {
      if (held || e.ctrlKey) { return; }
      e.stopPropagation();
      if (tips < 2) {
        tips++; box.classList.add('show-tip'); clearTimeout(timer);
        timer = setTimeout(function () { box.classList.remove('show-tip'); }, 1600);
      }
    }, true);
    mv.addEventListener('camera-change', function (e) { if (e.detail && e.detail.source === 'user-interaction') { box.classList.add('touched'); } });
  }
  // watch an element that is always displayed (a hidden one never intersects); glb only tells loadLib the path depth
  function whenNear(el, glb, cb) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { io.disconnect(); loadLib(glb).then(cb, function () {}); }
      });
    }, { rootMargin: '300px 0px' });
    io.observe(el);
  }
  // a 360 sprite viewer (.spin-wrap[data-3d]) becomes a 3D box in front of it; the sprite stays as the fallback
  function mountWrap(wrap, name, note) {
    var glb = wrap.getAttribute('data-3d'), bg = wrap.getAttribute('data-3d-bg'), poster = wrap.getAttribute('data-3d-poster');
    var box = document.createElement('div');
    box.className = 'pack3d';
    if (bg) { box.style.setProperty('--p3bg', bg); }
    var mv = viewer(glb, poster, altFor(glb, name, note));
    box.appendChild(mv);
    furnish(box, mv);
    box.hidden = wrap.hidden;
    wrap.parentNode.insertBefore(box, wrap);
    wrap.hidden = true;
    mv.addEventListener('error', function () { box.hidden = true; wrap.hidden = false; });
    return { box: box, mv: mv, wrap: wrap };
  }
  function swap(inst, glb, bg, poster, name, note) {
    if (!glb || inst.mv.getAttribute('src') === glb) { return; }
    if (bg) { inst.box.style.setProperty('--p3bg', bg); }
    inst.box.classList.remove('touched');
    inst.mv.cameraOrbit = ORBIT; inst.mv.fieldOfView = FOV;
    try { inst.mv.resetTurntableRotation(0); } catch (err) {}
    if (poster) { inst.mv.setAttribute('poster', posterUrl(poster)); }
    inst.mv.setAttribute('alt', altFor(glb, name, note));
    try { inst.mv.showPoster(); } catch (err) {}
    inst.mv.setAttribute('src', glb);
  }
  // The home studio: the picks swap the model (the sprite code keeps the caption, the link and the pressed state).
  Array.prototype.forEach.call(document.querySelectorAll('[data-studio]'), function (studio) {
    var wrap = studio.querySelector('.spin-wrap[data-3d]');
    if (!wrap) { return; }
    var inst = null;
    whenNear(wrap, wrap.getAttribute('data-3d'), function () {
      var on = studio.querySelector('.pick[aria-pressed="true"]');
      inst = mountWrap(wrap, on ? on.getAttribute('data-name') : '', on ? on.getAttribute('data-zs') : '');
    });
    Array.prototype.forEach.call(studio.querySelectorAll('.pick[data-3d]'), function (b) {
      b.addEventListener('click', function () {
        var glb = b.getAttribute('data-3d'), bg = b.getAttribute('data-3d-bg'), poster = b.getAttribute('data-3d-poster');
        if (inst) { swap(inst, glb, bg, poster, b.getAttribute('data-name'), b.getAttribute('data-zs')); }
        else { wrap.setAttribute('data-3d', glb); wrap.setAttribute('data-3d-bg', bg || ''); wrap.setAttribute('data-3d-poster', poster || ''); }
      });
    });
  });
  // The flavor gallery: the Pint and Cup thumbs show the 3D pack (the gallery's own code shows the sprite or the still
  // first; this runs after it and takes over when the 3D box is there); the Bucket thumb shows its picture.
  var gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    var gwrap = gallery.querySelector('.spin-wrap[data-3d]'), imageBox = gallery.querySelector('.gallery-image');
    var gname = gallery.getAttribute('data-name') || '', gnote = gallery.getAttribute('data-note') || '';
    if (gwrap) {
      var ginst = null, active = gallery.querySelector('.thumb.is-active');
      var apply = function () {
        if (!ginst || !active) { return; }
        var glb = active.getAttribute('data-3d');
        if (glb) {
          if (imageBox) { imageBox.hidden = true; }
          gwrap.hidden = true; ginst.box.hidden = false;
          swap(ginst, glb, active.getAttribute('data-3d-bg'), active.getAttribute('data-3d-poster'), gname, gnote);
        } else {
          ginst.box.hidden = true;
        }
      };
      whenNear(gallery.querySelector('.gallery-main') || gallery, gwrap.getAttribute('data-3d'), function () { ginst = mountWrap(gwrap, gname, gnote); apply(); });
      Array.prototype.forEach.call(gallery.querySelectorAll('.thumb'), function (t) {
        t.addEventListener('click', function () {
          active = t;
          var glb = t.getAttribute('data-3d');
          if (!ginst && glb) {   // not drawn yet: mount straight into the chosen pack
            gwrap.setAttribute('data-3d', glb);
            gwrap.setAttribute('data-3d-bg', t.getAttribute('data-3d-bg') || '');
            gwrap.setAttribute('data-3d-poster', t.getAttribute('data-3d-poster') || '');
          }
          apply();
        });
      });
    }
  }
  // The home Grab'n Go box: the cup still, with the 3D cup drawn over it.
  Array.prototype.forEach.call(document.querySelectorAll('.cup3d[data-3d]'), function (box) {
    whenNear(box, box.getAttribute('data-3d'), function () {
      var glb = box.getAttribute('data-3d');
      var mv = viewer(glb, box.getAttribute('data-3d-poster'), altFor(glb, box.getAttribute('data-name'), box.getAttribute('data-note')));
      box.appendChild(mv);
      furnish(box, mv);
      mv.addEventListener('error', function () {
        Array.prototype.forEach.call(box.querySelectorAll('model-viewer, .p3-hint, .p3-zoom, .p3-tip'), function (n) { n.parentNode.removeChild(n); });
      });
    });
  });
})();

// v13b: #cup opens a flavor page on the cup (the home Grab'n Go strip links there, and so does the page's own Grab'n Go
// section). Works with or without 3D: the Cup thumb shows the 3D cup or its still.
(function () {
  'use strict';
  var gallery = document.querySelector('[data-gallery]');
  var cup = gallery && gallery.querySelector('.thumb[data-view="cup"]');
  if (!cup) { return; }
  function pick() { if (!cup.classList.contains('is-active')) { cup.click(); } }
  if (location.hash === '#cup') { pick(); }
  window.addEventListener('hashchange', function () { if (location.hash === '#cup') { pick(); } });
  Array.prototype.forEach.call(document.querySelectorAll('a[href="#cup"]'), function (a) { a.addEventListener('click', pick); });
})();

// v11: the whole line in the hero. The lids under the copy pick a flavor; the hero's field colour, picture and caption
// follow. Left alone, the hero walks the line once (pair, then each flavor, back to the pair), pausing when it is out of
// view, when the tab is hidden, or the moment the visitor touches it. No walk under reduced motion or Save-Data.
(function () {
  var hero = document.querySelector('.page-home .hero-field');
  var line = hero && hero.querySelector('[data-line]');
  var media = hero && hero.querySelector('.hf-media');
  var note = hero && hero.querySelector('[data-caption]');
  if (!hero || !line || !media || !note || !('Promise' in window)) { return; }
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var reduceMotion = mm('(prefers-reduced-motion: reduce)');
  var saveData = mm('(prefers-reduced-data: reduce)') || !!(navigator.connection && navigator.connection.saveData);
  var ITEMS = [{"k": "original-sensation", "name": "Organic Açaí Original Sensation", "short": "Original Sensation", "fbg": "#D69B49", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#D69B49", "desc": "deep, dark açaí: 60% of the recipe.", "tail": "", "when": "First in March 2027", "href": "flavors/original-sensation.html", "alt": "Austropical Organic Açaí Original Sensation sorbet pint floating on a mustard background, its shadow cast on the wall behind it."}, {"k": "mango", "name": "Organic Mango", "short": "Mango", "fbg": "#69B0BF", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#69B0BF", "desc": "ripe, golden mango: 60% of the recipe.", "tail": "", "when": "First in March 2027", "href": "flavors/mango.html", "alt": "Austropical Organic Mango sorbet pint floating on a turquoise background, its shadow cast on the wall behind it."}, {"k": "banana-sunrise", "name": "Açaí Banana Sunrise", "short": "Banana Sunrise", "fbg": "#DDBB80", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#DDBB80", "desc": "açaí, rounded off with banana.", "tail": "", "when": "Follows the first two", "href": "flavors/banana-sunrise.html", "alt": "Austropical Açaí Banana Sunrise sorbet pint floating on a banana yellow background, its shadow cast on the wall behind it."}, {"k": "strawberry-crush", "name": "Açaí Strawberry Crush", "short": "Strawberry Crush", "fbg": "#E86B4A", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#E86B4A", "desc": "açaí with a crush of strawberry.", "tail": "", "when": "Follows the first two", "href": "flavors/strawberry-crush.html", "alt": "Austropical Açaí Strawberry Crush sorbet pint floating on a coral background, its shadow cast on the wall behind it."}, {"k": "zero-sugar", "name": "Açaí Zero Sugar", "short": "Zero Sugar", "fbg": "#9A9AD3", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#9A9AD3", "desc": "60% açaí, zero sugar. Not a low calorie food.", "tail": "", "when": "Follows the first two", "href": "flavors/zero-sugar.html", "alt": "Austropical Açaí Zero Sugar sorbet pint floating on a lilac background, its shadow cast on the wall behind it. Not a low calorie food."}, {"k": "coconut", "name": "Organic Coconut", "short": "Coconut", "fbg": "#3C75BD", "ffg": "#FFFFFF", "hl": "#FFCC04", "btxt": "#31609B", "desc": "cool, snow-white coconut.", "tail": "", "when": "Follows the first two", "href": "flavors/coconut.html", "alt": "Austropical Organic Coconut sorbet pint floating on a cobalt blue background, its shadow cast on the wall behind it."}, {"k": "passionfruit", "name": "Passionfruit", "short": "Passionfruit", "fbg": "#7B6BBA", "ffg": "#FFFFFF", "hl": "#FFDE5C", "btxt": "#655899", "desc": "sharp, bright passion fruit.", "tail": "", "when": "Follows the first two", "href": "flavors/passionfruit.html", "alt": "Austropical Passionfruit sorbet pint floating on a violet background, its shadow cast on the wall behind it."}, {"k": "dragon-fruit-pineapple", "name": "Dragon Fruit & Pineapple", "short": "Dragon Fruit & Pineapple", "fbg": "#53A46C", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#53A46C", "desc": "hot-pink dragon fruit, with pineapple.", "tail": "", "when": "Follows the first two", "href": "flavors/dragon-fruit-pineapple.html", "alt": "Austropical Dragon Fruit & Pineapple sorbet pint floating on a green background, its shadow cast on the wall behind it."}, {"k": "pink-guava-acerola", "name": "Pink Guava & Acerola", "short": "Pink Guava & Acerola", "fbg": "#E1B0AE", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#E1B0AE", "desc": "rosy pink guava, tart acerola.", "tail": "", "when": "Follows the first two", "href": "flavors/pink-guava-acerola.html", "alt": "Austropical Pink Guava & Acerola sorbet pint floating on a guava pink background, its shadow cast on the wall behind it."}, {"k": "cupuacu-coconut", "name": "Cupuaçu & Coconut", "short": "Cupuaçu & Coconut", "fbg": "#854B2B", "ffg": "#FBF1E4", "hl": "#FFCC04", "btxt": "#6D3D23", "desc": "cupuaçu, a relative of cacao from the same forest as açaí, with coconut.", "tail": "", "when": "Follows the first two", "href": "flavors/cupuacu-coconut.html", "alt": "Austropical Cupuaçu & Coconut sorbet pint floating on a cocoa brown background, its shadow cast on the wall behind it."}];

  var base = media.querySelector('picture');
  if (!base) { return; }
  var PAIR = { k: 'pair', short: 'the launch pair', name: 'Original Sensation & Mango', fbg: '#1C7D7E', ffg: '#FFFFFF', hl: '#FFCC04', btxt: '#176667',
    note: '', desc: 'the first two, in US freezers from March 2027.', tail: '', when: '', href: '' };
  var pairPic = base.cloneNode(true);
  var WIDE = [960, 1440, 1920, 2400], MID = [768, 1152, 1536, 1920], TALL = [480, 640, 960, 1280, 1600];
  function srcset(slug, kind, ws, ext) {
    return ws.map(function (w) { return 'assets/img/field/' + slug + '-' + kind + '-' + w + '.' + ext + ' ' + w + 'w'; }).join(', ');
  }
  function pictureFor(it) {
    if (it.k === 'pair') { return pairPic.cloneNode(true); }
    var pic = document.createElement('picture');
    var defs = [['(min-width: 960px)', 'wide', WIDE, '1032px', 2400, 2000], ['(min-width: 640px)', 'mid', MID, '100vw', 2400, 2320], [null, 'tall', TALL, '100vw', 1600, 2160]];
    defs.forEach(function (d) {
      ['avif', 'webp'].forEach(function (ext) {
        var s = document.createElement('source');
        if (d[0]) { s.setAttribute('media', d[0]); }
        s.setAttribute('type', 'image/' + ext); s.setAttribute('srcset', srcset(it.k, d[1], d[2], ext)); s.setAttribute('sizes', d[3]);
        s.setAttribute('width', d[4]); s.setAttribute('height', d[5]);
        pic.appendChild(s);
      });
    });
    var img = document.createElement('img');
    img.src = 'assets/img/field/' + it.k + '-tall-1600.jpg'; img.width = 1600; img.height = 2160; img.alt = it.alt; img.decoding = 'async'; img.className = 'hf-img';
    pic.appendChild(img);
    return pic;
  }
  var lidsEl = line.querySelector('.lids');
  var buttons = Array.prototype.slice.call(line.querySelectorAll('.lid'));
  var ORDER = buttons.map(function (b) { return b.getAttribute('data-key'); });
  var playBtn = line.querySelector('[data-play]');
  var current = 'pair', pending = null, walking = false, stopped = false, held = false, timer = null, inView = false, step = -1;
  var STEP_MS = 6500, FIRST_MS = 3500;
  var autoTour = !reduceMotion && !saveData && mm('(hover: hover) and (pointer: fine)') && 'IntersectionObserver' in window;
  var canTour = !reduceMotion && !saveData;
  buttons.forEach(function (b) { var r = document.createElement('span'); r.className = 'lid-ring'; r.setAttribute('aria-hidden', 'true'); b.appendChild(r); });
  function itemFor(k) { if (k === 'pair') { return PAIR; } for (var i = 0; i < ITEMS.length; i++) { if (ITEMS[i].k === k) { return ITEMS[i]; } } return null; }
  function setVars(it) {
    hero.style.setProperty('--fbg', it.fbg); hero.style.setProperty('--ffg', it.ffg);
    hero.style.setProperty('--hl', it.hl); hero.style.setProperty('--btxt', it.btxt);
  }
  function fillNote(it) {
    note.textContent = '';
    if (it.when) {
      var w = document.createElement('span'); w.className = 'hf-when'; w.textContent = it.when; note.appendChild(w);
      var sep = document.createElement('span'); sep.className = 'visually-hidden'; sep.textContent = '. '; note.appendChild(sep);
      note.appendChild(document.createTextNode(' '));
    }
    var b = document.createElement('strong'); b.textContent = it.name; note.appendChild(b);
    note.appendChild(document.createTextNode(' — ' + it.desc + (it.href ? ' ' : '')));
    if (it.href) { var a = document.createElement('a'); a.href = it.href; a.textContent = 'About ' + it.short + ' →'; note.appendChild(a); }
  }
  function setNote(it) {
    note.setAttribute('aria-live', walking ? 'off' : 'polite');
    if (reduceMotion) { fillNote(it); return; }
    note.classList.add('is-out');
    setTimeout(function () { fillNote(it); note.classList.remove('is-out'); }, 220);
  }
  function setPressed(k) {
    buttons.forEach(function (b) {
      var on = b.getAttribute('data-key') === k;
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
      b.classList.remove('is-timing');
    });
  }
  function ring(k) {
    buttons.forEach(function (b) { b.classList.remove('is-timing'); });
    if (!walking || !k) { return; }
    var b = buttons[ORDER.indexOf(k)]; if (!b) { return; }
    void b.offsetWidth;                                   // restart the CSS animation
    b.style.setProperty('--dur', STEP_MS + 'ms'); b.classList.add('is-timing');
  }
  function ready(pic) {
    var img = pic.querySelector('img');
    if (img.complete && img.naturalWidth) { return img.decode ? img.decode().catch(function () {}) : Promise.resolve(); }
    return new Promise(function (resolve) {
      img.addEventListener('load', function () { (img.decode ? img.decode().catch(function () {}) : Promise.resolve()).then(resolve); }, { once: true });
      img.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 4000);
    });
  }
  function preload(it) {
    if (!it) { return null; }
    if (pending && pending.k === it.k) { return pending.pic; }
    if (pending) { pending.pic.remove(); }
    var pic = pictureFor(it); pic.className = 'hf-layer'; pic.setAttribute('aria-hidden', 'true');
    media.appendChild(pic);
    pending = { k: it.k, pic: pic };
    return pic;
  }
  function show(k) {
    var it = itemFor(k); if (!it || k === current) { return; }
    current = k; setPressed(k); setVars(it); setNote(it);
    var pic = preload(it); pending = null;
    ready(pic).then(function () {
      if (current !== k) { pic.remove(); return; }
      // everything else in the box goes: the picture on show and any layer still fading in from a quicker pick;
      // the picture preloaded for the next step stays
      var others = Array.prototype.filter.call(media.querySelectorAll('picture'), function (p) { return p !== pic && !(pending && p === pending.pic); });
      pic.removeAttribute('aria-hidden');
      if (reduceMotion) {
        pic.className = ''; others.forEach(function (o) { o.remove(); });
      } else {
        requestAnimationFrame(function () {
          pic.classList.add('is-in');
          others.forEach(function (o) { o.classList.remove('is-in'); o.classList.add('is-out'); });
        });
        setTimeout(function () {
          others.forEach(function (o) { o.remove(); });
          if (current === k) { pic.className = ''; }
        }, 660);
      }
    });
  }
  // ---- the tour ----
  function setPlay(state) {
    if (!playBtn) { return; }
    playBtn.setAttribute('data-state', state);
    playBtn.querySelector('.hf-play-txt').textContent = state === 'playing' ? 'Pause' : 'Play';
    playBtn.setAttribute('aria-label', state === 'playing' ? 'Pause the tour of the ten flavors' : 'Play the tour of the ten flavors');
  }
  function clear() { if (timer) { clearTimeout(timer); timer = null; } }
  function stop() { stopped = true; walking = false; clear(); ring(null); setPlay('paused'); note.setAttribute('aria-live', 'polite'); }
  function schedule(ms) {
    clear();
    if (stopped || !inView || document.hidden) { walking = false; ring(null); return; }
    walking = true; setPlay('playing');
    if (held) { if (ms === STEP_MS) { ring(current); } return; }
    timer = setTimeout(tick, ms);
    if (ms === STEP_MS) { ring(current); }
  }
  function tick() {
    timer = null;
    if (stopped || !inView || document.hidden) { walking = false; ring(null); return; }
    var i = ORDER.indexOf(current);
    var next = ORDER[(i + 1) % ORDER.length];
    step += 1;
    show(next);
    preload(itemFor(ORDER[(ORDER.indexOf(next) + 1) % ORDER.length]));
    if (next === 'pair' && step > 0) { stop(); return; }   // one full lap, then rest on the launch pair
    schedule(STEP_MS);
  }
  function play() {
    stopped = false; step = -1;
    if (current === 'pair') { step = 0; }
    inView = true;
    schedule(current === 'pair' ? 900 : STEP_MS);
    if (current === 'pair') { ring(null); }
  }
  // ---- the lids: click, keyboard (one tab stop, arrows move and select) ----
  buttons.forEach(function (b, i) {
    b.tabIndex = i === 0 ? 0 : -1;
    b.addEventListener('click', function () { stop(); show(b.getAttribute('data-key')); });
  });
  lidsEl.addEventListener('keydown', function (e) {
    var i = buttons.indexOf(document.activeElement); if (i < 0) { return; }
    var j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
    if (j === undefined) { return; }
    e.preventDefault(); j = (j + buttons.length) % buttons.length;
    stop(); buttons[j].focus(); show(buttons[j].getAttribute('data-key'));
  });
  lidsEl.addEventListener('focusin', function () { stop(); });
  // hovering the lids pauses the tour (the ring holds); leaving lets it go on
  line.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { held = true; line.classList.add('is-held'); if (walking) { clear(); } } });
  line.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { held = false; line.classList.remove('is-held'); if (walking && !stopped) { schedule(STEP_MS); } } });
  // swipe the picture (touch and pen): next / previous flavor
  var sx = null, sy = 0;
  media.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
  media.addEventListener('pointerup', function (e) {
    if (sx === null) { return; }
    var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
      stop();
      var i = ORDER.indexOf(current);
      show(ORDER[(i + (dx < 0 ? 1 : -1) + ORDER.length) % ORDER.length]);
    }
  });
  media.addEventListener('pointercancel', function () { sx = null; });
  if (playBtn && canTour) {
    playBtn.hidden = false; setPlay('paused');
    playBtn.addEventListener('click', function () { if (walking) { stop(); } else { play(); } });
  }
  if (autoTour) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        inView = en.isIntersecting && en.intersectionRatio >= 0.35;
        if (inView && !walking && !stopped) { schedule(step < 0 ? FIRST_MS : 2500); }
        if (!inView) { clear(); walking = false; ring(null); }
      });
    }, { threshold: [0, 0.35, 0.6] });
    io.observe(hero);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clear(); walking = false; ring(null); }
      else if (inView && !walking && !stopped) { schedule(2500); }
    });
    hero.addEventListener('keydown', function (e) { if (e.target !== playBtn) { stop(); } });
    if ('requestIdleCallback' in window) { requestIdleCallback(function () { if (!stopped) { preload(itemFor(ORDER[1])); } }, { timeout: 3000 }); }
    else { setTimeout(function () { if (!stopped) { preload(itemFor(ORDER[1])); } }, 2000); }
  } else {
    // no automatic tour (touch screens, reduced motion, Save-Data): it waits for a tap, a swipe or the play button
    if (playBtn && canTour && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { inView = en.isIntersecting && en.intersectionRatio >= 0.35; if (!inView && walking) { clear(); walking = false; ring(null); setPlay('paused'); } });
      }, { threshold: [0, 0.35] }).observe(hero);
    }
  }
})();

// v12: a link to the ingredients or the details opens the folded details panel on a flavor page
(function () {
  var d = document.querySelector('details.fdetails');
  if (!d) { return; }
  function openIf() { var h = location.hash; if (h === '#details' || h === '#ingredients' || h === '#nutrition') { d.open = true; } }
  openIf();
  window.addEventListener('hashchange', openIf);
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href="#details"], a[href="#ingredients"]') : null;
    if (a) { d.open = true; }
  });
})();
