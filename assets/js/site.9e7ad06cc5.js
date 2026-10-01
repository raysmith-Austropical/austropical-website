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
