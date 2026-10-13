/* Bite For Less: progressive-enhancement, three-slide cinematic homepage hero.
   No backend keys or tracking dependencies. GitHub Releases is the only APK source. */
const SLIDES = [
  {
    title: 'Save more.<br><span>Waste less.</span>',
    text: 'Discover delicious surplus food from local bakeries, markets and restaurants. Better prices, less waste.',
    label: '01 / GOOD FOOD. BETTER LIVING.'
  },
  {
    title: 'Too good<br><span>to waste.</span>',
    text: 'Freshly prepared food deserves a second chance. Rescue local favourites before closing time.',
    label: '02 / FRESH FINDS. NEW POSSIBILITIES.'
  },
  {
    title: 'Big flavour.<br><span>Small prices.</span>',
    text: 'Save on great food from neighbourhood favourites. Every pickup supports a local business.',
    label: '03 / MORE FLAVOUR. LESS SPEND.'
  }
];
const SLIDE_DURATION = 7000;
const RELEASES_API = 'https://api.github.com/repos/ckmupazviriwo5-hue/BiteForLess-/releases/latest';
const RELEASES_PAGE = 'https://github.com/ckmupazviriwo5-hue/BiteForLess-/releases';
const APK_ASSET_PREFIX = RELEASES_PAGE + '/download/';

function initHero() {
  const hero = document.querySelector('[data-bfl-hero]');
  if (!hero) return;
  const scenes = [...hero.querySelectorAll('.bfl-hero__scene')];
  const steamVideo = hero.querySelector('[data-bfl-steam-video]');
  const dots = [...hero.querySelectorAll('[data-bfl-slide]')];
  const story = hero.querySelector('.bfl-hero__story');
  const headline = hero.querySelector('[data-bfl-headline]');
  const description = hero.querySelector('[data-bfl-description]');
  const label = hero.querySelector('[data-bfl-label]');
  const fraction = hero.querySelector('[data-bfl-fraction]');
  const announcement = hero.querySelector('[data-bfl-announcement]');
  const mediaMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let visible = true;
  let timer = null;

  function syncSteam() {
    if (!steamVideo) return;
    const mayPlay = current === 0 && !mediaMotion.matches && !document.hidden && visible;
    if (mayPlay) { const attempt = steamVideo.play(); if (attempt?.catch) attempt.catch(() => {}); }
    else steamVideo.pause();
  }
  const stop = () => { if (timer !== null) clearInterval(timer); timer = null; };
  const start = () => {
    stop();
    if (!mediaMotion.matches && !document.hidden && visible)
      timer = window.setInterval(() => activate(current + 1), SLIDE_DURATION);
    syncSteam();
  };
  function activate(index, manual = false) {
    current = (index + SLIDES.length) % SLIDES.length;
    const slide = SLIDES[current];
    scenes.forEach((scene, i) => scene.classList.toggle('is-active', i === current));
    if (current === 0 && steamVideo && index !== 0) steamVideo.currentTime = 0;
    syncSteam();
    dots.forEach((dot, i) => {
      const selected = i === current;
      dot.classList.toggle('is-active', selected);
      dot.setAttribute('aria-pressed', String(selected));
      dot.setAttribute('aria-label', 'Slide ' + (i + 1) + (selected ? ', current' : ''));
    });
    headline.innerHTML = slide.title; // constant, developer-authored HTML; never user input
    description.textContent = slide.text;
    label.textContent = slide.label;
    fraction.textContent = String(current + 1).padStart(2, '0') + ' / 03';
    story.classList.remove('is-entering');
    if (!mediaMotion.matches) {
      void story.offsetWidth;
      story.classList.add('is-entering');
    }
    if (manual) announcement.textContent = 'Slide ' + (current + 1) + ' of three: ' + headline.textContent;
  }
  function go(index) { activate(index, true); start(); }
  dots.forEach((dot, i) => dot.addEventListener('click', () => go(i)));
  hero.querySelector('[data-bfl-prev]')?.addEventListener('click', () => go(current - 1));
  hero.querySelector('[data-bfl-next]')?.addEventListener('click', () => go(current + 1));
  hero.addEventListener('keydown', (event) => {
    if (!hero.contains(document.activeElement)) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); go(current + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(current - 1); }
  });
  document.addEventListener('visibilitychange', start);
  mediaMotion.addEventListener?.('change', start);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      start();
    }, { threshold: 0.1 }).observe(hero);
  }
  activate(0);
  start();
}

function initAppInstall() {
  const button = document.querySelector('[data-bfl-install]');
  const note = document.querySelector('[data-bfl-install-note]');
  const dialog = document.getElementById('bflAppDialog');
  const modalCopy = dialog?.querySelector('[data-bfl-dialog-copy]');
  if (!button || !note) return;
  let apkUrl = null;
  let failure = false;
  dialog?.querySelector('[data-bfl-close]')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  button.addEventListener('click', () => {
    if (apkUrl) { window.location.assign(apkUrl); return; }
    if (modalCopy) modalCopy.textContent = failure
      ? 'We cannot check the Android release status right now. Visit GitHub Releases for the latest official builds.'
      : 'No official Bite For Less Android APK has been published yet. Check GitHub Releases for the first verified download.';
    dialog?.showModal();
  });
  fetch(RELEASES_API, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } })
    .then(async (response) => {
      if (response.status === 404) return null; // No published full release yet
      if (!response.ok) throw new Error('Release API unavailable');
      const release = await response.json();
      const asset = (release.assets || []).find((item) =>
        typeof item.name === 'string' && /\.apk$/i.test(item.name) &&
        item.size > 0 && item.state === 'uploaded' &&
        typeof item.browser_download_url === 'string' &&
        item.browser_download_url.startsWith(APK_ASSET_PREFIX));
      return asset ? { url: asset.browser_download_url, version: release.tag_name || 'latest' } : null;
    })
    .then((apk) => {
      if (apk) {
        apkUrl = apk.url;
        button.innerHTML = 'Install Now <span aria-hidden="true">↓</span>';
        note.textContent = 'Android ' + apk.version + ' · Official GitHub Release (.apk)';
      } else {
        button.textContent = 'Android app · Coming soon';
        note.textContent = 'No published Android APK yet. We will link the first official release here.';
      }
    })
    .catch(() => {
      failure = true;
      button.textContent = 'Check Android release';
      note.textContent = 'Release status is temporarily unavailable. Check the official GitHub Releases page.';
    });
}

initHero();
initAppInstall();
