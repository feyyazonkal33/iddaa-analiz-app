document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const mainView = document.getElementById('main-view');
    const detailView = document.getElementById('detail-view');
    const backBtn = document.getElementById('back-btn');
    const matchCards = document.querySelectorAll('.match-card');
    const detailHomeTeam = document.getElementById('detail-home-team');
    const detailAwayTeam = document.getElementById('detail-away-team');
    const dateTabs = document.querySelectorAll('.date-tab');
    const searchInput = document.getElementById('match-search');

    // Navigation to Detail View
    matchCards.forEach(card => {
        card.addEventListener('click', () => {
            const home = card.getAttribute('data-home') || 'Ev Sahibi';
            const away = card.getAttribute('data-away') || 'Deplasman';

            if (detailHomeTeam) detailHomeTeam.textContent = home;
            if (detailAwayTeam) detailAwayTeam.textContent = away;

            mainView.classList.add('hidden');
            detailView.classList.remove('hidden');
            window.scrollTo(0, 0);
        });
    });

    // Navigation back to Main View
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            detailView.classList.add('hidden');
            mainView.classList.remove('hidden');
            window.scrollTo(0, 0);
        });
    }

    // Date Tab Selection
    dateTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            dateTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
        });
    });

    // Simple Search Filter
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();

            matchCards.forEach(card => {
                const home = (card.getAttribute('data-home') || '').toLowerCase();
                const away = (card.getAttribute('data-away') || '').toLowerCase();

                if (home.includes(query) || away.includes(query)) {
                    card.style.display = 'flex';
                } else {
                    card.style.display = 'none';
                }
            });

            // Hide/show league sections if all matches are hidden
            document.querySelectorAll('.league-section').forEach(section => {
                const visibleCards = section.querySelectorAll('.match-card[style="display: flex;"], .match-card:not([style*="display: none"])');
                if (query !== '' && visibleCards.length === 0) {
                    section.style.display = 'none';
                } else {
                    section.style.display = 'flex';
                }
            });
        });
    }

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('Service Worker registered successfully:', reg.scope))
                .catch(err => console.log('Service Worker registration failed:', err));
        });
    }
});
