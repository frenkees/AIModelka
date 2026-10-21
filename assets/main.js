(() => {
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

    // Header: pozadí po odscrollování
    const header = $('#site-header');
    const onScroll = () => header.toggleAttribute('data-scrolled', window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    // Mobilní menu
    const menuBtn = $('#menu-btn');
    const mobileMenu = $('#mobile-menu');
    const setMenu = (open) => {
        mobileMenu.classList.toggle('hidden', !open);
        menuBtn.setAttribute('aria-expanded', open);
        menuBtn.setAttribute('aria-label', open ? 'Zavřít menu' : 'Otevřít menu');
        if (open) header.setAttribute('data-scrolled', '');
        else onScroll();
    };
    menuBtn.addEventListener('click', () => setMenu(mobileMenu.classList.contains('hidden')));
    $$('a', mobileMenu).forEach((a) => a.addEventListener('click', () => setMenu(false)));

    // Before/after slider
    const compare = $('#compare');
    if (compare) {
        const range = $('input[type="range"]', compare);
        const setPos = (v) => compare.style.setProperty('--pos', v + '%');
        range.addEventListener('input', () => setPos(range.value));
        setPos(range.value);
    }

    // Taby portfolia (ARIA tabs + šipky na klávesnici)
    const tabs = $$('[role="tab"]');
    const selectTab = (tab, focus) => {
        tabs.forEach((t) => {
            const active = t === tab;
            t.setAttribute('aria-selected', active);
            t.tabIndex = active ? 0 : -1;
            $('#' + t.getAttribute('aria-controls')).hidden = !active;
        });
        if (focus) tab.focus();
    };
    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => selectTab(tab));
        tab.addEventListener('keydown', (e) => {
            const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
            if (!dir) return;
            e.preventDefault();
            selectTab(tabs[(i + dir + tabs.length) % tabs.length], true);
        });
    });

    // Lightbox
    const lb = $('#lightbox');
    const lbImg = $('#lightbox-img');
    let gallery = [];
    let index = 0;
    const show = (i) => {
        index = (i + gallery.length) % gallery.length;
        lbImg.src = gallery[index].href;
        lbImg.alt = gallery[index].dataset.alt || '';
    };
    $$('.js-zoom').forEach((link) => {
        link.addEventListener('click', (e) => {
            if (!lb.showModal) return;
            e.preventDefault();
            gallery = $$('.js-zoom', link.closest('[role="tabpanel"]'));
            show(gallery.indexOf(link));
            lb.showModal();
        });
    });
    lb.addEventListener('click', (e) => {
        const action = e.target.closest('[data-lb]')?.dataset.lb;
        if (action === 'prev') show(index - 1);
        else if (action === 'next') show(index + 1);
        else if (action === 'close' || e.target === lb) lb.close();
    });
    lb.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') show(index - 1);
        if (e.key === 'ArrowRight') show(index + 1);
    });

    // Jemné odhalení obsahu při scrollu
    const reveals = $$('.reveal');
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    io.unobserve(entry.target);
                }
            });
        }, { rootMargin: '0px 0px -10% 0px' });
        reveals.forEach((el) => io.observe(el));

        // Sticky CTA na mobilu: jen mimo hero a kontakt
        const sticky = $('#sticky-cta');
        const hidden = new Set();
        const stickyIo = new IntersectionObserver((entries) => {
            entries.forEach((e) => (e.isIntersecting ? hidden.add(e.target) : hidden.delete(e.target)));
            sticky.toggleAttribute('data-visible', hidden.size === 0);
        });
        ['#hero', '#kontakt'].forEach((s) => stickyIo.observe($(s)));
    } else {
        reveals.forEach((el) => el.classList.add('is-visible'));
    }

    // Kontaktní formulář (web3forms přes fetch, bez přesměrování)
    const form = $('#contact-form');
    const status = $('#form-status');
    const setStatus = (ok, text) => {
        status.textContent = text;
        status.className = 'rounded-xl p-4 text-sm font-medium ' + (ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800');
    };
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('button[type="submit"]', form);
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Odesílám…';
        try {
            const res = await fetch(form.action, {
                method: 'POST',
                headers: { Accept: 'application/json' },
                body: new FormData(form),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.message);
            form.reset();
            setStatus(true, 'Děkujeme! Poptávka dorazila, ozveme se vám do jednoho pracovního dne.');
        } catch {
            setStatus(false, 'Odeslání se nepovedlo. Zkuste to prosím znovu, nebo nám napište na info@bezmodelky.cz.');
        } finally {
            btn.disabled = false;
            btn.textContent = label;
        }
    });
})();
