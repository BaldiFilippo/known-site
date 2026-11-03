// Smooth scrolling (Lenis) and animated FAQ answers. Both stay off with reduced motion.
(function () {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  if (window.Lenis) {
    document.documentElement.style.scrollBehavior = 'auto';
    const lenis = new Lenis({ lerp: 0.1 });
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(performance.now());
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      const target = id === '#' ? 0 : document.querySelector(id);
      if (target === null) return;
      e.preventDefault();
      lenis.scrollTo(target, { duration: 1.2 });
      if (id !== '#') history.replaceState(null, '', id);
    });
  }

  const ease = 'cubic-bezier(.22,.61,.36,1)';
  document.querySelectorAll('.faq details').forEach(d => {
    const summary = d.querySelector('summary');
    let anim = null;
    summary.addEventListener('click', e => {
      e.preventDefault();
      const opening = !d.open || d.classList.contains('closing');
      const from = d.offsetHeight;
      if (anim) anim.cancel();
      d.open = opening;
      const to = d.offsetHeight;
      d.open = true;
      d.classList.toggle('closing', !opening);
      d.style.overflow = 'hidden';
      anim = d.animate({ height: [from + 'px', to + 'px'] }, { duration: 380, easing: ease });
      anim.onfinish = () => {
        anim = null;
        d.style.overflow = '';
        if (!opening) { d.open = false; d.classList.remove('closing'); }
      };
      const answer = d.querySelector('p');
      if (answer && opening) answer.animate({ opacity: [0, 1], transform: ['translateY(-4px)', 'none'] }, { duration: 380, easing: ease });
    });
  });
})();
