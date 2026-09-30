/* Austropical site script: nav toggle, marquee pause, poster-first videos (play on tap or in view), the drag-to-turn 360 viewer, flavor gallery, flavor filter count. No cookies, no tracking. */
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

  // 360 viewer: the poster is frame 0 of the pack; the 48-frame sprite loads when the viewer is in view (or on the
  // first touch). It turns on its own while in view until someone drags it, swipes it or uses the arrow keys.
  var spins = [];
  Array.prototype.forEach.call(document.querySelectorAll('.spin[data-spin]'), function (el) {
    var frames = parseInt(el.getAttribute('data-frames'), 10) || 48;
    var cols = parseInt(el.getAttribute('data-cols'), 10) || 8;
    var rows = parseInt(el.getAttribute('data-rows'), 10) || 6;
    var url = el.getAttribute('data-spin');
    var st = { frame: 0, loaded: false, loading: false, touched: false, running: false, visible: false, pending: [] };

    function show(i) {
      st.frame = ((i % frames) + frames) % frames;
      if (st.loaded) {
        var c = st.frame % cols, r = Math.floor(st.frame / cols);
        el.style.backgroundPosition = (c * 100 / (cols - 1)) + '% ' + (r * 100 / (rows - 1)) + '%';
      }
      el.setAttribute('aria-valuenow', String(st.frame));
      el.setAttribute('aria-valuetext', st.frame === 0 ? 'Front of the pack' : Math.round(st.frame * 360 / frames) + ' degrees');
    }
    function load(cb) {
      if (st.loaded) { if (cb) { cb(); } return; }
      if (cb) { st.pending.push(cb); }
      if (st.loading) { return; }
      st.loading = true;
      var im = new Image();
      im.onload = function () {
        st.loaded = true;
        el.style.backgroundImage = 'url("' + url + '")';
        el.style.backgroundSize = (cols * 100) + '% ' + (rows * 100) + '%';
        show(st.frame);
        el.classList.add('is-sprite');
        var list = st.pending; st.pending = [];
        list.forEach(function (f) { f(); });
      };
      im.onerror = function () { st.loading = false; };
      im.src = url;
    }
    var last = 0;
    function tick(t) {
      if (!st.running) { return; }
      if (t - last > 75) { last = t; show(st.frame + 1); }
      window.requestAnimationFrame(tick);
    }
    function start() {
      if (reduce || st.touched || st.running || el.closest('[hidden]')) { return; }
      load(function () {
        if (st.touched || st.running || !st.visible) { return; }
        st.running = true; last = 0; window.requestAnimationFrame(tick);
      });
    }
    function stop() { st.running = false; }
    function takeOver() { st.touched = true; stop(); el.classList.add('touched'); }

    var drag = null;
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) { return; }
      takeOver(); load();
      drag = { x: e.clientX, f: st.frame, id: e.pointerId };
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) { return; }
      var w = el.clientWidth || 320;
      show(drag.f + Math.round((e.clientX - drag.x) / w * frames));
    });
    function end() { drag = null; el.classList.remove('dragging'); }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('keydown', function (e) {
      var k = e.key, step = 0;
      if (k === 'ArrowRight' || k === 'ArrowUp') { step = 1; }
      else if (k === 'ArrowLeft' || k === 'ArrowDown') { step = -1; }
      else if (k === 'PageUp') { step = frames / 8; }
      else if (k === 'PageDown') { step = -frames / 8; }
      else if (k === 'Home') { takeOver(); load(); show(0); e.preventDefault(); return; }
      else if (k === 'End') { takeOver(); load(); show(frames / 2); e.preventDefault(); return; }
      if (step) { takeOver(); load(); show(st.frame + step); e.preventDefault(); }
    });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          st.visible = en.isIntersecting;
          if (en.isIntersecting) { start(); } else { stop(); }
        });
      }, { threshold: 0.5 }).observe(el);
    }
    spins.push({ el: el, start: start, stop: stop });
  });

  // Flavor gallery: thumbs swap the main view between the 360 viewer and the pack renders.
  var gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    var spinBox = gallery.querySelector('.gallery-spin');
    var spinCtl = null;
    spins.forEach(function (s) { if (s.el === spinBox) { spinCtl = s; } });
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
