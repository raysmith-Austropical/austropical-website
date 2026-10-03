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

// v21: forms. Every form on the site posts to one Google Form that only Austropical can read: the answers
// land in Ray's sheet and he gets an email. The Google Form has nine short questions (form, name, company,
// role, email, phone, city and state, page, details); fields without their own question are folded into
// Details as "Label: value". If the post cannot leave the browser, the message opens as an email instead,
// so nothing is lost. No cookies, no tracking: the page address is sent so Ray knows where you wrote from.
(function () {
  'use strict';
  var GF = 'https://docs.google.com/forms/d/e/1FAIpQLSeMiK1tYCTW8KyLJh6ZtfsL5haHou2-1doqC1RYkWztRZLO9Q/formResponse';
  var Q = { form: 'entry.1022113747', name: 'entry.1663907768', company: 'entry.900838960', role: 'entry.88020838',
            email: 'entry.645159239', phone: 'entry.76559601', city: 'entry.1683168023', page: 'entry.858465827', details: 'entry.1329043127' };
  var OWN = { name: 'name', company: 'company', outlet: 'company', store: 'company', role: 'role', email: 'email', phone: 'phone', city: 'city', zip: 'city' };
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
    return t.replace(/\s*optional\s*/i, '').replace(/\s*\(optional\)\s*/i, '').replace(/\s+/g, ' ').trim().replace(/[:?]$/, '');
  }
  function collect(form) {
    var data = new FormData(form), seen = {}, order = [];
    data.forEach(function (v, k) {
      v = String(v).trim();
      if (k.charAt(0) === '_' || !v) return;
      if (!seen[k]) { seen[k] = []; order.push(k); }
      seen[k].push(v);
    });
    var c = { own: {}, details: [], lines: [] };
    order.forEach(function (k) {
      var val = seen[k].join(', '), lab = labelFor(form, k);
      c.lines.push(lab + ': ' + val);
      var q = OWN[k];
      if (q && !c.own[q]) c.own[q] = (k === 'zip' ? 'ZIP ' : '') + val;
      else c.details.push(lab + ': ' + val);
    });
    return c;
  }
  function pageLine() {
    var ref = document.referrer && document.referrer.indexOf(location.origin) !== 0 ? ' · from ' + document.referrer : '';
    return location.href + ref;
  }
  Array.prototype.forEach.call(forms, function (form) {
    var status = form.querySelector('.form-status');
    var to = form.getAttribute('data-to') || 'info@austropical.co';
    var subject = form.getAttribute('data-subject') || 'Message from austropical.co';
    var button = form.querySelector('button[type="submit"]');
    function say(msg, cls) { if (status) { status.textContent = msg; status.className = 'form-status ' + (cls || ''); } }
    function byMail(c) {
      var body = c.lines.join('\n') + '\n\nSent from ' + location.href + '\n';
      var href = 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
      form.setAttribute('data-last-mailto', href);
      window.location.href = href;
      say('That did not reach us, so your email app should open with the message filled in. If it does not, email ' + to + '.', 'err');
    }
    function done(c) {
      var first = (c.own.name || '').split(/\s+/)[0];
      var title = form.getAttribute('data-done-title') || (first ? 'Thank you, ' + first + '. Ray has it.' : 'Thank you. Ray has it.');
      var text = form.getAttribute('data-done') || 'He answers every request himself, by email from raysmith@austropical.co.';
      var box = document.createElement('div');
      box.className = 'form-done';
      box.setAttribute('tabindex', '-1');
      box.innerHTML = '<span class="form-done-ico" aria-hidden="true"></span><h3></h3><p></p>';
      box.querySelector('h3').textContent = title;
      box.querySelector('p').textContent = text;
      var more = form.getAttribute('data-done-link');
      if (more) {
        var a = document.createElement('a');
        a.className = 'btn btn-outline';
        a.href = more;
        a.textContent = form.getAttribute('data-done-link-text') || 'Keep reading';
        if (/\.pdf$/i.test(more)) { a.target = '_blank'; a.rel = 'noopener'; }
        box.appendChild(a);
      }
      form.classList.add('is-done');
      form.appendChild(box);
      say('Sent. ' + title, 'ok');
      try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
      var r = form.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.6) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var hp = form.querySelector('[name="_gotcha"]');
      if (hp && hp.value) return;
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var c = collect(form);
      if (!window.fetch || !window.URLSearchParams) { byMail(c); return; }
      var body = new URLSearchParams();
      body.append(Q.form, (form.getAttribute('data-aus-form') || 'form') + ' · ' + subject);
      ['name', 'company', 'role', 'email', 'phone', 'city'].forEach(function (k) { if (c.own[k]) body.append(Q[k], c.own[k]); });
      body.append(Q.page, pageLine());
      if (c.details.length) body.append(Q.details, c.details.join(' | '));
      if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
      say('Sending…');
      fetch(GF, { method: 'POST', mode: 'no-cors', credentials: 'omit', body: body })
        .then(function () { done(c); form.reset(); })
        .catch(function () { byMail(c); })
        .then(function () { if (button) { button.disabled = false; button.removeAttribute('aria-busy'); } });
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
  function hasWebGL() { try { var c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; } }
  function still() { if (btn) btn.hidden = true; sec.setAttribute('data-turn-mode', 'still'); }
  if (!glb || reduceData || !('customElements' in window) || !('IntersectionObserver' in window) || !('Promise' in window) || !('WebGLRenderingContext' in window)) { still(); return; }
  if (reduceMotion && btn) btn.hidden = true;
  sec.setAttribute('data-turn-mode', reduceMotion ? 'still3d' : 'auto');
  var LIB = 'assets/js/model-viewer.4.3.1.quiet.min.js', mv = null, paused = false;
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
    mv.addEventListener('error', function () { sec.classList.remove('is-3d'); if (mv && mv.parentNode) mv.parentNode.removeChild(mv); mv = null; still(); });
    mv.addEventListener('load', function () { sec.classList.add('is-3d'); });
    box.insertBefore(mv, btn || null);
  }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); if (!hasWebGL()) { still(); return; } lib().then(mount, still); } });
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
  function src(key, w) { return 'assets/img/bowl30/base-' + key + '-' + w + '.webp'; }
  function setBase(key) {
    if (bases[cur].getAttribute('data-key') === key) { pending = null; return; }
    var next = bases[1 - cur], from = bases[cur];
    pending = key;
    if (next.getAttribute('data-key') !== key) {
      next.setAttribute('data-key', key);
      next.setAttribute('sizes', SIZES);
      next.setAttribute('srcset', src(key, 600) + ' 600w, ' + src(key, 1200) + ' 1200w');
      next.setAttribute('src', src(key, 600));
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
    var zs = r.value === 'zero-sugar' ? ' Açaí Zero Sugar is not a low calorie food.' : '';
    topsText.textContent = (on.length ? 'A 2/3 cup scoop, topped with ' + list(on) + '.' : 'A 2/3 cup scoop, nothing on top.') + zs;
    link.setAttribute('href', r.getAttribute('data-url'));
    stack.setAttribute('aria-label', (on.length ? flavour + ' sorbet in a bowl, seen from above, topped with ' + list(on) + '.' : flavour + ' sorbet in a bowl, seen from above, nothing on top.') + ' Serving suggestion.' + zs);
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
    var im = new Image(); im.sizes = SIZES; im.srcset = src(key, 600) + ' 600w, ' + src(key, 1200) + ' 1200w'; im.src = src(key, 600);
  });
  // v14: a bowl in the address (?bowl=<base>&with=<toppings>|none) is the bowl the builder opens on
  (function () {
    var p; try { p = new URLSearchParams(location.search); } catch (e) { return; }
    var base = p.get('bowl'), w = p.get('with');
    var r = base && document.getElementById('base-' + base);
    if (r && r.name === 'base') r.checked = true;
    if (w !== null) {
      var want = w === 'none' ? [] : w.split(',');
      Array.prototype.forEach.call(b.querySelectorAll('input[name="top"]'), function (c) { c.checked = want.indexOf(c.value) >= 0; });
    }
  })();
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
    try { var c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl'); if (!g) return false; var x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); return true; } catch (e) { return false; }
  }
  if (!document.querySelector('[data-3d]') || reduceData || !('customElements' in window) || !('IntersectionObserver' in window) || !('Promise' in window) || !('WebGLRenderingContext' in window)) { return; }
  document.documentElement.classList.add('has-3d');
  // v14: the real WebGL check waits until a 3D box is about to mount (no GPU context at page load)
  var glOK = null;
  function canGL() { if (glOK === null) { glOK = hasWebGL(); if (!glOK) document.documentElement.classList.remove('has-3d'); } return glOK; }
  // model-viewer lowers its render resolution when frames run slow; keep every pack at the screen's full resolution
  // (a slower turn on an old phone beats a soft label). Applies to every viewer on the page, the home turn included.
  customElements.whenDefined('model-viewer').then(function (MV) { try { (MV || customElements.get('model-viewer')).minimumRenderScale = 1; } catch (err) {} });
  var ORBIT = '-18deg 76deg 105%', FOV = '25deg';
  // v23: the label's panels, measured on the models (the same layout on every flavor)
  var VIEWS = {
    pint: [['front', 'Front', -18, 76, 105, 25], ['story', 'Story', 120, 78, 105, 19], ['nutrition', 'Nutrition', 205, 80, 105, 15], ['ingredients', 'Ingredients', 250, 80, 105, 15]],
    cup: [['front', 'Front', 25, 74, 105, 25], ['story', 'Story', 150, 76, 105, 19], ['nutrition', 'Nutrition', 212, 78, 105, 15], ['ingredients', 'Ingredients', 262, 78, 105, 15]]
  };
  // fold the auto-rotate's turntable turn into the camera so the views are absolute (no visible jump)
  function settle(mv) {
    try {
      var tt = mv.turntableRotation || 0;
      if (tt) { var o = mv.getCameraOrbit(); mv.resetTurntableRotation(0); mv.cameraOrbit = (o.theta - tt) + 'rad ' + o.phi + 'rad ' + o.radius + 'm'; mv.jumpCameraToGoal(); }
    } catch (err) {}
  }
  function goView(mv, v, jump) {
    settle(mv);
    var t = v[2];
    try { var cur = mv.getCameraOrbit().theta * 180 / Math.PI; t = t + 360 * Math.round((cur - t) / 360); } catch (err) {}   // the shortest way round
    mv.cameraOrbit = t + 'deg ' + v[3] + 'deg ' + v[4] + '%';
    mv.fieldOfView = v[5] + 'deg';
    mv.cameraTarget = 'auto auto auto';
    if (jump) { try { mv.jumpCameraToGoal(); } catch (err) {} }
  }
  function viewsFor(mv) { return VIEWS[isCup(mv.getAttribute('src')) ? 'cup' : 'pint']; }
  function front(mv, jump) { goView(mv, viewsFor(mv)[0], jump); }
  var libPromise = null;
  function loadLib(glb) {
    if (!libPromise) {
      libPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.type = 'module';
        s.src = glb.slice(0, glb.indexOf('assets/')) + 'assets/js/model-viewer.4.3.1.quiet.min.js';
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
      loading: 'eager', reveal: 'auto', ar: '', 'ar-modes': 'scene-viewer quick-look', 'ar-scale': 'fixed', 'ios-src': glb.replace(/\.glb$/, '.usdz')
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
    hint.innerHTML = '<span class="spin-hint-ico"></span><span class="hint-fine">Drag to spin · scroll to zoom</span><span class="hint-coarse">Tap to explore in 3D</span>';
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
    mv.addEventListener('camera-change', function (e) { if (e.detail && e.detail.source === 'user-interaction') { box.classList.add('touched'); if (!box.viewing) { box.setView(''); } } });
    var bar = document.createElement('div');
    bar.className = 'p3-views'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Show a side of the pack');
    ['front', 'story', 'nutrition', 'ingredients'].forEach(function (k, i) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'p3-view'; b.setAttribute('data-view', k); b.setAttribute('aria-pressed', 'false');
      b.textContent = VIEWS.pint[i][1];
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var v = viewsFor(mv)[i];
        box.classList.add('touched'); mv.removeAttribute('auto-rotate');
        box.viewing = true; goView(mv, v, false); box.setView(k);
        setTimeout(function () { box.viewing = false; }, 60);
      });
      bar.appendChild(b);
    });
    box.setView = function (k) { Array.prototype.forEach.call(bar.children, function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === k ? 'true' : 'false'); }); };
    box.appendChild(bar);
    explore(box, mv);
  }
  // v21: on a touch screen the pack in the page leaves the scroll to the page (a sideways swipe still turns it). A tap on
  // the pack, or the Explore button, opens it full screen: there every drag turns and tilts it, a pinch zooms, and Done
  // (or the phone's back gesture, or Escape) puts it back where it was.
  var coarse = mm('(pointer: coarse)');
  function explore(box, mv) {
    if (!coarse) { return; }
    box.classList.add('p3-touch');
    var open = document.createElement('button');
    open.type = 'button'; open.className = 'p3-open';
    open.innerHTML = '<span class="p3-open-ico" aria-hidden="true"></span>Explore in 3D';
    box.appendChild(open);
    var done = document.createElement('button');
    done.type = 'button'; done.className = 'p3-done'; done.textContent = 'Done';
    box.appendChild(done);
    var help = document.createElement('span');
    help.className = 'p3-fhelp'; help.setAttribute('aria-hidden', 'true');
    help.textContent = 'Drag to turn and tilt · pinch to zoom';
    box.appendChild(help);
    var isOpen = false, pushed = false, spot = null, rot = null, sx = 0, sy = 0, st = 0, moved = false;
    function show() {
      if (isOpen) { return; }
      isOpen = true;
      spot = document.createComment('p3');
      box.parentNode.insertBefore(spot, box);
      // keep the space in the page while the pack is away, so nothing jumps
      var ph = document.createElement('div');
      ph.className = 'p3-ph'; ph.style.height = box.offsetHeight + 'px';
      spot.parentNode.insertBefore(ph, spot); spot.ph = ph;
      box.classList.add('p3-full'); box.classList.remove('is-held', 'show-tip');
      document.documentElement.classList.add('p3-lock');
      rot = mv.hasAttribute('auto-rotate'); mv.removeAttribute('auto-rotate'); settle(mv);
      mv.setAttribute('touch-action', 'none');
      try { if (history.pushState) { history.pushState({ p3: 1 }, ''); pushed = true; } } catch (err) {}
      setTimeout(function () { try { done.focus({ preventScroll: true }); } catch (err) {} }, 50);
    }
    function hide(fromPop) {
      if (!isOpen) { return; }
      isOpen = false;
      box.classList.remove('p3-full');
      document.documentElement.classList.remove('p3-lock');
      mv.setAttribute('touch-action', 'pan-y');
      front(mv, false); if (box.setView) { box.setView('front'); }
      if (rot && !box.classList.contains('touched')) { mv.setAttribute('auto-rotate', ''); }
      if (spot) { if (spot.ph) { spot.ph.parentNode.removeChild(spot.ph); } spot.parentNode.removeChild(spot); spot = null; }
      if (pushed && !fromPop) { pushed = false; try { history.back(); } catch (err) {} }
      pushed = false;
      try { open.focus({ preventScroll: true }); } catch (err) {}
    }
    open.addEventListener('click', function (e) { e.stopPropagation(); show(); });
    done.addEventListener('click', function (e) { e.stopPropagation(); hide(false); });
    window.addEventListener('popstate', function () { if (isOpen) { hide(true); } });
    document.addEventListener('keydown', function (e) { if (isOpen && (e.key === 'Escape' || e.key === 'Esc')) { hide(false); } });
    // a tap (no travel, short) on the pack in the page opens it; a swipe does not
    mv.addEventListener('pointerdown', function (e) { if (isOpen) { return; } sx = e.clientX; sy = e.clientY; st = Date.now(); moved = false; });
    mv.addEventListener('pointermove', function (e) { if (!isOpen && (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8)) { moved = true; } });
    mv.addEventListener('pointerup', function () { if (!isOpen && !moved && Date.now() - st < 400) { show(); } });
  }
  // watch an element that is always displayed (a hidden one never intersects); glb only tells loadLib the path depth
  function whenNear(el, glb, cb) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { io.disconnect(); if (!canGL()) return; loadLib(glb).then(cb, function () {}); }
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
    if (!glb) { return; }
    if (inst.mv.getAttribute('src') === glb) { front(inst.mv, false); if (inst.box.setView) { inst.box.setView('front'); } return; }
    if (bg) { inst.box.style.setProperty('--p3bg', bg); }
    inst.box.classList.remove('touched');
    try { inst.mv.resetTurntableRotation(0); } catch (err) {}
    inst.mv.cameraOrbit = ORBIT; inst.mv.fieldOfView = FOV; inst.mv.cameraTarget = 'auto auto auto';
    try { inst.mv.jumpCameraToGoal(); } catch (err) {}
    if (inst.box.setView) { inst.box.setView('front'); }
    if (poster) { inst.mv.setAttribute('poster', posterUrl(poster)); }
    inst.mv.setAttribute('alt', altFor(glb, name, note));
    try { inst.mv.showPoster(); } catch (err) {}
    inst.mv.setAttribute('ios-src', glb.replace(/\.glb$/, '.usdz'));   // v25: iPhone AR (Quick Look)
    inst.mv.setAttribute('src', glb);
    inst.mv.addEventListener('load', function once() { inst.mv.removeEventListener('load', once); front(inst.mv, true); }, { once: true });
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
      mv.addEventListener('load', function () { box.classList.add('is-3d'); });   // v32: the still under it goes
      mv.addEventListener('error', function () {
        box.classList.remove('is-3d');
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
// follow. v28: the hero walks the line on its own on every device, phones included (pair, then each flavor, round and
// round), while it is in view and the tab is visible. Pause stops it; picking a lid, swiping the picture or using the
// keyboard takes over. Under reduced motion the pictures swap without a fade. No walk under Save-Data.
(function () {
  var hero = document.querySelector('.page-home .hero-field');
  var line = hero && hero.querySelector('[data-line]');
  var media = hero && hero.querySelector('.hf-media');
  var note = hero && hero.querySelector('[data-caption]');
  if (!hero || !line || !media || !note || !('Promise' in window)) { return; }
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var reduceMotion = mm('(prefers-reduced-motion: reduce)');
  var saveData = mm('(prefers-reduced-data: reduce)') || !!(navigator.connection && navigator.connection.saveData);
  var ITEMS = [{"k": "original-sensation", "name": "Organic Açaí Original Sensation", "short": "Original Sensation", "fbg": "#D69B49", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#D69B49", "desc": "deep, dark açaí, and plenty of it.", "tail": "", "when": "First in March 2027", "href": "flavors/original-sensation.html", "alt": "Austropical Organic Açaí Original Sensation sorbet pint floating on a mustard background, its shadow cast on the wall behind it."}, {"k": "mango", "name": "Organic Mango", "short": "Mango", "fbg": "#69B0BF", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#69B0BF", "desc": "ripe, golden mango, and plenty of it.", "tail": "", "when": "First in March 2027", "href": "flavors/mango.html", "alt": "Austropical Organic Mango sorbet pint floating on a turquoise background, its shadow cast on the wall behind it."}, {"k": "banana-sunrise", "name": "Açaí Banana Sunrise", "short": "Banana Sunrise", "fbg": "#DDBB80", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#DDBB80", "desc": "açaí, rounded off with banana.", "tail": "", "when": "Follows the first two", "href": "flavors/banana-sunrise.html", "alt": "Austropical Açaí Banana Sunrise sorbet pint floating on a banana yellow background, its shadow cast on the wall behind it."}, {"k": "strawberry-crush", "name": "Açaí Strawberry Crush", "short": "Strawberry Crush", "fbg": "#E86B4A", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#E86B4A", "desc": "açaí with a crush of strawberry.", "tail": "", "when": "Follows the first two", "href": "flavors/strawberry-crush.html", "alt": "Austropical Açaí Strawberry Crush sorbet pint floating on a coral background, its shadow cast on the wall behind it."}, {"k": "zero-sugar", "name": "Açaí Zero Sugar", "short": "Zero Sugar", "fbg": "#9A9AD3", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#9A9AD3", "desc": "mostly açaí, zero sugar. Not a low calorie food.", "tail": "", "when": "Follows the first two", "href": "flavors/zero-sugar.html", "alt": "Austropical Açaí Zero Sugar sorbet pint floating on a lilac background, its shadow cast on the wall behind it. Not a low calorie food."}, {"k": "coconut", "name": "Organic Coconut", "short": "Coconut", "fbg": "#3C75BD", "ffg": "#FFFFFF", "hl": "#FFCC04", "btxt": "#31609B", "desc": "cool, snow-white coconut.", "tail": "", "when": "Follows the first two", "href": "flavors/coconut.html", "alt": "Austropical Organic Coconut sorbet pint floating on a cobalt blue background, its shadow cast on the wall behind it."}, {"k": "passionfruit", "name": "Passionfruit", "short": "Passionfruit", "fbg": "#7B6BBA", "ffg": "#FFFFFF", "hl": "#FFDE5C", "btxt": "#655899", "desc": "sharp, bright passion fruit.", "tail": "", "when": "Follows the first two", "href": "flavors/passionfruit.html", "alt": "Austropical Passionfruit sorbet pint floating on a violet background, its shadow cast on the wall behind it."}, {"k": "dragon-fruit-pineapple", "name": "Dragon Fruit & Pineapple", "short": "Dragon Fruit & Pineapple", "fbg": "#53A46C", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#53A46C", "desc": "hot-pink dragon fruit, with pineapple.", "tail": "", "when": "Follows the first two", "href": "flavors/dragon-fruit-pineapple.html", "alt": "Austropical Dragon Fruit & Pineapple sorbet pint floating on a green background, its shadow cast on the wall behind it."}, {"k": "pink-guava-acerola", "name": "Pink Guava & Acerola", "short": "Pink Guava & Acerola", "fbg": "#E1B0AE", "ffg": "#1F0B3D", "hl": "#1F0B3D", "btxt": "#E1B0AE", "desc": "rosy pink guava, tart acerola.", "tail": "", "when": "Follows the first two", "href": "flavors/pink-guava-acerola.html", "alt": "Austropical Pink Guava & Acerola sorbet pint floating on a guava pink background, its shadow cast on the wall behind it."}, {"k": "cupuacu-coconut", "name": "Cupuaçu & Coconut", "short": "Cupuaçu & Coconut", "fbg": "#854B2B", "ffg": "#FBF1E4", "hl": "#FFCC04", "btxt": "#6D3D23", "desc": "cupuaçu, a relative of cacao from the same forest as açaí, with coconut.", "tail": "", "when": "Follows the first two", "href": "flavors/cupuacu-coconut.html", "alt": "Austropical Cupuaçu & Coconut sorbet pint floating on a cocoa brown background, its shadow cast on the wall behind it."}];

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
  var STEP_MS = 4500, FIRST_MS = 2500;   // v32: a little quicker (was 6.5 s and 3 s)
  var autoTour = !saveData && 'IntersectionObserver' in window;
  var canTour = !saveData;
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
  function ring(k, ms) {
    buttons.forEach(function (b) { b.classList.remove('is-timing'); });
    if (!walking || !k) { return; }
    var b = buttons[ORDER.indexOf(k)]; if (!b) { return; }
    void b.offsetWidth;                                   // restart the CSS animation
    b.style.setProperty('--dur', (ms || STEP_MS) + 'ms'); b.classList.add('is-timing');
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
    if (held) { ring(current, ms); return; }
    timer = setTimeout(tick, ms);
    ring(current, ms);                                   // v28: the ring shows the wait to the next flavor, the first one too
  }
  function tick() {
    timer = null;
    if (stopped || !inView || document.hidden) { walking = false; ring(null); return; }
    var i = ORDER.indexOf(current);
    var next = ORDER[(i + 1) % ORDER.length];
    step += 1;
    show(next);
    preload(itemFor(ORDER[(ORDER.indexOf(next) + 1) % ORDER.length]));
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
        if (inView && !walking && !stopped) { schedule(step < 0 ? FIRST_MS : 2000); }
        if (!inView) { clear(); walking = false; ring(null); }
      });
    }, { threshold: [0, 0.35, 0.6] });
    io.observe(hero);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clear(); walking = false; ring(null); }
      else if (inView && !walking && !stopped) { schedule(2000); }
    });
    hero.addEventListener('keydown', function (e) { if (e.target !== playBtn) { stop(); } });
    if ('requestIdleCallback' in window) { requestIdleCallback(function () { if (!stopped) { preload(itemFor(ORDER[1])); } }, { timeout: 3000 }); }
    else { setTimeout(function () { if (!stopped) { preload(itemFor(ORDER[1])); } }, 2000); }
  } else {
    // no automatic tour (Save-Data, or no IntersectionObserver): it waits for a tap, a swipe or the play button
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

// v14: the bowl builder gets a name, a link and a picture you can keep. Every bowl has a name made from its base and
// toppings ("The Mango Crunch"); the address bar holds the bowl (?bowl=mango&with=granola,coconut#build), so a shared
// link opens the same bowl; "Share my bowl" sends a 4:5 picture card (the bowl, its name, the flavor colour, the logo,
// "Serving suggestion") through the phone's share sheet, and "Save the picture" downloads it; "Surprise me" deals a
// random bowl. The card is drawn on the visitor's own device from the same layers the page shows; nothing is uploaded.
(function () {
  'use strict';
  var b = document.querySelector('.si-build');
  if (!b) return;
  var stack = b.querySelector('.bb-stack'), title = b.querySelector('.bb-title'), toast = b.querySelector('.bb-toast');
  var bases = b.querySelectorAll('input[name="base"]'), topsIn = b.querySelectorAll('input[name="top"]');
  if (!stack || !title || !bases.length) return;
  var NICK = { 'original-sensation': 'Amazon', 'banana-sunrise': 'Sunrise', 'strawberry-crush': 'Crush', 'zero-sugar': 'Midnight',
    'coconut': 'Coco', 'mango': 'Mango', 'passionfruit': 'Passion', 'dragon-fruit-pineapple': 'Dragon', 'pink-guava-acerola': 'Rosy',
    'cupuacu-coconut': 'Cupuaçu' };
  var WORD = { granola: 'Crunch', banana: 'Banana', strawberry: 'Berry', coconut: 'Island' };
  var RANK = ['banana', 'strawberry', 'coconut', 'granola'];          // the last one picked names the bowl
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var reduceMotion = mm('(prefers-reduced-motion: reduce)');

  function state() {
    var r = b.querySelector('input[name="base"]:checked');
    var on = [];
    Array.prototype.forEach.call(topsIn, function (c) { if (c.checked) on.push(c.value); });
    return { base: r ? r.value : 'original-sensation', img: r ? r.getAttribute('data-base') : 'original-sensation', flavour: r ? r.getAttribute('data-name') : '',
      chip: r ? r.nextElementSibling : null, tops: on };
  }
  function bowlName(s) {
    var nick = NICK[s.base] || 'Austropical';
    if (!s.tops.length) return 'The Pure ' + nick;
    if (s.tops.length === 4) return 'The ' + nick + ' Works';
    var ranked = RANK.filter(function (t) { return s.tops.indexOf(t) >= 0; });
    var words = ranked.slice(-2).map(function (t) { return WORD[t]; });
    return 'The ' + nick + ' ' + words.join(' ');
  }
  function list(items) { return items.join(', ').replace(/, ([^,]*)$/, ' and $1'); }
  function query(s) { return '?bowl=' + s.base + '&with=' + (s.tops.length ? s.tops.join(',') : 'none') + '#build'; }
  function link(s) { return location.origin + location.pathname + query(s); }

  var ready = false;
  function paintName() {
    var s = state();
    title.textContent = bowlName(s);
    if (ready) { try { history.replaceState(null, '', query(s)); } catch (e) {} }
  }
  b.addEventListener('change', paintName);
  paintName();
  ready = true;

  function say(msg) {
    if (!toast) return;
    toast.textContent = msg; toast.hidden = false;
    clearTimeout(say.t); say.t = setTimeout(function () { toast.hidden = true; }, 4200);
  }

  // Surprise me: a new base and one to four toppings, never the bowl already on screen
  var dice = b.querySelector('[data-bb-surprise]');
  if (dice) dice.addEventListener('click', function () {
    var before = query(state()), guard = 0, s;
    do {
      var r = bases[Math.floor(Math.random() * bases.length)];
      r.checked = true;
      var picked = 0;
      Array.prototype.forEach.call(topsIn, function (c) { c.checked = Math.random() < 0.6; if (c.checked) picked++; });
      if (!picked) topsIn[Math.floor(Math.random() * topsIn.length)].checked = true;
      s = state();
    } while (query(s) === before && ++guard < 12);
    b.dispatchEvent(new Event('change', { bubbles: true }));
    if (!reduceMotion) { stack.classList.remove('bb-shuffle'); void stack.offsetWidth; stack.classList.add('bb-shuffle'); }
  });

  // the picture card, drawn on this device from the page's own layers
  function load(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image(); im.decoding = 'async';
      im.onload = function () { resolve(im); }; im.onerror = reject; im.src = src;
    });
  }
  function wrap(ctx, text, maxW, maxLines) {
    var words = text.split(' '), lines = [], line = '';
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else { line = t; }
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '…'; }
    return lines;
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function card() {
    var s = state(), name = bowlName(s);
    var bg = (s.chip && s.chip.style.getPropertyValue('--cbg')) || '#FFCC04', fg = (s.chip && s.chip.style.getPropertyValue('--cfg')) || '#1F0B3D';
    var dark = /^#(FFF|FBF1E4|FFFFFF)/i.test(fg.trim());
    var INK = '#1F0B3D';
    var order = Array.prototype.map.call(stack.querySelectorAll('.bb-top'), function (l) { return l.getAttribute('data-top'); });
    var srcs = ['assets/img/bowl30/base-' + s.img + '-1200.webp'].concat(s.tops.slice().sort(function (p, q) { return order.indexOf(p) - order.indexOf(q); }).map(function (t) {
      var layer = stack.querySelector('.bb-top[data-top="' + t + '"]');
      var cur = layer ? (layer.currentSrc || layer.getAttribute('src')) : '';
      return cur.replace(/-600\.webp$/, '-1200.webp');
    }));
    var logo = 'assets/img/austropical-logo-color-on-' + (dark ? 'dark' : 'light') + '.svg';
    var fonts = document.fonts ? Promise.all([document.fonts.load('800 80px "Bricolage Grotesque"'), document.fonts.load('600 34px "DM Sans"'), document.fonts.load('700 30px "DM Sans"')]) : Promise.resolve();
    return Promise.all([fonts, Promise.all(srcs.map(load)), load(logo).catch(function () { return null; })]).then(function (res) {
      var imgs = res[1], lg = res[2];
      var W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
      var ctx = c.getContext('2d');
      ctx.fillStyle = bg.trim(); ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = fg.trim(); ctx.textBaseline = 'alphabetic';
      ctx.font = '700 26px "DM Sans", Arial, sans-serif';
      try { ctx.letterSpacing = '6px'; } catch (e) {}
      ctx.fillText('MY AUSTROPICAL BOWL', 80, 112);
      try { ctx.letterSpacing = '0px'; } catch (e) {}
      var size = 84; ctx.font = '800 ' + size + 'px "Bricolage Grotesque", Arial, sans-serif';
      var lines = wrap(ctx, name, W - 160, 2);
      if (lines.length > 1) { size = 72; ctx.font = '800 ' + size + 'px "Bricolage Grotesque", Arial, sans-serif'; lines = wrap(ctx, name, W - 160, 2); }
      lines.forEach(function (l, i) { ctx.fillText(l, 80, 196 + i * (size + 6)); });
      var top = 196 + (lines.length - 1) * (size + 6) + 44;
      var P = lines.length > 1 ? 690 : 760, x = (W - P) / 2 - 8;
      // v22: the bowl on its own colour field, rounded, with a soft shadow (no ink frame)
      ctx.save(); ctx.shadowColor = 'rgba(0, 0, 0, .28)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 22;
      ctx.fillStyle = bg.trim(); rr(ctx, x, top, P, P, 33); ctx.fill(); ctx.restore();
      ctx.save(); rr(ctx, x, top, P, P, 33); ctx.clip();
      imgs.forEach(function (im) { ctx.drawImage(im, x, top, P, P); });
      ctx.restore();
      var y = top + P + 70;
      ctx.fillStyle = fg.trim(); ctx.font = '600 34px "DM Sans", Arial, sans-serif';
      var line2 = s.flavour + (s.tops.length ? ', topped with ' + list(s.tops) : ', nothing on top');
      wrap(ctx, line2, W - 160, 2).forEach(function (l, i) { ctx.fillText(l, 80, y + i * 44); });
      // footer: the logo, the address, and the fine print on its own line
      var lh = 110, lw = lg && lg.naturalWidth && lg.naturalHeight ? lh * lg.naturalWidth / lg.naturalHeight : 175;
      if (lg) ctx.drawImage(lg, 80, H - 200, lw, lh);
      ctx.font = '700 32px "DM Sans", Arial, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('Build yours at austropical.co', W - 80, H - 134);
      ctx.font = '500 24px "DM Sans", Arial, sans-serif'; ctx.fillText(s.base === 'original-sensation' || s.base === 'mango' ? 'Coming to US freezers · March 2027' : 'Follows Original Sensation and Mango into US freezers', W - 80, H - 96);
      ctx.textAlign = 'left'; ctx.font = '500 21px "DM Sans", Arial, sans-serif';
      var fine = 'Serving suggestion. Toppings not included.' + (s.base === 'zero-sugar' ? ' Açaí Zero Sugar is not a low calorie food.' : '');
      ctx.fillText(fine, 80, H - 48);
      return new Promise(function (resolve) { c.toBlob(function (blob) { resolve({ blob: blob, name: name, s: s }); }, 'image/jpeg', 0.92); });
    });
  }
  function fileName(name) { return 'austropical-' + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.jpg'; }
  function save(out) {
    var a = document.createElement('a'), u = URL.createObjectURL(out.blob);
    a.href = u; a.download = fileName(out.name); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error('no clipboard'));
  }
  var shareBtn = b.querySelector('[data-bb-share]'), saveBtn = b.querySelector('[data-bb-save]'), linkBtn = b.querySelector('[data-bb-link]');
  function busy(btn, on) { if (btn) { btn.disabled = on; btn.classList.toggle('is-busy', on); } }
  // v16: the card is made ahead of time (after each change, while the buttons are near the screen), so a tap can open
  // the share sheet at once: Safari only shares from directly inside the tap, and waiting for the picture there can fail.
  var made = null, making = null, prepT = 0, near = !('IntersectionObserver' in window);
  function keyOf(s) { return s.base + '|' + s.tops.join(','); }
  function prep() {
    var k = keyOf(state());
    if ((made && made.k === k) || (making && making.k === k)) return;
    var job = { k: k }; making = job;
    card().then(function (out) { if (making === job) { made = { k: k, out: out }; making = null; } },
      function () { if (making === job) making = null; });
  }
  function prepSoon() { clearTimeout(prepT); if (near) prepT = setTimeout(prep, 450); }
  b.addEventListener('change', prepSoon);
  if (shareBtn && !near) new IntersectionObserver(function (es) { near = es[0].isIntersecting; if (near) prepSoon(); }, { rootMargin: '300px 0px' }).observe(shareBtn);
  else prepSoon();
  if (shareBtn) shareBtn.addEventListener('click', function () {
    var s = state(), url = link(s), k = keyOf(s), name = bowlName(s);
    var text = name + ': ' + s.flavour + (s.base === 'zero-sugar' ? ' (not a low calorie food)' : '') + (s.tops.length ? ', topped with ' + list(s.tops) : '') + '. Build yours:';
    var out = made && made.k === k ? made.out : null, file = null;
    if (out) { try { file = new File([out.blob], fileName(out.name), { type: 'image/jpeg' }); } catch (e) {} }
    var fail = function (err) { if (err && err.name !== 'AbortError') say('That did not work here. Try "Save the picture".'); };
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name, text: text + ' ' + url }).catch(fail); return; }
    if (navigator.share) { navigator.share({ title: name, text: text, url: url }).catch(fail); return; }
    busy(shareBtn, true);
    (out ? Promise.resolve(out) : card()).then(function (o) {
      save(o);
      return copy(url).then(function () { say('Picture saved, and the link is copied: paste it anywhere to share this bowl.'); },
        function () { say('Picture saved. Share it with this link: ' + url); });
    }).catch(function () { say('That did not work here.'); }).then(function () { busy(shareBtn, false); });
  });
  b.__bowlShareReady = function () { return !!(made && made.k === keyOf(state())); };
  if (saveBtn) saveBtn.addEventListener('click', function () {
    busy(saveBtn, true);
    card().then(function (out) { save(out); say('Saved: ' + fileName(out.name)); }, function () { say('That did not work here.'); })
      .then(function () { busy(saveBtn, false); });
  });
  if (linkBtn) linkBtn.addEventListener('click', function () {
    var url = link(state());
    copy(url).then(function () { say('Link copied. Whoever opens it sees this exact bowl.'); }, function () { say(url); });
  });
  // for the QA harness and anyone curious: the card as a data URL
  b.__bowlCard = function () { return card().then(function (out) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(out.blob); }); }); };
})();

// v14: Find your flavor. Four quick picks (a colour, a taste, a moment, a topping) score the ten flavors; the result is
// the pint on its colour with three ways on: meet the flavor, build a bowl with it (the topping you picked goes on), or
// share it. A shared link (?flavor=<slug>#quiz) opens on that flavor. Hidden without JavaScript.
(function () {
  'use strict';
  var sec = document.querySelector('[data-quiz]');
  if (!sec) return;
  var body = sec.querySelector('[data-quiz-body]');
  if (!body) return;
  var F = {
    'original-sensation': ['Organic Açaí Original Sensation', 'Original Sensation', 'Deep, dark açaí. USDA Organic.', '#D69B49', '#1F0B3D'],
    'banana-sunrise': ['Açaí Banana Sunrise', 'Banana Sunrise', 'Açaí, rounded off with banana.', '#DDBB80', '#1F0B3D'],
    'strawberry-crush': ['Açaí Strawberry Crush', 'Strawberry Crush', 'Açaí with a crush of strawberry.', '#E86B4A', '#1F0B3D'],
    'zero-sugar': ['Açaí Zero Sugar', 'Zero Sugar', 'Mostly açaí, zero sugar. Not a low calorie food.', '#9A9AD3', '#1F0B3D'],
    'coconut': ['Organic Coconut', 'Coconut', 'Cool, snow-white coconut. USDA Organic.', '#3C75BD', '#FFFFFF'],
    'mango': ['Organic Mango', 'Mango', 'Ripe, golden mango. USDA Organic.', '#69B0BF', '#1F0B3D'],
    'passionfruit': ['Passionfruit', 'Passionfruit', 'Sharp, bright passion fruit.', '#7B6BBA', '#FFFFFF'],
    'dragon-fruit-pineapple': ['Dragon Fruit & Pineapple', 'Dragon Fruit & Pineapple', 'Hot-pink dragon fruit, with pineapple.', '#53A46C', '#1F0B3D'],
    'pink-guava-acerola': ['Pink Guava & Acerola', 'Pink Guava & Acerola', 'Rosy pink guava, tart acerola.', '#E1B0AE', '#1F0B3D'],
    'cupuacu-coconut': ['Cupuaçu & Coconut', 'Cupuaçu & Coconut', 'A relative of cacao, with coconut.', '#854B2B', '#FBF1E4']
  };
  var S = { os: 'original-sensation', bs: 'banana-sunrise', sc: 'strawberry-crush', zs: 'zero-sugar', co: 'coconut', mg: 'mango',
    pf: 'passionfruit', dfp: 'dragon-fruit-pineapple', pga: 'pink-guava-acerola', cc: 'cupuacu-coconut' };
  var Q = [
    { q: 'Pick a color.', o: [
      ['purple', 'Deep purple', { os: 2, zs: 2, bs: 1, sc: 1 }, '#4B2A7B'],
      ['gold', 'Sunny gold', { mg: 2, pf: 2, bs: 1 }, '#F2B33D'],
      ['pink', 'Hot pink', { dfp: 2, pga: 2, sc: 1 }, '#E5397A'],
      ['white', 'Creamy white', { co: 2, cc: 2 }, '#FBF1E4']] },
    { q: 'How should it taste?', o: [
      ['deep', 'Deep and dark', { os: 2, zs: 2, cc: 1 }],
      ['tangy', 'Bright and tangy', { pf: 2, pga: 2, sc: 1 }],
      ['juicy', 'Sweet and juicy', { mg: 2, dfp: 2, bs: 1 }],
      ['creamy', 'Smooth and creamy', { co: 2, cc: 2, bs: 1 }]] },
    { q: 'When are you eating it?', o: [
      ['breakfast', 'Breakfast, in a bowl', { os: 2, bs: 2, mg: 1 }],
      ['sun', 'An afternoon in the sun', { mg: 1, dfp: 2, pf: 2, co: 1 }],
      ['dinner', 'After dinner', { cc: 2, pga: 2, os: 1 }],
      ['midnight', 'Midnight, from the pint', { zs: 2, sc: 2, co: 1 }]] },
    { q: 'Pick a topping.', o: [
      ['granola', 'Granola', { os: 2, zs: 1, cc: 1 }, null, 'granola'],
      ['banana', 'Banana', { bs: 2, mg: 2 }, null, 'banana'],
      ['strawberry', 'Strawberry', { sc: 2, pga: 1, dfp: 1 }, null, 'strawberry'],
      ['coconut', 'Coconut', { co: 2, cc: 1, pf: 1 }, null, 'coconut']] }
  ];
  var ORDER = ['mg', 'os', 'dfp', 'pga', 'pf', 'co', 'cc', 'sc', 'bs', 'zs'];
  var answers = [], step = 0;
  var mm = function (q) { return !!(window.matchMedia && window.matchMedia(q).matches); };
  var reduceMotion = mm('(prefers-reduced-motion: reduce)');
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function opt(i) { return Q[i].o.filter(function (o) { return o[0] === answers[i]; })[0]; }
  function score() {
    var tot = {}; Object.keys(S).forEach(function (k) { tot[k] = 0; });
    answers.forEach(function (a, i) { var o = opt(i); if (o) Object.keys(o[2]).forEach(function (k) { tot[k] += o[2][k]; }); });
    var best = Math.max.apply(null, Object.keys(tot).map(function (k) { return tot[k]; }));
    var c = Object.keys(tot).filter(function (k) { return tot[k] === best; });
    for (var i = answers.length - 1; i >= 0 && c.length > 1; i--) {
      var pts = opt(i)[2], m = Math.max.apply(null, c.map(function (k) { return pts[k] || 0; }));
      c = c.filter(function (k) { return (pts[k] || 0) === m; });
    }
    c.sort(function (a, b) { return ORDER.indexOf(a) - ORDER.indexOf(b); });
    return S[c[0]];
  }
  function progress(i) {
    var dots = Q.map(function (_, k) { return '<i class="' + (k < i ? 'is-done' : k === i ? 'is-on' : '') + '"></i>'; }).join('');
    return '<div class="quiz-progress"><span class="quiz-count">Question ' + (i + 1) + ' of ' + Q.length + '</span><span class="quiz-dots" aria-hidden="true">' + dots + '</span></div>';
  }
  function renderStep(i, focus) {
    step = i;
    var q = Q[i];
    var opts = q.o.map(function (o) {
      var pressed = answers[i] === o[0];
      var art = o[3] ? '<span class="quiz-sw" style="--sw:' + o[3] + '" aria-hidden="true"></span>'
        : o[4] ? '<img src="../assets/img/bowl30/icon-' + o[4] + '-112.png" width="48" height="48" alt="" decoding="async">' : '';
      return '<button type="button" class="quiz-opt' + (art ? ' has-art' : '') + '" data-v="' + o[0] + '" aria-pressed="' + pressed + '">' + art + '<span>' + esc(o[1]) + '</span></button>';
    }).join('');
    body.innerHTML = progress(i) + '<div class="quiz-q" role="group" aria-labelledby="quiz-q' + i + '"><h3 class="quiz-qtext" id="quiz-q' + i + '" tabindex="-1">' + esc(q.q) + '</h3>' +
      '<div class="quiz-opts">' + opts + '</div></div>' +
      '<div class="quiz-nav">' + (i ? '<button type="button" class="quiz-back" data-quiz-back>Back</button>' : '') + '</div>';
    if (!reduceMotion) { body.classList.remove('quiz-in'); void body.offsetWidth; body.classList.add('quiz-in'); }
    if (focus) { var h = body.querySelector('.quiz-qtext'); if (h) h.focus({ preventScroll: true }); }
  }
  function renderResult(slug, shared, focus) {
    var d = F[slug], top = answers[3];
    var bowl = '../serving-ideas.html?bowl=' + slug + '&with=' + (top || 'granola') + '#build';
    var img = '../assets/img/3d/poster-' + slug;
    sec.style.setProperty('--qbg', d[3]); sec.style.setProperty('--qfg', d[4]);
    sec.classList.add('has-result');
    body.innerHTML = '<div class="quiz-result">' +
      '<div class="quiz-pic"><img src="' + img + '-570.webp" srcset="' + img + '-570.webp 570w, ' + img + '-1140.webp 1140w" sizes="(min-width: 900px) 460px, 86vw" width="1140" height="1140" alt="Austropical ' + esc(d[0]) + ' sorbet pint.' + (slug === 'zero-sugar' ? ' Not a low calorie food.' : '') + '"></div>' +
      '<div class="quiz-text">' +
      '<p class="quiz-kicker">' + (shared ? 'A flavor someone shared' : 'Your flavor') + '</p>' +
      '<h3 class="quiz-name" tabindex="-1">' + esc(d[0]) + '</h3>' +
      '<p class="quiz-line">' + esc(d[2]) + '</p>' +
      (shared ? '' : '<ul class="quiz-picks" aria-label="Your picks">' + answers.map(function (a, i) { return '<li>' + esc(opt(i)[1]) + '</li>'; }).join('') + '</ul>') +
      '<div class="quiz-actions">' +
      '<a class="btn btn-ink" href="' + slug + '.html">Meet ' + esc(d[1]) + '</a>' +
      '<a class="btn btn-ghost" href="' + bowl + '">Build a bowl with it</a>' +
      (shared ? '' : '<button type="button" class="btn btn-ghost" data-quiz-share>Share</button>') +
      '</div>' +
      '<button type="button" class="quiz-again" data-quiz-again>' + (shared ? 'Find your own flavor' : 'Take it again') + '</button>' +
      '<p class="quiz-toast" role="status" hidden></p>' +
      '</div></div>';
    if (!reduceMotion) { body.classList.remove('quiz-in'); void body.offsetWidth; body.classList.add('quiz-in'); }
    if (focus) { var h = body.querySelector('.quiz-name'); if (h) h.focus({ preventScroll: true }); }
    body.setAttribute('data-result', slug);
    if (!shared) setTimeout(function () { prepCard(slug); }, 250);
  }
  function reset(focus) { answers = []; sec.classList.remove('has-result'); sec.style.removeProperty('--qbg'); sec.style.removeProperty('--qfg'); body.removeAttribute('data-result'); renderStep(0, focus); }
  // v16: the flavor card (1080 x 1350), drawn on this device: the pint on its own color, the flavor's name and line.
  // It is made as soon as the result shows, so a tap on Share opens the share sheet at once (Safari needs that).
  var fcard = null;
  function loadImg(src) { return new Promise(function (res, rej) { var im = new Image(); im.decoding = 'async'; im.onload = function () { res(im); }; im.onerror = rej; im.src = src; }); }
  function wrapText(ctx, text, maxW, maxLines) {
    var words = text.split(' '), lines = [], line = '';
    words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else { line = t; } });
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s+\S*$/, '') + '…'; }
    return lines;
  }
  function flavorCard(slug) {
    var d = F[slug], bg = d[3], fg = d[4], dark = /^#(FFF|FBF1E4|FFFFFF)/i.test(fg);
    var fonts = document.fonts ? Promise.all([document.fonts.load('800 80px "Bricolage Grotesque"'), document.fonts.load('600 34px "DM Sans"'), document.fonts.load('700 30px "DM Sans"')]) : Promise.resolve();
    return Promise.all([fonts, loadImg('../assets/img/3d/poster-' + slug + '-1140.webp'),
      loadImg('../assets/img/austropical-logo-color-on-' + (dark ? 'dark' : 'light') + '.svg').catch(function () { return null; })]).then(function (r) {
      var pint = r[1], lg = r[2], W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
      var ctx = c.getContext('2d');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = fg; ctx.textBaseline = 'alphabetic';
      ctx.font = '700 26px "DM Sans", Arial, sans-serif';
      try { ctx.letterSpacing = '6px'; } catch (e) {}
      ctx.fillText('MY AUSTROPICAL FLAVOR', 80, 112);
      try { ctx.letterSpacing = '0px'; } catch (e) {}
      var size = 84; ctx.font = '800 ' + size + 'px "Bricolage Grotesque", Arial, sans-serif';
      var lines = wrapText(ctx, d[0], W - 160, 2);
      if (lines.length > 1) { size = 72; ctx.font = '800 ' + size + 'px "Bricolage Grotesque", Arial, sans-serif'; lines = wrapText(ctx, d[0], W - 160, 2); }
      lines.forEach(function (l, i) { ctx.fillText(l, 80, 196 + i * (size + 6)); });
      var top = 196 + (lines.length - 1) * (size + 6) + 6, P = lines.length > 1 ? 740 : 800;
      ctx.drawImage(pint, (W - P) / 2, top, P, P);
      ctx.font = '600 34px "DM Sans", Arial, sans-serif';
      wrapText(ctx, d[2], W - 160, 2).forEach(function (l, i) { ctx.fillText(l, 80, top + P + 34 + i * 44); });
      var lh = 110, lw = lg && lg.naturalWidth && lg.naturalHeight ? lh * lg.naturalWidth / lg.naturalHeight : 175;
      if (lg) ctx.drawImage(lg, 80, H - 200, lw, lh);
      ctx.font = '700 32px "DM Sans", Arial, sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('Find your flavor at austropical.co', W - 80, H - 134);
      ctx.font = '500 24px "DM Sans", Arial, sans-serif'; ctx.fillText(slug === 'original-sensation' || slug === 'mango' ? 'Coming to US freezers · March 2027' : 'Follows Original Sensation and Mango into US freezers', W - 80, H - 96);
      ctx.textAlign = 'left';
      if (slug === 'zero-sugar') { ctx.font = '500 21px "DM Sans", Arial, sans-serif'; ctx.fillText('Açaí Zero Sugar is not a low calorie food.', 80, H - 48); }
      return new Promise(function (resolve) { c.toBlob(resolve, 'image/jpeg', 0.92); });
    });
  }
  function prepCard(slug) { var mine = { slug: slug, blob: null }; fcard = mine; flavorCard(slug).then(function (blob) { if (fcard === mine) mine.blob = blob; }, function () {}); }
  body.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    if (t.hasAttribute('data-v')) {
      answers[step] = t.getAttribute('data-v'); answers.length = step + 1;
      Array.prototype.forEach.call(body.querySelectorAll('.quiz-opt'), function (b) { b.setAttribute('aria-pressed', b === t ? 'true' : 'false'); });
      setTimeout(function () { if (step + 1 < Q.length) renderStep(step + 1, true); else renderResult(score(), false, true); }, reduceMotion ? 0 : 180);
    } else if (t.hasAttribute('data-quiz-back')) {
      renderStep(Math.max(0, step - 1), true);
    } else if (t.hasAttribute('data-quiz-again')) {
      try { history.replaceState(null, '', location.pathname + '#quiz'); } catch (err) {}
      reset(true);
    } else if (t.hasAttribute('data-quiz-share')) {
      var slug = body.getAttribute('data-result'), d = F[slug];
      var url = location.origin + location.pathname + '?flavor=' + slug + '#quiz';
      var text = 'My Austropical flavor is ' + d[0] + (slug === 'zero-sugar' ? ' (not a low calorie food)' : '') + '. Find yours:';
      var toast = body.querySelector('.quiz-toast');
      var say = function (m) { if (toast) { toast.textContent = m; toast.hidden = false; } };
      var file = null;
      if (fcard && fcard.slug === slug && fcard.blob) { try { file = new File([fcard.blob], 'austropical-my-flavor-' + slug + '.jpg', { type: 'image/jpeg' }); } catch (err) {} }
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'My Austropical flavor', text: text + ' ' + url }).catch(function () {});
      } else if (navigator.share) {
        navigator.share({ title: 'My Austropical flavor', text: text, url: url }).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text + ' ' + url).then(function () { say('Copied. Paste it anywhere.'); }, function () { say(url); });
      } else { say(url); }
    }
  });
  sec.hidden = false;
  var shared = null;
  try { shared = new URLSearchParams(location.search).get('flavor'); } catch (e) {}
  if (shared && F[shared]) renderResult(shared, true, false); else renderStep(0, false);
  sec.__quiz = { score: function (a) { answers = a.slice(); return score(); }, card: function (slug) { return flavorCard(slug); }, ready: function () { return !!(fcard && fcard.blob); } };
})();

// v14: smooth in-page scrolling switches on once the page has loaded (see the CSS note)
(function () {
  var de = document.documentElement;
  function on() { requestAnimationFrame(function () { de.classList.add('smooth'); }); }
  if (document.readyState === 'complete') on(); else addEventListener('load', on);
})();

// v16: Home's bowl: "Surprise me" deals one of ten named bowls, one for each flavor. Each one links into the builder,
// which opens on that exact bowl. The pictures are the builder's own layers, put together ahead of time.
(function () {
  'use strict';
  var fig = document.querySelector('.si-steps-fig'), btn = fig && fig.querySelector('[data-si-surprise]');
  if (!btn) return;
  var a = fig.querySelector('.si-steps-media'), img = a && a.querySelector('img'), source = a && a.querySelector('source'), cap = fig.querySelector('.si-steps-cap');
  if (!a || !img || !cap) return;
  var B = [
    ['amazon-works', 'The Amazon Works', 'Organic Açaí Original Sensation with granola, banana, strawberry and coconut', 'original-sensation', 'granola,banana,strawberry,coconut'],
    ['midnight-berry', 'The Midnight Berry', 'Açaí Zero Sugar (Not a low calorie food.) with strawberry', 'zero-sugar', 'strawberry'],
    ['sunrise-banana-crunch', 'The Sunrise Banana Crunch', 'Açaí Banana Sunrise with granola and banana', 'banana-sunrise', 'granola,banana'],
    ['crush-banana-berry', 'The Crush Banana Berry', 'Açaí Strawberry Crush with banana and strawberry', 'strawberry-crush', 'banana,strawberry'],
    ['coco-banana-crunch', 'The Coco Banana Crunch', 'Organic Coconut with granola and banana', 'coconut', 'granola,banana'],
    ['mango-berry-crunch', 'The Mango Berry Crunch', 'Organic Mango with granola and strawberry', 'mango', 'granola,strawberry'],
    ['passion-berry-island', 'The Passion Berry Island', 'Passionfruit with strawberry and coconut', 'passionfruit', 'strawberry,coconut'],
    ['dragon-berry-island', 'The Dragon Berry Island', 'Dragon Fruit & Pineapple with banana, strawberry and coconut', 'dragon-fruit-pineapple', 'banana,strawberry,coconut'],
    ['rosy-berry-island', 'The Rosy Berry Island', 'Pink Guava & Acerola with strawberry and coconut', 'pink-guava-acerola', 'strawberry,coconut'],
    ['cupuacu-banana-crunch', 'The Cupuaçu Banana Crunch', 'Cupuaçu & Coconut with granola and banana', 'cupuacu-coconut', 'granola,banana']
  ];
  var cur = 0, reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  btn.hidden = false;
  btn.addEventListener('click', function () {
    var i; do { i = Math.floor(Math.random() * B.length); } while (i === cur);
    var b = B[i], base = 'assets/img/bowl30/post-' + b[0], srcset = base + '-600.webp 600w, ' + base + '-1200.webp 1200w';
    var href = 'serving-ideas.html?bowl=' + b[3] + '&with=' + b[4] + '#build';
    var pre = new Image();
    pre.sizes = (source && source.getAttribute('sizes')) || '100vw'; pre.srcset = srcset; pre.src = base + '-1200.webp';
    btn.disabled = true;
    pre.onload = function () {
      cur = i;
      if (source) source.srcset = srcset;
      img.src = base + '-1200.webp';
      img.alt = 'Serving suggestion: ' + b[2] + '.';
      a.href = href; a.setAttribute('aria-label', 'Open ' + b[1] + ' in the bowl builder');
      cap.innerHTML = '<strong>' + esc(b[1]) + '.</strong> ' + esc(b[2]) + '. Serving suggestion. <a href="' + esc(href) + '">Open it in the bowl builder</a>.';
      if (!reduce) { a.classList.remove('si-shuffle'); void a.offsetWidth; a.classList.add('si-shuffle'); }
      btn.disabled = false;
    };
    pre.onerror = function () { btn.disabled = false; };
  });
})();

/* ================================================================================================================
   v27 (2 Oct 2026): the café components. Every video here is muted, plays only when it can be seen, and stops on
   request. Under reduced motion nothing plays on its own; the posters stay and the buttons still work.
   ================================================================================================================ */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function playVideo(v, onOk) {
    if (!v) { return; }
    if (v.getAttribute('preload') === 'none') { v.setAttribute('preload', 'auto'); }
    var p = v.play();
    if (p && p.then) { p.then(function () { if (onOk) { onOk(); } }).catch(function () { /* blocked: the poster stays */ }); }
    else if (onOk) { onOk(); }
  }
  function pauseVideo(v) { if (v && !v.paused) { v.pause(); } }

  /* ---------- the video wall hero ---------- */
  each(document.querySelectorAll('[data-cafe-hero]'), function (hero) {
    var tiles = Array.prototype.slice.call(hero.querySelectorAll('.cafe-hero-tile'));
    var btn = hero.querySelector('.cafe-hero-pause');
    var label = btn ? btn.querySelector('.txt') : null;
    var dots = hero.querySelectorAll('.cafe-hero-dots span');
    var mq = window.matchMedia('(max-width: 699px)');
    var paused = reduce, inView = true, timer = 0;
    var cur = parseInt(hero.getAttribute('data-start') || '0', 10) || 0;
    function onScreen(t) { var r = t.getBoundingClientRect(); return r.right > 8 && r.left < (window.innerWidth - 8); }
    function apply() {
      clearTimeout(timer);
      var mobile = mq.matches;
      tiles.forEach(function (t, i) {
        var v = t.querySelector('video');
        var show = mobile ? i === cur : onScreen(t);
        t.classList.toggle('is-current', i === cur);
        if (!paused && inView && show) { playVideo(v, function () { t.classList.add('playing'); }); }
        else { pauseVideo(v); }
      });
      each(dots, function (d, i) {
        d.classList.remove('on');
        if (i === cur && !paused && inView && mobile) { void d.offsetWidth; d.classList.add('on'); }
      });
      if (mobile && !paused && inView && tiles.length > 1) {
        timer = setTimeout(function () { cur = (cur + 1) % tiles.length; apply(); }, 6000);
      }
    }
    function setBtn() {
      if (!btn) { return; }
      btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      if (label) { label.textContent = paused ? 'Play the videos' : 'Pause the videos'; }
    }
    if (btn) {
      btn.hidden = false;
      btn.addEventListener('click', function () { paused = !paused; setBtn(); apply(); });
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { inView = e.isIntersecting; apply(); });
      }, { threshold: 0.12 }).observe(hero);
    }
    var rt = 0;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(apply, 200); });
    if (mq.addEventListener) { mq.addEventListener('change', apply); }
    document.addEventListener('visibilitychange', function () { inView = !document.hidden; apply(); });
    setBtn(); apply();
  });

  /* ---------- made to order: steps drive the sticky stage on wide screens ---------- */
  each(document.querySelectorAll('[data-cafe-steps]'), function (wrap) {
    var steps = wrap.querySelectorAll('.cafe-step');
    var items = wrap.querySelectorAll('.cafe-stage-item');
    var mq = window.matchMedia('(min-width: 960px)');
    var active = -1, stageOn = false;
    function sync() {
      each(items, function (it, k) {
        var v = it.querySelector('video');
        if (k === active && mq.matches && stageOn && !reduce) { playVideo(v, function () { it.classList.add('playing'); }); }
        else { pauseVideo(v); }
      });
    }
    function setActive(i) {
      if (i === active) { return; }
      active = i;
      each(steps, function (s, k) { s.classList.toggle('is-active', k === i); });
      each(items, function (it, k) { it.classList.toggle('is-active', k === i); });
      sync();
    }
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) { setActive(Array.prototype.indexOf.call(steps, e.target)); }
        });
      }, { rootMargin: '-45% 0px -45% 0px' });
      each(steps, function (s) { io.observe(s); });
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { stageOn = e.isIntersecting; sync(); });
      }, { threshold: 0.05 }).observe(wrap);
    }
    if (mq.addEventListener) { mq.addEventListener('change', sync); }
    setActive(0);
  });

  /* ---------- the bowls: a lightbox over the gallery (links still open the photo without it) ---------- */
  var dlg = document.getElementById('lightbox');
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-lightbox] a'));
  if (dlg && dlg.showModal && links.length) {
    var img = dlg.querySelector('.lb-stage img'), cap = dlg.querySelector('.lb-cap'), count = dlg.querySelector('.lb-count');
    var i = 0, opener = null, x0 = null;
    var show = function (k) {
      i = (k + links.length) % links.length;
      var a = links[i], thumb = a.querySelector('img');
      img.removeAttribute('srcset');
      img.src = a.getAttribute('href');
      if (a.getAttribute('data-srcset')) { img.setAttribute('srcset', a.getAttribute('data-srcset')); img.setAttribute('sizes', '(min-width: 900px) 70vw, 100vw'); }
      img.alt = thumb ? thumb.alt : '';
      cap.textContent = a.getAttribute('data-caption') || '';
      count.textContent = (i + 1) + ' of ' + links.length;
    };
    links.forEach(function (a, k) {
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
        e.preventDefault(); opener = a; show(k); dlg.showModal();
      });
    });
    dlg.querySelector('.lb-prev').addEventListener('click', function () { show(i - 1); });
    dlg.querySelector('.lb-next').addEventListener('click', function () { show(i + 1); });
    dlg.querySelector('.lb-close').addEventListener('click', function () { dlg.close(); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1); }
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) { dlg.close(); } });
    dlg.addEventListener('close', function () { if (opener) { opener.focus(); } });
    var stage = dlg.querySelector('.lb-stage');
    stage.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
    stage.addEventListener('pointerup', function (e) {
      if (x0 === null) { return; }
      var dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) { show(dx < 0 ? i + 1 : i - 1); }
    });
  }

  /* ---------- Home: the bowls run can be paused ---------- */
  each(document.querySelectorAll('.bowl-run'), function (run) {
    var b = run.querySelector('.bowl-run-toggle');
    if (!b) { return; }
    b.hidden = false;
    b.addEventListener('click', function () {
      var on = run.classList.toggle('paused');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = on ? 'Play the strip' : 'Pause the strip';
    });
  });
})();

/* ================================================================================================================
   v33 (3 Oct 2026): the Home story hero, phones to desktop. Eight café clips in five chapters (Fresh, Outside,
   Inside, Soft serve, Bowls). The clip in front plays once, then the next comes forward, round and round while the
   hero is on screen. Phones: one clip, full width, tap a side or swipe. Tablets: the carousel. Desktop: a deck, the
   next clips waiting behind the one that plays, its colours glowing round the page, and the chapters beside the
   headline. Pause stops it. If the browser will not autoplay (iOS Low Power Mode), the stills take turns every 6 s.
   Under reduced motion or Save-Data nothing moves until the visitor asks.
   ================================================================================================================ */
(function () {
  'use strict';
  var hero = document.querySelector('[data-story-hero]');
  if (!hero) { return; }
  var stage = hero.querySelector('.sh-stage');
  var cards = Array.prototype.slice.call(hero.querySelectorAll('.sh-card'));
  var n = cards.length;
  if (!stage || !n) { return; }
  var segs = Array.prototype.slice.call(hero.querySelectorAll('.sh-progress i'));
  var capT = hero.querySelector('.sh-cap-t') || hero.querySelector('.sh-cap');
  var capK = hero.querySelector('.sh-cap-k');
  var btn = hero.querySelector('.sh-pause');
  var prevB = hero.querySelector('.sh-prev'), nextB = hero.querySelector('.sh-next');
  var chapBtns = Array.prototype.slice.call(hero.querySelectorAll('.sh-chapters [data-ch]'));
  var amb = hero.querySelector('.sh-amb');
  var mq = function (q) { return window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener: null }; };
  var phone = mq('(max-width: 699px)'), desk = mq('(min-width: 960px)');
  var reduce = mq('(prefers-reduced-motion: reduce)').matches;
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  var STILL_MS = 6000;
  var cur = 0, paused = reduce || saveData, inView = false, blocked = false, raf = 0, still = 0, stillStart = 0, moved = false;
  // the chapter each clip belongs to, and the first clip of each chapter
  var chOf = cards.map(function (c) { return parseInt(c.getAttribute('data-ch') || '0', 10); });
  var chNames = chapBtns.map(function (b) { var t = b.querySelector('.t'); return t ? t.textContent : ''; });
  function chFirst(k) { for (var i = 0; i < n; i++) { if (chOf[i] === k) { return i; } } return 0; }
  function chCount(k) { return chOf.filter(function (x) { return x === k; }).length; }
  function vid(i) { return cards[i].querySelector('video'); }
  function onScreen() {
    if (document.hidden) { return false; }
    var r = stage.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var vis = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    return vis > Math.min(r.height, vh) * 0.25;
  }
  function setBtn() {
    if (!btn) { return; }
    btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    btn.setAttribute('aria-label', paused ? 'Play the café clips' : 'Pause the café clips');
  }
  function layout() {
    cards.forEach(function (c, i) {
      var d = (i - cur + n) % n;
      c.classList.toggle('is-cur', d === 0);
      c.classList.toggle('is-next', n > 2 && d === 1);
      c.classList.toggle('is-next2', n > 4 && d === 2);
      c.classList.toggle('is-next3', n > 5 && d === 3);
      c.classList.toggle('is-prev', n > 2 && d === n - 1);
      c.setAttribute('aria-hidden', d === 0 ? 'false' : 'true');
      if (desk.matches) { c.setAttribute('data-cursor', d === 0 ? 'Next clip' : 'Watch'); c.setAttribute('data-cursor-kind', 'arrow'); }
      else { c.removeAttribute('data-cursor'); c.removeAttribute('data-cursor-kind'); }
    });
    segs.forEach(function (s, i) { s.style.transform = 'scaleX(' + (i < cur ? 1 : 0) + ')'; });
    if (capT) { capT.textContent = cards[cur].getAttribute('data-cap') || ''; }
    if (capK) { capK.textContent = chNames[chOf[cur]] || ''; }
    chapBtns.forEach(function (b, k) {
      var on = k === chOf[cur];
      if (on) { b.setAttribute('aria-current', 'true'); } else { b.removeAttribute('aria-current'); }
      if (!on) { b.style.setProperty('--p', k < chOf[cur] ? '1' : '0'); }
    });
  }
  function chapterProgress(p) {
    var k = chOf[cur], b = chapBtns[k];
    if (!b) { return; }
    var first = chFirst(k), cnt = chCount(k) || 1;
    b.style.setProperty('--p', String(Math.max(0, Math.min(1, (cur - first + p) / cnt))));
  }
  function stopTimers() { if (raf) { cancelAnimationFrame(raf); } raf = 0; clearTimeout(still); still = 0; }
  function tick() {
    var s = segs[cur], v = vid(cur), p = 0;
    if (blocked) { p = (Date.now() - stillStart) / STILL_MS; }
    else if (v && v.duration) { p = v.currentTime / v.duration; }
    p = Math.max(0, Math.min(1, p));
    if (s) { s.style.transform = 'scaleX(' + p + ')'; }
    chapterProgress(p);
    raf = requestAnimationFrame(tick);
  }
  function warm(i) {
    var v = vid(i);
    if (v && v.getAttribute('preload') === 'none') { v.setAttribute('preload', 'auto'); try { v.load(); } catch (e) { /* ignore */ } }
  }

  // ---- the glow: the playing clip, drawn tiny and blurred behind the page (desktop) ----
  var actx = null, ambTimer = 0, ambOn = false;
  if (amb && amb.getContext && !reduce) { try { actx = amb.getContext('2d', { alpha: false }); } catch (e) { actx = null; } }
  function ambDraw(src) {
    if (!actx || !src) { return; }
    try { actx.drawImage(src, 0, 0, amb.width, amb.height); } catch (e) { return; }
    if (!ambOn) { ambOn = true; amb.classList.add('is-on'); }
  }
  function ambStill() {
    var img = cards[cur].querySelector('img');
    if (img && img.complete && img.naturalWidth) { ambDraw(img); }
    else if (img) { img.addEventListener('load', function once() { img.removeEventListener('load', once); if (cards[cur].contains(img)) { ambDraw(img); } }); }
  }
  function ambLoop() {
    clearTimeout(ambTimer); ambTimer = 0;
    if (!actx || !desk.matches || !inView || document.hidden) { return; }
    var v = vid(cur);
    if (v && !v.paused && v.readyState >= 2) { ambDraw(v); }
    ambTimer = setTimeout(ambLoop, 90);
  }

  function run() {
    stopTimers();
    cards.forEach(function (c, i) {
      if (i === cur) { return; }
      var v = vid(i);
      if (v && !v.paused) { v.pause(); }
      c.classList.remove('playing');
    });
    var v = vid(cur);
    if (desk.matches) { ambStill(); ambLoop(); }
    if (paused || !inView) { if (v && !v.paused) { v.pause(); } chapterProgress(blocked ? 0 : (v && v.duration ? v.currentTime / v.duration : 0)); return; }
    if (blocked || !v) {
      still = setTimeout(function () { next(false); }, Math.max(0, STILL_MS - (Date.now() - stillStart)));
      raf = requestAnimationFrame(tick);
      return;
    }
    if (v.getAttribute('preload') === 'none') { v.setAttribute('preload', 'auto'); }
    var p = v.play();
    if (p && p.then) {
      p.then(function () { warm((cur + 1) % n); }).catch(function (err) {
        if (err && err.name === 'AbortError') { return; }       // a newer play() or pause() took over
        blocked = true; stillStart = Date.now(); run();
      });
    }
    raf = requestAnimationFrame(tick);
  }
  function go(i, byUser) {
    var old = vid(cur);
    if (old && !old.paused) { old.pause(); }
    cards[cur].classList.remove('playing');
    cur = ((i % n) + n) % n;
    var v = vid(cur);
    if (v) { try { v.currentTime = 0; } catch (e) { /* not loaded yet */ } }
    var live = hero.querySelector('.sh-cap');
    if (live) { live.setAttribute('aria-live', byUser ? 'polite' : 'off'); }
    stillStart = Date.now();
    layout(); run();
  }
  function next(byUser) { go(cur + 1, byUser === true); }
  function prev() { go(cur - 1, true); }
  function toggle() {
    paused = !paused;
    if (!paused) { blocked = false; stillStart = Date.now(); inView = onScreen(); }   // a tap is a user gesture: try video again
    setBtn(); run();
  }
  cards.forEach(function (c, i) {
    var v = vid(i);
    if (v) {
      v.addEventListener('playing', function () { if (i === cur) { c.classList.add('playing'); } });
      v.addEventListener('ended', function () { if (i === cur && !paused) { next(false); } });
    }
    c.addEventListener('click', function (e) {
      if (moved) { moved = false; return; }
      if (i !== cur) { go(i, true); return; }
      if (phone.matches) {
        var r = c.getBoundingClientRect();
        if (e.clientX - r.left < r.width * 0.3) { prev(); } else { next(true); }
      } else if (desk.matches) { next(true); }
      else { toggle(); }
    });
  });
  chapBtns.forEach(function (b, k) {
    b.addEventListener('click', function () {
      if (paused && !reduce) { paused = false; setBtn(); }
      blocked = false; inView = onScreen();
      go(chFirst(k), true);
    });
  });
  if (btn) { btn.hidden = false; btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); }); }
  if (prevB) { prevB.addEventListener('click', function (e) { e.stopPropagation(); prev(); }); }
  if (nextB) { nextB.addEventListener('click', function (e) { e.stopPropagation(); next(true); }); }
  // swipe the clip (touch and pen): next or previous
  var sx = null, sy = 0;
  stage.addEventListener('pointerdown', function (e) { moved = false; if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
  stage.addEventListener('pointerup', function (e) {
    if (sx === null) { return; }
    var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) { moved = true; if (dx < 0) { next(true); } else { prev(); } }
  });
  stage.addEventListener('pointercancel', function () { sx = null; });
  stage.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); next(true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        var now = !document.hidden && en.isIntersecting && en.intersectionRatio >= 0.25;
        if (now !== inView) { inView = now; run(); }
      });
    }, { threshold: [0, 0.25, 0.5] }).observe(stage);
  } else { inView = true; }
  document.addEventListener('visibilitychange', function () {
    var now = onScreen();
    if (now !== inView) { inView = now; run(); }
  });
  if (desk.addEventListener) { desk.addEventListener('change', function () { layout(); run(); }); }
  layout(); setBtn();
  inView = onScreen(); stillStart = Date.now(); run();
})();

/* ================================================================================================================
   v32 (3 Oct 2026): the label that follows the pointer; "The Amazon, by the pint" opens the flavor you click; the Home
   video wall (desktop) and the clip viewer it opens.
   ================================================================================================================ */

// the label that follows the pointer over anything with data-cursor (mouse and trackpad only)
(function () {
  'use strict';
  if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches || !window.requestAnimationFrame) { return; }
  var badge = document.createElement('div');
  badge.className = 'cur-badge'; badge.setAttribute('aria-hidden', 'true');
  document.body.appendChild(badge);
  var x = 0, y = 0, tx = 0, ty = 0, on = false, raf = 0, label = '', kind = '';
  function paint() {
    x += (tx - x) * 0.24; y += (ty - y) * 0.24;
    badge.style.transform = 'translate3d(' + (x + 16).toFixed(1) + 'px,' + (y + 18).toFixed(1) + 'px,0)';
    if (on && (Math.abs(tx - x) > 0.3 || Math.abs(ty - y) > 0.3)) { raf = requestAnimationFrame(paint); } else { raf = 0; }
  }
  function hide() { if (on) { on = false; badge.classList.remove('is-on'); } }
  document.addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') { hide(); return; }
    var el = e.target && e.target.closest ? e.target.closest('[data-cursor]') : null;
    tx = e.clientX; ty = e.clientY;
    if (!el) { hide(); return; }
    var l = el.getAttribute('data-cursor') || '', k = el.getAttribute('data-cursor-kind') || '';
    if (l !== label) { label = l; badge.textContent = l; }
    if (k !== kind) { kind = k; badge.classList.toggle('is-arrow', k === 'arrow'); }
    if (!on) { on = true; x = tx; y = ty; badge.classList.add('is-on'); }
    if (!raf) { raf = requestAnimationFrame(paint); }
  }, { passive: true });
  window.addEventListener('scroll', hide, { passive: true });
  document.documentElement.addEventListener('mouseleave', hide);
  window.addEventListener('blur', hide);
  window.addEventListener('shv:open', hide);
})();

// "The Amazon, by the pint": a click on the pint opens that flavor's page. On the launch pair, the pint you click:
// Original Sensation is the one lower left, Mango the one upper right (centres measured on each crop of the picture).
(function () {
  'use strict';
  var hero = document.querySelector('.page-home .hero-field');
  var media = hero && hero.querySelector('.hf-media');
  var line = hero && hero.querySelector('[data-line]');
  if (!media || !line) { return; }
  var SHORT = {
    'original-sensation': 'Original Sensation', 'mango': 'Mango', 'banana-sunrise': 'Banana Sunrise', 'strawberry-crush': 'Strawberry Crush',
    'zero-sugar': 'Zero Sugar', 'coconut': 'Coconut', 'passionfruit': 'Passionfruit', 'dragon-fruit-pineapple': 'Dragon Fruit & Pineapple',
    'pink-guava-acerola': 'Pink Guava & Acerola', 'cupuacu-coconut': 'Cupuaçu & Coconut'
  };
  // aspect ratio of the crop → [Original Sensation centre, Mango centre], as fractions of the picture
  var PAIR = [[1.25, [0.46, 0.625], [0.75, 0.33]], [1.2, [0.546, 0.61], [0.79, 0.38]], [1.034, [0.54, 0.53], [0.79, 0.33]], [0.741, [0.33, 0.49], [0.67, 0.28]]];
  function shownImg() {
    var pics = media.querySelectorAll('picture'), best = null;
    for (var i = 0; i < pics.length; i++) {
      var p = pics[i];
      if (p.classList.contains('is-out')) { continue; }
      if (p.classList.contains('hf-layer') && !p.classList.contains('is-in')) { continue; }
      best = p;
    }
    return best ? best.querySelector('img') : null;
  }
  function current() { var b = line.querySelector('.lid[aria-pressed="true"]'); return b ? b.getAttribute('data-key') : 'pair'; }
  function pick(e) {
    var k = current();
    if (k !== 'pair') { return k; }
    var img = shownImg(); if (!img) { return 'original-sensation'; }
    var r = img.getBoundingClientRect(); if (!r.width || !r.height) { return 'original-sensation'; }
    var ar = r.width / r.height, v = PAIR[0];
    PAIR.forEach(function (p) { if (Math.abs(p[0] - ar) < Math.abs(v[0] - ar)) { v = p; } });
    var px = e.clientX - r.left, py = e.clientY - r.top;
    var d0 = Math.hypot(px - v[1][0] * r.width, py - v[1][1] * r.height), d1 = Math.hypot(px - v[2][0] * r.width, py - v[2][1] * r.height);
    return d0 <= d1 ? 'original-sensation' : 'mango';
  }
  media.classList.add('is-link');
  media.setAttribute('data-cursor-kind', 'arrow');
  media.setAttribute('data-cursor', 'About ' + SHORT['original-sensation']);
  media.addEventListener('pointermove', function (e) { var k = pick(e); media.setAttribute('data-cursor', 'About ' + (SHORT[k] || 'the flavors')); }, { passive: true });
  var sx = 0, sy = 0, moved = false;
  media.addEventListener('pointerdown', function (e) { sx = e.clientX; sy = e.clientY; moved = false; });
  media.addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) { moved = (e.buttons || e.pointerType !== 'mouse') ? true : moved; } }, { passive: true });
  media.addEventListener('click', function (e) {
    if (moved) { moved = false; return; }
    var k = pick(e);
    if (!SHORT[k]) { return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) { window.open('flavors/' + k + '.html', '_blank'); return; }
    window.location.href = 'flavors/' + k + '.html';
  });
})();

// the clip viewer: one clip at a time, full height, its colours glowing round it; the next clip comes in when one ends.
// Opened by the Home video wall (window.AustropicalViewer.open(index, fromElement)).
(function () {
  'use strict';
  var A = 'assets/cafe/';
  var dlg = null, wrap, frame, img, video, amb, actx, segs = [], countEl, capEl, pauseB, clips = [], cur = 0, paused = false, raf = 0, opener = null, ambId = 0, closing = false;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var SVG_X = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  var SVG_PAUSE = '<svg class="i-pause" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.6" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9.4" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg>' +
    '<svg class="i-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.2 3.3v9.4a.6.6 0 0 0 .92.5l7.3-4.7a.6.6 0 0 0 0-1L6.12 2.8a.6.6 0 0 0-.92.5z" fill="currentColor"/></svg>';
  var SVG_L = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.2 3.2 5.4 8l4.8 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_R = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.8 3.2 10.6 8l-4.8 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) { e.className = cls; } if (html) { e.innerHTML = html; } return e; }
  function build() {
    dlg = el('dialog', 'shv');
    dlg.setAttribute('aria-label', 'Clips from the Austropical café in Sydney');
    dlg.appendChild(el('div', 'shv-bg'));
    amb = el('canvas', 'shv-amb'); amb.width = 18; amb.height = 32; amb.setAttribute('aria-hidden', 'true');
    try { actx = amb.getContext('2d', { alpha: false }); } catch (err) { actx = null; }
    dlg.appendChild(amb);
    var top = el('div', 'shv-top');
    countEl = el('p', 'shv-count'); countEl.style.margin = '0';
    var prog = el('div', 'shv-prog'); prog.setAttribute('aria-hidden', 'true');
    clips.forEach(function () { var s = el('span'); var i = el('i'); s.appendChild(i); prog.appendChild(s); segs.push(i); });
    var tools = el('div', 'shv-tools');
    pauseB = el('button', 'shv-btn shv-pause', SVG_PAUSE); pauseB.type = 'button'; pauseB.setAttribute('aria-pressed', 'false'); pauseB.setAttribute('aria-label', 'Pause');
    var closeB = el('button', 'shv-btn shv-close', SVG_X); closeB.type = 'button'; closeB.setAttribute('aria-label', 'Close');
    tools.appendChild(pauseB); tools.appendChild(closeB);
    top.appendChild(countEl); top.appendChild(prog); top.appendChild(tools);
    dlg.appendChild(top);
    var stage = el('div', 'shv-stage');
    wrap = el('div', 'shv-wrap');
    frame = el('div', 'shv-frame');
    img = el('img'); img.alt = ''; img.decoding = 'async';
    video = document.createElement('video');
    video.muted = true; video.defaultMuted = true; video.setAttribute('muted', ''); video.playsInline = true; video.setAttribute('playsinline', '');
    video.preload = 'auto'; video.setAttribute('aria-hidden', 'true'); video.disablePictureInPicture = true;
    frame.appendChild(img); frame.appendChild(video);
    var hp = el('button', 'shv-hit shv-hit-prev'); hp.type = 'button'; hp.setAttribute('aria-label', 'Previous clip');
    var hn = el('button', 'shv-hit shv-hit-next'); hn.type = 'button'; hn.setAttribute('aria-label', 'Next clip');
    frame.appendChild(hp); frame.appendChild(hn);
    var ap = el('button', 'shv-btn shv-arrow shv-prev', SVG_L); ap.type = 'button'; ap.setAttribute('aria-label', 'Previous clip');
    var an = el('button', 'shv-btn shv-arrow shv-next', SVG_R); an.type = 'button'; an.setAttribute('aria-label', 'Next clip');
    wrap.appendChild(frame); wrap.appendChild(ap); wrap.appendChild(an);
    stage.appendChild(wrap);
    dlg.appendChild(stage);
    var foot = el('div', 'shv-foot');
    capEl = el('p', 'shv-cap'); capEl.setAttribute('aria-live', 'polite');
    var note = el('p', 'shv-note'); note.textContent = 'Filmed at the Austropical café in Sydney, where açaí is served as soft serve. In the US, Austropical is sorbet.';
    var cta = el('a', 'btn btn-light'); cta.href = 'cafe.html'; cta.textContent = 'Inside the café';
    foot.appendChild(capEl); foot.appendChild(note); foot.appendChild(cta);
    dlg.appendChild(foot);
    document.body.appendChild(dlg);
    // events
    hp.addEventListener('click', function () { go(cur - 1); });
    hn.addEventListener('click', function () { go(cur + 1); });
    ap.addEventListener('click', function () { go(cur - 1); });
    an.addEventListener('click', function () { go(cur + 1); });
    pauseB.addEventListener('click', toggle);
    closeB.addEventListener('click', close);
    stage.addEventListener('click', function (e) { if (e.target === stage) { close(); } });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) { close(); } });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(cur + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(cur - 1); }
      else if ((e.key === ' ' || e.key === 'k') && !(e.target && /^(BUTTON|A)$/.test(e.target.tagName) && e.key === ' ')) { e.preventDefault(); toggle(); }
    });
    video.addEventListener('playing', function () { frame.classList.add('is-playing'); });
    video.addEventListener('ended', function () { if (!paused && dlg.open) { go(cur + 1); } });
    // swipe (touch screens)
    var sx = null, sy = 0;
    frame.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') { sx = e.clientX; sy = e.clientY; } });
    frame.addEventListener('pointerup', function (e) {
      if (sx === null) { return; }
      var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) { e.preventDefault(); go(cur + (dx < 0 ? 1 : -1)); }
    });
  }
  function sources(base) {
    while (video.firstChild) { video.removeChild(video.firstChild); }
    var s1 = document.createElement('source'); s1.src = A + base + '.av1.mp4'; s1.type = 'video/mp4; codecs="av01.0.05M.08"';
    var s2 = document.createElement('source'); s2.src = A + base + '.mp4'; s2.type = 'video/mp4';
    video.appendChild(s1); video.appendChild(s2);
  }
  function paintSegs() {
    segs.forEach(function (s, i) { s.style.transform = 'scaleX(' + (i < cur ? 1 : 0) + ')'; });
  }
  function tick() {
    var s = segs[cur];
    if (s && video.duration) { s.style.transform = 'scaleX(' + Math.max(0, Math.min(1, video.currentTime / video.duration)).toFixed(4) + ')'; }
    raf = requestAnimationFrame(tick);
  }
  function drawAmb() {
    if (!actx || !dlg.open) { return; }
    try { if (video.readyState >= 2) { actx.drawImage(video, 0, 0, amb.width, amb.height); } else if (img.complete && img.naturalWidth) { actx.drawImage(img, 0, 0, amb.width, amb.height); } } catch (err) { /* not ready */ }
  }
  function ambLoop() {
    drawAmb();
    if (!dlg.open) { ambId = 0; return; }
    if (video.requestVideoFrameCallback) { ambId = video.requestVideoFrameCallback(function () { setTimeout(ambLoop, 90); }); }
    else { ambId = setTimeout(ambLoop, 120); }
  }
  function load(i, posterSrc) {
    cur = (i % clips.length + clips.length) % clips.length;
    var c = clips[cur];
    frame.classList.remove('is-playing');
    img.src = posterSrc || (A + c.full + '-poster.jpg');
    sources(c.full);
    try { video.load(); } catch (err) { /* ignore */ }
    countEl.textContent = (cur + 1) + ' / ' + clips.length;
    capEl.textContent = c.cap;
    paintSegs();
    if (!paused) { var p = video.play(); if (p && p.catch) { p.catch(function () { /* blocked: the still stays */ }); } }
    if (img.complete) { drawAmb(); } else { img.onload = drawAmb; }
  }
  function go(i) { if (!dlg || !dlg.open || closing) { return; } load(i); }
  function toggle() {
    paused = !paused;
    pauseB.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pauseB.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    if (paused) { video.pause(); } else { var p = video.play(); if (p && p.catch) { p.catch(function () {}); } }
  }
  function fromTo(fromEl) {
    var a = fromEl.getBoundingClientRect(), b = wrap.getBoundingClientRect();
    if (!a.width || !b.width) { return null; }
    var s = a.width / b.width;
    return 'translate(' + (a.left - b.left).toFixed(1) + 'px,' + (a.top - b.top).toFixed(1) + 'px) scale(' + s.toFixed(4) + ')';
  }
  function open(i, fromEl, list) {
    if (list) { clips = list; }
    if (!clips.length || !window.HTMLDialogElement) { return false; }
    if (!dlg) { build(); }
    if (dlg.open) { load(i); return true; }
    opener = fromEl || document.activeElement;
    closing = false; paused = false;
    pauseB.setAttribute('aria-pressed', 'false'); pauseB.setAttribute('aria-label', 'Pause');
    var startPoster = null;
    if (fromEl) { var ti = fromEl.querySelector('img'); if (ti) { startPoster = ti.currentSrc || ti.src; } }
    document.documentElement.classList.add('shv-lock');
    window.dispatchEvent(new CustomEvent('shv:open'));
    dlg.showModal();
    load(i, startPoster);
    requestAnimationFrame(function () {
      dlg.classList.add('is-in');
      if (!reduce && fromEl && frame.animate) {
        var t = fromTo(fromEl);
        if (t) { frame.animate([{ transform: t, borderRadius: '20px' }, { transform: 'none', borderRadius: '24px' }], { duration: 560, easing: 'cubic-bezier(.2, .8, .2, 1)' }); }
      }
      // the full clip's poster replaces the tile's once the clip is drawing
      if (startPoster) { var c = clips[cur]; setTimeout(function () { if (dlg.open) { img.src = A + c.full + '-poster.jpg'; } }, 700); }
    });
    if (!raf) { raf = requestAnimationFrame(tick); }
    if (!ambId) { ambLoop(); }
    try { dlg.querySelector('.shv-close').focus({ preventScroll: true }); } catch (err) { /* ignore */ }
    return true;
  }
  function finish() {
    if (!closing && !dlg.open) { return; }
    closing = false;
    video.pause();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    dlg.classList.remove('is-in');
    if (dlg.open) { dlg.close(); }
    document.documentElement.classList.remove('shv-lock');
    window.dispatchEvent(new CustomEvent('shv:close'));
    if (opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }
  }
  function close() {
    if (!dlg || !dlg.open || closing) { return; }
    closing = true;
    dlg.classList.remove('is-in');
    var t = (!reduce && opener && opener.getBoundingClientRect && frame.animate) ? fromTo(opener) : null;
    if (t) {
      var an = frame.animate([{ transform: 'none', borderRadius: '24px', opacity: 1 }, { transform: t, borderRadius: '20px', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.4, 0, .2, 1)' });
      an.onfinish = finish; an.oncancel = finish;
      setTimeout(function () { if (closing) { finish(); } }, 700);   // a busy page can hold the animation's end back
    } else { finish(); }
  }
  window.AustropicalViewer = { open: open, close: close };
})();

// The Home video wall (desktop). Three columns of café clips drift past (one down, two up), slowly; the pointer over
// the wall brings it to a stop, the clip under it comes forward, and a click opens it full screen. Only the clips on
// screen play; nothing plays out of view, in a hidden tab or with the viewer open. Under reduced motion the wall
// stands still and a clip plays only under the pointer; under Save-Data the wall shows its stills.
(function () {
  'use strict';
  var wall = document.querySelector('[data-wall]');
  if (!wall || !window.requestAnimationFrame || !('IntersectionObserver' in window)) { return; }
  var mq = function (q) { return window.matchMedia ? window.matchMedia(q) : { matches: false }; };
  var desk = mq('(min-width: 960px)');
  var reduce = mq('(prefers-reduced-motion: reduce)').matches;
  var saveData = mq('(prefers-reduced-data: reduce)').matches || !!(navigator.connection && navigator.connection.saveData);
  var A = 'assets/cafe/';
  var cols = [], allTiles = [], clipList = [], live = false, raf = 0, last = 0, inView = false, hovering = false, hoverTile = null, held = false, H = 0;
  var io = null, visible = [], startQ = [], startT = 0;

  function clipsFromTiles() {
    var list = [];
    Array.prototype.forEach.call(wall.querySelectorAll('.shw-tile[data-i]'), function (t) {
      var i = parseInt(t.getAttribute('data-i'), 10);
      if (!list[i]) { list[i] = { k: t.getAttribute('data-k'), full: t.getAttribute('data-full'), cap: t.getAttribute('data-cap') }; }
    });
    return list.filter(Boolean);
  }
  function moving() { return live && desk.matches && inView && !hovering && !held && !document.hidden && !reduce; }
  function canPlay(tile) { return live && desk.matches && inView && !held && !document.hidden && !saveData && (!reduce || tile === hoverTile); }

  function measure() {
    H = wall.clientHeight;
    cols.forEach(function (c) {
      var w = c.el.clientWidth;
      var th = w * 16 / 9;
      var gap = c.gap;
      var oldStep = c.step;
      c.step = th + gap;
      // enough clips in the column that one is always coming in below while one leaves at the top
      while ((c.tiles.length - 1) * c.step < H + 2) {
        var src = c.tiles[c.tiles.length % c.base];
        var cl = src.cloneNode(true);
        cl.classList.remove('is-playing');
        var v = cl.querySelector('video'); if (v) { v.parentNode.removeChild(v); }
        c.track.appendChild(cl); c.tiles.push(cl); allTiles.push(cl); bindTile(cl);
        if (io) { io.observe(cl); }
      }
      c.total = c.tiles.length * c.step;
      if (oldStep) { c.off = c.off * c.step / oldStep; } else { c.off = -c.start * c.step; }
    });
  }
  function place() {
    cols.forEach(function (c) {
      for (var i = 0; i < c.tiles.length; i++) {
        var y = ((i * c.step + c.off) % c.total + c.total) % c.total;
        if (y > c.total - c.step) { y -= c.total; }
        c.tiles[i].style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
      }
    });
  }
  function frame(t) {
    var dt = last ? Math.min(0.05, (t - last) / 1000) : 0; last = t;
    var target = moving() ? 1 : 0, settled = true;
    cols.forEach(function (c) {
      c.v += (target - c.v) * Math.min(1, dt * (target ? 1.6 : 4.2));
      if (Math.abs(target - c.v) > 0.001) { settled = false; }
      c.off += c.dir * c.speed * c.v * dt;
    });
    place();
    if (target === 0 && settled) { raf = 0; last = 0; return; }
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && live) { last = 0; raf = requestAnimationFrame(frame); } }

  function vidFor(tile) {
    var v = tile.querySelector('video');
    if (v) { return v; }
    var k = tile.getAttribute('data-k');
    v = document.createElement('video');
    v.muted = true; v.defaultMuted = true; v.setAttribute('muted', ''); v.playsInline = true; v.setAttribute('playsinline', '');
    v.loop = true; v.preload = 'auto'; v.setAttribute('aria-hidden', 'true'); v.setAttribute('tabindex', '-1'); v.disablePictureInPicture = true;
    var s1 = document.createElement('source'); s1.src = A + 'home-wall-' + k + '.av1.mp4'; s1.type = 'video/mp4; codecs="av01.0.05M.08"';
    var s2 = document.createElement('source'); s2.src = A + 'home-wall-' + k + '.mp4'; s2.type = 'video/mp4';
    v.appendChild(s1); v.appendChild(s2);
    v.addEventListener('playing', function () { tile.classList.add('is-playing'); });
    tile.insertBefore(v, tile.querySelector('.shw-cap'));
    return v;
  }
  function playTile(tile) {
    var v = vidFor(tile);
    if (!v.paused) { return; }
    var p = v.play();
    if (p && p.catch) { p.catch(function () { /* autoplay refused: the still stays */ }); }
  }
  function pauseTile(tile) { var v = tile.querySelector('video'); if (v && !v.paused) { v.pause(); } }
  // starts are spread out a little, so a screenful of clips does not all ask for data at the same instant
  function pump() {
    startT = 0;
    while (startQ.length) {
      var t = startQ.shift();
      if (visible.indexOf(t) >= 0 && canPlay(t)) { playTile(t); startT = setTimeout(pump, 160); return; }
    }
  }
  function sync() {
    allTiles.forEach(function (t) {
      var want = visible.indexOf(t) >= 0 && canPlay(t);
      if (want) { if (startQ.indexOf(t) < 0 && (!t.querySelector('video') || t.querySelector('video').paused)) { startQ.push(t); } }
      else { pauseTile(t); var qi = startQ.indexOf(t); if (qi >= 0) { startQ.splice(qi, 1); } }
    });
    if (!startT && startQ.length) { pump(); }
  }
  // a tile reached with the keyboard while it is out of sight is brought into the middle of the wall
  function reveal(tile) {
    var w = wall.getBoundingClientRect(), b = tile.getBoundingClientRect();
    if (b.top >= w.top + 8 && b.bottom <= w.bottom - 8) { return; }
    for (var i = 0; i < cols.length; i++) {
      if (cols[i].tiles.indexOf(tile) >= 0) {
        cols[i].off += (w.top + w.height / 2) - (b.top + b.height / 2);
        place(); return;
      }
    }
  }
  function bindTile(tile) {
    tile.addEventListener('focus', function () { if (live) { wall.scrollTop = 0; reveal(tile); } });
    tile.addEventListener('click', function () {
      var i = parseInt(tile.getAttribute('data-i'), 10) || 0;
      if (window.AustropicalViewer) { window.AustropicalViewer.open(i, tile, clipList); }
    });
    if (reduce) {
      tile.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { hoverTile = tile; sync(); } });
      tile.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && hoverTile === tile) { hoverTile = null; sync(); } });
    }
  }
  function start() {
    if (live || !desk.matches) { return; }
    clipList = clipsFromTiles();
    // the stills of every tile come in now (they wait as lazy images on phones, where the wall is not shown)
    Array.prototype.forEach.call(wall.querySelectorAll('.shw-tile img'), function (im) { im.loading = 'eager'; });
    Array.prototype.forEach.call(wall.querySelectorAll('.shw-col'), function (el) {
      var track = el.querySelector('.shw-track');
      var tiles = Array.prototype.slice.call(track.querySelectorAll('.shw-tile'));
      var gap = tiles.length > 1 ? (tiles[1].getBoundingClientRect().top - tiles[0].getBoundingClientRect().bottom) : 16;
      cols.push({ el: el, track: track, tiles: tiles, base: tiles.length, gap: Math.max(0, gap), dir: el.getAttribute('data-dir') === 'down' ? 1 : -1,
        speed: parseFloat(el.getAttribute('data-speed')) || 24, start: parseFloat(el.getAttribute('data-start')) || 0, off: 0, v: 0, step: 0, total: 0 });
      Array.prototype.push.apply(allTiles, tiles);
    });
    allTiles.forEach(bindTile);
    wall.classList.add('is-live');
    live = true;
    measure(); place();
    io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        var i = visible.indexOf(en.target);
        if (en.isIntersecting && i < 0) { visible.push(en.target); }
        if (!en.isIntersecting && i >= 0) { visible.splice(i, 1); }
      });
      sync();
    }, { root: wall, rootMargin: '4% 0px', threshold: 0 });
    allTiles.forEach(function (t) { io.observe(t); });
    new IntersectionObserver(function (es) {
      es.forEach(function (en) { inView = en.isIntersecting; });
      sync(); kick();
    }, { threshold: [0, 0.15] }).observe(wall);
    if (window.ResizeObserver) { new ResizeObserver(function () { if (live && desk.matches) { measure(); place(); } }).observe(wall); }
    wall.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { hovering = true; wall.classList.add('is-hover'); } });
    wall.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { hovering = false; wall.classList.remove('is-hover'); sync(); kick(); } });
    wall.addEventListener('focusin', function () { hovering = true; });
    wall.addEventListener('focusout', function (e) { if (!wall.contains(e.relatedTarget)) { hovering = false; kick(); } });
    wall.addEventListener('scroll', function () { if (wall.scrollTop) { wall.scrollTop = 0; } });   // focus must not scroll the wall itself
    document.addEventListener('visibilitychange', function () { sync(); kick(); });
    window.addEventListener('shv:open', function () { held = true; sync(); });
    window.addEventListener('shv:close', function () { held = false; sync(); kick(); });
    kick();
  }
  if (desk.matches) { start(); }
  else if (desk.addEventListener) { desk.addEventListener('change', function () { if (desk.matches) { start(); } else { sync(); } }); }
})();
