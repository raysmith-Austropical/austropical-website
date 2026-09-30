/* Austropical site script: nav toggle, marquee pause, poster-first videos (play on tap or in view), flavor gallery. No cookies, no tracking. */
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

  // Flavor gallery: thumbs swap the main view between the 360 video and the pack renders.
  var gallery = document.querySelector('[data-gallery]');
  if (gallery) {
    var videoBox = gallery.querySelector('.gallery-video');
    var imageBox = gallery.querySelector('.gallery-image');
    var source = imageBox ? imageBox.querySelector('source') : null;
    var img = imageBox ? imageBox.querySelector('img') : null;
    var thumbs = gallery.querySelectorAll('.thumb');
    Array.prototype.forEach.call(thumbs, function (t) {
      t.addEventListener('click', function () {
        Array.prototype.forEach.call(thumbs, function (o) { o.classList.remove('is-active'); o.setAttribute('aria-pressed', 'false'); });
        t.classList.add('is-active'); t.setAttribute('aria-pressed', 'true');
        if (t.hasAttribute('data-video')) {
          if (imageBox) { imageBox.hidden = true; }
          if (videoBox) { videoBox.hidden = false; if (!reduce) { play(videoBox); } }
        } else {
          if (videoBox) { pause(videoBox); videoBox.hidden = true; }
          if (source) { source.setAttribute('srcset', t.getAttribute('data-webp')); }
          if (img) { img.setAttribute('src', t.getAttribute('data-jpg')); img.setAttribute('alt', t.getAttribute('data-alt')); }
          if (imageBox) { imageBox.hidden = false; }
        }
      });
    });
  }
})();
