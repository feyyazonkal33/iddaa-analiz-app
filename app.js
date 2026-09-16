document.addEventListener('DOMContentLoaded', () => {
    // API Configuration
    const DEFAULT_API_KEY = '16e175a2a4a2b63d98edeeb7b904df27';
    const API_KEY_STORAGE_KEY = 'ODDS_API_KEY';
    const BASE_URL = 'https://api.the-odds-api.com/v4';

    // API-Football Configuration
    const FOOTBALL_API_BASE_URL = 'https://v3.football.api-sports.io';
    const FOOTBALL_API_KEY = '5150a62c1cb4d607dd93d6ddad6ff0c';
    const LEAGUE_SUPER_LIG_ID = 203;
    const LEAGUE_BUNDESLIGA_ID = 78;

    const STANDINGS_CACHE_KEY_PREFIX = 'FOOTBALL_STANDINGS_';
    const LIVE_MATCHES_CACHE_KEY = 'FOOTBALL_LIVE_MATCHES';
    const LIVE_MATCHES_TIME_KEY = 'FOOTBALL_LIVE_MATCHES_TIME';
    const LIVE_FETCH_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes rate limit / throttling

    const LEAGUES = [
        { key: 'soccer_turkey_super_league', footballLeagueId: LEAGUE_SUPER_LIG_ID, name: 'Süper Lig', listId: 'super-league-list', sectionId: 'league-super-league' },
        { key: 'soccer_germany_bundesliga', footballLeagueId: LEAGUE_BUNDESLIGA_ID, name: 'Bundesliga', listId: 'bundesliga-list', sectionId: 'league-bundesliga' }
    ];

    function getApiKey() {
        const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
        return (savedKey && savedKey.trim() !== '') ? savedKey.trim() : DEFAULT_API_KEY;
    }

    // App State
    let matchesData = []; // Store fetched matches across leagues
    let liveMatchesMap = new Map(); // Map key: "home_team|away_team" -> live match obj
    let isLiveModeActive = false;
    let liveAutoRefreshTimer = null;
    let currentFilterDate = 'today';
    let searchQuery = '';

    // DOM Elements
    const mainView = document.getElementById('main-view');
    const detailView = document.getElementById('detail-view');
    const standingsView = document.getElementById('standings-view');
    const settingsView = document.getElementById('settings-view');

    const backBtn = document.getElementById('back-btn');
    const standingsBackBtn = document.getElementById('standings-back-btn');
    const settingsBtn = document.querySelector('.settings-btn');
    const settingsBackBtn = document.getElementById('settings-back-btn');
    const liveBtn = document.querySelector('.live-btn');

    const apiKeyInput = document.getElementById('api-key-input');
    const saveApiKeyBtn = document.getElementById('save-api-key-btn');
    const apiKeyStatus = document.getElementById('api-key-status');
    const refreshDataBtn = document.getElementById('refresh-data-btn');

    const statusMessage = document.getElementById('status-message');
    const standingsStatus = document.getElementById('standings-status');
    const standingsTitle = document.getElementById('standings-title');
    const standingsTbody = document.getElementById('standings-tbody');

    const searchInput = document.getElementById('match-search');
    const dateTabs = document.querySelectorAll('.date-tab');
    const standingsBtns = document.querySelectorAll('.standings-btn');

    // Detail View Elements
    const detailLeagueTag = document.getElementById('detail-league-tag');
    const detailHomeTeam = document.getElementById('detail-home-team');
    const detailAwayTeam = document.getElementById('detail-away-team');
    const detailMatchTime = document.getElementById('detail-match-time');
    const detailMatchDate = document.getElementById('detail-match-date');
    const detailMarkets = document.getElementById('detail-markets');

    // Helper: Show Status Message (Loading / Error)
    function showStatus(text, type = 'loading') {
        if (!statusMessage) return;
        statusMessage.className = `status-message ${type}`;
        if (type === 'loading') {
            statusMessage.innerHTML = `<span class="spinner"></span> <span>${text}</span>`;
        } else {
            statusMessage.textContent = text;
        }
        statusMessage.classList.remove('hidden');
    }

    function hideStatus() {
        if (!statusMessage) return;
        statusMessage.classList.add('hidden');
    }

    function showStandingsStatus(text, type = 'loading') {
        if (!standingsStatus) return;
        standingsStatus.className = `status-message ${type}`;
        if (type === 'loading') {
            standingsStatus.innerHTML = `<span class="spinner"></span> <span>${text}</span>`;
        } else {
            standingsStatus.textContent = text;
        }
        standingsStatus.classList.remove('hidden');
    }

    function hideStandingsStatus() {
        if (!standingsStatus) return;
        standingsStatus.classList.add('hidden');
    }

    // Normalized String for Team Matching
    function normalizeTeamName(name) {
        if (!name) return '';
        return name.toLowerCase()
            .replace(/fc|sk|fk|spor|kulübü|klubü/g, '')
            .replace(/[\s\-_.'"]/g, '');
    }

    // API-Football: Fetch Live Matches with 3-5 Minute Caching / Throttling
    async function fetchLiveMatches(force = false) {
        const now = Date.now();
        const lastFetchTime = parseInt(localStorage.getItem(LIVE_MATCHES_TIME_KEY) || '0', 10);
        const cachedData = localStorage.getItem(LIVE_MATCHES_CACHE_KEY);

        if (!force && cachedData && (now - lastFetchTime < LIVE_FETCH_INTERVAL_MS)) {
            try {
                const parsed = JSON.parse(cachedData);
                processLiveMatchesData(parsed);
                return;
            } catch (e) {
                console.error('Failed to parse cached live matches:', e);
            }
        }

        try {
            const url = `${FOOTBALL_API_BASE_URL}/fixtures?live=all`;
            const response = await fetch(url, {
                headers: {
                    'x-apisports-key': FOOTBALL_API_KEY
                }
            });

            if (!response.ok) {
                throw new Error(`API-Football error HTTP ${response.status}`);
            }

            const result = await response.json();
            if (result && result.response) {
                localStorage.setItem(LIVE_MATCHES_CACHE_KEY, JSON.stringify(result.response));
                localStorage.setItem(LIVE_MATCHES_TIME_KEY, now.toString());
                processLiveMatchesData(result.response);
            }
        } catch (err) {
            console.error('Failed to fetch live matches:', err);
            if (cachedData) {
                try {
                    processLiveMatchesData(JSON.parse(cachedData));
                } catch (e) { }
            }
        }
    }

    function processLiveMatchesData(fixtures) {
        liveMatchesMap.clear();
        if (!Array.isArray(fixtures)) return;

        // Filter fixtures for Süper Lig (203) and Bundesliga (78)
        fixtures.forEach(item => {
            const leagueId = item.league ? item.league.id : null;
            if (leagueId === LEAGUE_SUPER_LIG_ID || leagueId === LEAGUE_BUNDESLIGA_ID) {
                const home = item.teams ? item.teams.home.name : '';
                const away = item.teams ? item.teams.away.name : '';
                const elapsed = item.fixture && item.fixture.status ? item.fixture.status.elapsed : null;
                const statusShort = item.fixture && item.fixture.status ? item.fixture.status.short : 'LIVE';
                const homeGoals = item.goals ? (item.goals.home ?? 0) : 0;
                const awayGoals = item.goals ? (item.goals.away ?? 0) : 0;

                const matchInfo = {
                    id: item.fixture ? item.fixture.id : null,
                    leagueId,
                    homeTeam: home,
                    awayTeam: away,
                    elapsed: elapsed ? `${elapsed}'` : statusShort,
                    score: `${homeGoals} - ${awayGoals}`,
                    homeGoals,
                    awayGoals
                };

                const normKey = `${normalizeTeamName(home)}|${normalizeTeamName(away)}`;
                liveMatchesMap.set(normKey, matchInfo);
                liveMatchesMap.set(`${home.toLowerCase()}|${away.toLowerCase()}`, matchInfo);
            }
        });
    }

    // Helper: Find live match for a given odds match item
    function findLiveMatchForOddsItem(match) {
        if (liveMatchesMap.size === 0) return null;

        const keyExact = `${match.home_team.toLowerCase()}|${match.away_team.toLowerCase()}`;
        if (liveMatchesMap.has(keyExact)) {
            return liveMatchesMap.get(keyExact);
        }

        const normHome = normalizeTeamName(match.home_team);
        const normAway = normalizeTeamName(match.away_team);
        const keyNorm = `${normHome}|${normAway}`;
        if (liveMatchesMap.has(keyNorm)) {
            return liveMatchesMap.get(keyNorm);
        }

        for (const [key, liveMatch] of liveMatchesMap.entries()) {
            const liveNormHome = normalizeTeamName(liveMatch.homeTeam);
            const liveNormAway = normalizeTeamName(liveMatch.awayTeam);
            if ((liveNormHome.includes(normHome) || normHome.includes(liveNormHome)) &&
                (liveNormAway.includes(normAway) || normAway.includes(liveNormAway))) {
                return liveMatch;
            }
        }

        return null;
    }

    // API-Football: Fetch Standings with 24-Hour LocalStorage Caching (Quota Protection)
    async function fetchLeagueStandings(leagueId) {
        const cacheKeyData = `${STANDINGS_CACHE_KEY_PREFIX}${leagueId}_DATA`;
        const cacheKeyTime = `${STANDINGS_CACHE_KEY_PREFIX}${leagueId}_TIME`;

        const now = Date.now();
        const lastFetchTime = parseInt(localStorage.getItem(cacheKeyTime) || '0', 10);
        const cachedData = localStorage.getItem(cacheKeyData);

        const ONE_DAY_MS = 24 * 60 * 60 * 1000;

        // Quota Protection: If cached less than 24 hours ago, use cache
        if (cachedData && (now - lastFetchTime < ONE_DAY_MS)) {
            try {
                return JSON.parse(cachedData);
            } catch (e) {
                console.error('Error parsing cached standings:', e);
            }
        }

        // Try current season first (e.g. 2024 or 2025)
        const currentYear = new Date().getFullYear();
        const seasonsToTry = [currentYear, currentYear - 1];

        for (const season of seasonsToTry) {
            try {
                const url = `${FOOTBALL_API_BASE_URL}/standings?league=${leagueId}&season=${season}`;
                const response = await fetch(url, {
                    headers: {
                        'x-apisports-key': FOOTBALL_API_KEY
                    }
                });

                if (!response.ok) continue;

                const result = await response.json();
                if (result && result.response && result.response.length > 0) {
                    const standingsData = result.response[0].league.standings[0];
                    if (standingsData && standingsData.length > 0) {
                        localStorage.setItem(cacheKeyData, JSON.stringify(standingsData));
                        localStorage.setItem(cacheKeyTime, now.toString());
                        return standingsData;
                    }
                }
            } catch (e) {
                console.error(`Error fetching standings for season ${season}:`, e);
            }
        }

        // Fallback to cached data if network failed or season query yielded empty
        if (cachedData) {
            try {
                return JSON.parse(cachedData);
            } catch (e) { }
        }

        // Return static fallback standings if API key fails or returns error
        return getFallbackStandings(leagueId);
    }

    function getFallbackStandings(leagueId) {
        if (leagueId === LEAGUE_SUPER_LIG_ID) {
            return [
                { rank: 1, team: { name: 'Galatasaray' }, all: { played: 26, win: 21, draw: 4, lose: 1 }, points: 67 },
                { rank: 2, team: { name: 'Fenerbahçe' }, all: { played: 26, win: 19, draw: 5, lose: 2 }, points: 62 },
                { rank: 3, team: { name: 'Beşiktaş' }, all: { played: 26, win: 14, draw: 6, lose: 6 }, points: 48 },
                { rank: 4, team: { name: 'Samsunspor' }, all: { played: 26, win: 14, draw: 5, lose: 7 }, points: 47 },
                { rank: 5, team: { name: 'Eyüpspor' }, all: { played: 26, win: 12, draw: 8, lose: 6 }, points: 44 },
                { rank: 6, team: { name: 'Trabzonspor' }, all: { played: 26, win: 10, draw: 9, lose: 7 }, points: 39 },
                { rank: 7, team: { name: 'Göztepe' }, all: { played: 26, win: 10, draw: 7, lose: 9 }, points: 37 },
                { rank: 8, team: { name: 'İstanbul Başakşehir' }, all: { played: 26, win: 10, draw: 6, lose: 10 }, points: 36 }
            ];
        } else if (leagueId === LEAGUE_BUNDESLIGA_ID) {
            return [
                { rank: 1, team: { name: 'Bayern München' }, all: { played: 25, win: 19, draw: 4, lose: 2 }, points: 61 },
                { rank: 2, team: { name: 'Bayer Leverkusen' }, all: { played: 25, win: 16, draw: 5, lose: 4 }, points: 53 },
                { rank: 3, team: { name: 'Eintracht Frankfurt' }, all: { played: 25, win: 14, draw: 6, lose: 5 }, points: 48 },
                { rank: 4, team: { name: 'RB Leipzig' }, all: { played: 25, win: 13, draw: 6, lose: 6 }, points: 45 },
                { rank: 5, team: { name: 'Borussia Dortmund' }, all: { played: 25, win: 12, draw: 5, lose: 8 }, points: 41 },
                { rank: 6, team: { name: 'FSV Mainz 05' }, all: { played: 25, win: 11, draw: 5, lose: 9 }, points: 38 },
                { rank: 7, team: { name: 'VfB Stuttgart' }, all: { played: 25, win: 10, draw: 7, lose: 8 }, points: 37 },
                { rank: 8, team: { name: 'SC Freiburg' }, all: { played: 25, win: 10, draw: 6, lose: 9 }, points: 36 }
            ];
        }
        return null;
    }

    // Helper: Calculate Margin-Adjusted Implied Probability (1/odds with margin adjustment)
    // Formula: Margin M = sum(1 / odds_i)
    // Adjusted Probability P_i = (1 / odds_i) / M * 100%
    function calculateProbabilities(outcomes) {
        if (!outcomes || outcomes.length === 0) return [];
        let totalImplied = 0;
        const rawImplied = outcomes.map(o => {
            const rawProb = o.price > 0 ? (1 / o.price) : 0;
            totalImplied += rawProb;
            return rawProb;
        });

        return outcomes.map((o, idx) => {
            const adjustedProb = totalImplied > 0 ? (rawImplied[idx] / totalImplied) * 100 : 0;
            return {
                ...o,
                probPercent: adjustedProb.toFixed(1)
            };
        });
    }

    // Fetch Matches for a league (markets=h2h,totals supported by list endpoint)
    async function fetchLeagueMatches(leagueKey) {
        const currentKey = getApiKey();
        const url = `${BASE_URL}/sports/${leagueKey}/odds/?apiKey=${currentKey}&regions=eu&markets=h2h,totals&oddsFormat=decimal`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`API error HTTP ${response.status}`);
        }
        return await response.json();
    }

    // Fetch full event odds including BTTS when detail view is opened or per event
    async function fetchEventDetails(sportKey, eventId) {
        try {
            const currentKey = getApiKey();
            const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/odds?apiKey=${currentKey}&regions=eu&markets=h2h,totals,btts&oddsFormat=decimal`;
            const response = await fetch(url);
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            console.error('Failed to fetch event detail odds:', e);
            return null;
        }
    }

    // Extract best/first available markets across bookmakers for a match
    function extractMarkets(match) {
        const marketsResult = {
            h2h: null,
            totals: null,
            btts: null
        };

        if (!match.bookmakers || match.bookmakers.length === 0) {
            return marketsResult;
        }

        for (const bookmaker of match.bookmakers) {
            if (!bookmaker.markets) continue;
            for (const market of bookmaker.markets) {
                if (market.key === 'h2h' && !marketsResult.h2h) {
                    marketsResult.h2h = market.outcomes;
                } else if (market.key === 'totals' && !marketsResult.totals) {
                    marketsResult.totals = market.outcomes;
                } else if (market.key === 'btts' && !marketsResult.btts) {
                    marketsResult.btts = market.outcomes;
                }
            }
        }

        return marketsResult;
    }

    // Fetch All Real Matches on Load
    async function loadAllMatches() {
        showStatus('Gerçek oranlar yükleniyor...', 'loading');
        matchesData = [];

        try {
            const results = await Promise.allSettled(
                LEAGUES.map(league => fetchLeagueMatches(league.key))
            );

            let hasError = false;

            results.forEach((res, idx) => {
                const league = LEAGUES[idx];
                if (res.status === 'fulfilled' && Array.isArray(res.value)) {
                    res.value.forEach(item => {
                        matchesData.push({
                            ...item,
                            leagueKey: league.key,
                            leagueName: league.name
                        });
                    });
                } else {
                    console.error(`Error loading ${league.name}:`, res.reason);
                    hasError = true;
                }
            });

            if (matchesData.length === 0 && hasError) {
                showStatus('Veri yüklenemedi', 'error');
                return;
            }

            hideStatus();
            renderMatches();
        } catch (err) {
            console.error('Failed to load odds data:', err);
            showStatus('Veri yüklenemedi', 'error');
        }
    }

    // Date Helper: Format date string ISO to local time & date
    function parseMatchDateTime(commenceTimeStr) {
        const dateObj = new Date(commenceTimeStr);
        const timeStr = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });

        return { dateObj, timeStr, dateStr };
    }

    // Date Filter Logic
    function isMatchInDateFilter(matchDateObj, filter) {
        if (filter === 'all') return true;

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const targetDay = new Date(matchDateObj.getFullYear(), matchDateObj.getMonth(), matchDateObj.getDate());

        const diffTime = targetDay.getTime() - today.getTime();
        const diffDays = Math.round(diffTime / (1000 * 3600 * 24));

        if (filter === 'yesterday') return diffDays === -1;
        if (filter === 'today') return diffDays === 0;
        if (filter === 'tomorrow') return diffDays === 1;

        return true;
    }

    // Render Match Cards into Main View
    function renderMatches() {
        LEAGUES.forEach(league => {
            const listEl = document.getElementById(league.listId);
            const sectionEl = document.getElementById(league.sectionId);
            if (!listEl) return;

            listEl.innerHTML = '';

            const leagueMatches = matchesData.filter(m => m.leagueKey === league.key);
            let visibleCount = 0;

            leagueMatches.forEach(match => {
                const { dateObj, timeStr, dateStr } = parseMatchDateTime(match.commence_time);

                // Date Filter Check
                if (!isMatchInDateFilter(dateObj, currentFilterDate)) {
                    return;
                }

                // Search Filter Check
                const homeName = match.home_team.toLowerCase();
                const awayName = match.away_team.toLowerCase();
                if (searchQuery && !homeName.includes(searchQuery) && !awayName.includes(searchQuery)) {
                    return;
                }

                const liveMatch = findLiveMatchForOddsItem(match);

                // If CANLI mode is active, only show live matches or show live status prominently
                if (isLiveModeActive && !liveMatch) {
                    return;
                }

                visibleCount++;

                const card = document.createElement('div');
                card.className = 'match-card';
                if (liveMatch) card.classList.add('is-live');
                card.dataset.id = match.id;

                let timeStatusHtml = `
                    <span class="match-time">${timeStr}</span>
                    <span class="match-date-sub">${dateStr.slice(0, 5)}</span>
                `;

                let centerVsHtml = `<div class="match-vs">VS</div>`;

                if (liveMatch) {
                    timeStatusHtml = `
                        <span class="live-minute-badge">${liveMatch.elapsed}</span>
                        <span class="live-tag">CANLI</span>
                    `;
                    centerVsHtml = `<div class="match-vs live-score-highlight">${liveMatch.score}</div>`;
                }

                card.innerHTML = `
                    <div class="match-time-status">
                        ${timeStatusHtml}
                    </div>
                    <div class="match-teams">
                        <div class="team home-team">
                            <span class="team-name" title="${match.home_team}">${match.home_team}</span>
                        </div>
                        ${centerVsHtml}
                        <div class="team away-team">
                            <span class="team-name" title="${match.away_team}">${match.away_team}</span>
                        </div>
                    </div>
                    <div class="match-arrow">›</div>
                `;

                card.addEventListener('click', () => openMatchDetail(match, liveMatch));
                listEl.appendChild(card);
            });

            if (visibleCount === 0) {
                listEl.innerHTML = `<div class="empty-matches">Bu kriterlere uygun maç bulunamadı.</div>`;
            }

            if (sectionEl) {
                sectionEl.style.display = 'flex';
            }
        });
    }

    // Open Match Detail View
    async function openMatchDetail(match, liveMatch = null) {
        const { timeStr, dateStr } = parseMatchDateTime(match.commence_time);

        if (detailLeagueTag) detailLeagueTag.textContent = match.leagueName;
        if (detailHomeTeam) detailHomeTeam.textContent = match.home_team;
        if (detailAwayTeam) detailAwayTeam.textContent = match.away_team;

        const vsBadge = document.querySelector('.vs-badge');
        if (vsBadge) {
            if (liveMatch) {
                vsBadge.textContent = liveMatch.score;
                vsBadge.classList.add('live-score-highlight');
            } else {
                vsBadge.textContent = 'VS';
                vsBadge.classList.remove('live-score-highlight');
            }
        }

        if (detailMatchTime) {
            detailMatchTime.textContent = liveMatch ? `CANLI (${liveMatch.elapsed})` : timeStr;
        }
        if (detailMatchDate) detailMatchDate.textContent = dateStr;

        // Render initial available markets
        renderDetailMarkets(match);

        mainView.classList.add('hidden');
        detailView.classList.remove('hidden');
        window.scrollTo(0, 0);

        // Fetch detailed event markets (including BTTS) in background if not already present
        const detailedMatch = await fetchEventDetails(match.leagueKey, match.id);
        if (detailedMatch && detailedMatch.bookmakers) {
            renderDetailMarkets(detailedMatch);
        }
    }

    // Render Markets and Implied Probabilities in Detail View
    function renderDetailMarkets(match) {
        if (!detailMarkets) return;
        detailMarkets.innerHTML = '';

        const markets = extractMarkets(match);

        // 1. Maç Sonucu (1X2 / H2H)
        renderH2HMarket(markets.h2h, match);

        // 2. Alt / Üst 2.5 (Totals)
        renderTotalsMarket(markets.totals);

        // 3. Karşılıklı Gol Var/Yok (BTTS)
        renderBTTSMarket(markets.btts);
    }

    function renderH2HMarket(h2hOutcomes, match) {
        const card = document.createElement('div');
        card.className = 'market-card';

        if (!h2hOutcomes || h2hOutcomes.length === 0) {
            card.innerHTML = `
                <div class="market-title">Maç Sonucu (1X2)</div>
                <div class="no-odds-msg">Oran verisi bulunamadı.</div>
            `;
            detailMarkets.appendChild(card);
            return;
        }

        // Standardize Outcomes Order: Home, Draw, Away
        let homeOutcome = h2hOutcomes.find(o => o.name === match.home_team);
        let awayOutcome = h2hOutcomes.find(o => o.name === match.away_team);
        let drawOutcome = h2hOutcomes.find(o => o.name === 'Draw' || o.name === 'Beraberlik');

        const orderedOutcomes = [];
        if (homeOutcome) orderedOutcomes.push({ label: '1 (Ev)', ...homeOutcome });
        if (drawOutcome) orderedOutcomes.push({ label: 'X (Beraberlik)', ...drawOutcome });
        if (awayOutcome) orderedOutcomes.push({ label: '2 (Dep)', ...awayOutcome });

        const probs = calculateProbabilities(orderedOutcomes);

        let gridHtml = probs.map(p => `
            <div class="odd-card">
                <span class="odd-label">${p.label}</span>
                <span class="odd-value">${p.price ? p.price.toFixed(2) : '-'}</span>
                <div class="prob-container">
                    <span class="prob-value">%${p.probPercent}</span>
                    <div class="prob-bar-bg">
                        <div class="prob-bar-fill" style="width: ${p.probPercent}%"></div>
                    </div>
                </div>
            </div>
        `).join('');

        card.innerHTML = `
            <div class="market-title">
                <span>Maç Sonucu (1X2)</span>
            </div>
            <div class="odds-grid cols-3">
                ${gridHtml}
            </div>
        `;

        detailMarkets.appendChild(card);
    }

    function renderTotalsMarket(totalsOutcomes) {
        const card = document.createElement('div');
        card.className = 'market-card';

        if (!totalsOutcomes || totalsOutcomes.length === 0) {
            card.innerHTML = `
                <div class="market-title">Alt / Üst (2.5 Gol)</div>
                <div class="no-odds-msg">Oran verisi bulunamadı.</div>
            `;
            detailMarkets.appendChild(card);
            return;
        }

        let overOutcome = totalsOutcomes.find(o => o.name === 'Over');
        let underOutcome = totalsOutcomes.find(o => o.name === 'Under');

        const orderedOutcomes = [];
        if (overOutcome) orderedOutcomes.push({ label: `Üst ${overOutcome.point || 2.5}`, ...overOutcome });
        if (underOutcome) orderedOutcomes.push({ label: `Alt ${underOutcome.point || 2.5}`, ...underOutcome });

        const probs = calculateProbabilities(orderedOutcomes);

        let gridHtml = probs.map(p => `
            <div class="odd-card">
                <span class="odd-label">${p.label}</span>
                <span class="odd-value">${p.price ? p.price.toFixed(2) : '-'}</span>
                <div class="prob-container">
                    <span class="prob-value">%${p.probPercent}</span>
                    <div class="prob-bar-bg">
                        <div class="prob-bar-fill" style="width: ${p.probPercent}%"></div>
                    </div>
                </div>
            </div>
        `).join('');

        card.innerHTML = `
            <div class="market-title">
                <span>Alt / Üst Gol</span>
            </div>
            <div class="odds-grid cols-2">
                ${gridHtml}
            </div>
        `;

        detailMarkets.appendChild(card);
    }

    function renderBTTSMarket(bttsOutcomes) {
        const card = document.createElement('div');
        card.className = 'market-card';

        if (!bttsOutcomes || bttsOutcomes.length === 0) {
            card.innerHTML = `
                <div class="market-title">Karşılıklı Gol (KG)</div>
                <div class="no-odds-msg">Oran verisi bulunamadı.</div>
            `;
            detailMarkets.appendChild(card);
            return;
        }

        let yesOutcome = bttsOutcomes.find(o => o.name === 'Yes');
        let noOutcome = bttsOutcomes.find(o => o.name === 'No');

        const orderedOutcomes = [];
        if (yesOutcome) orderedOutcomes.push({ label: 'KG Var', ...yesOutcome });
        if (noOutcome) orderedOutcomes.push({ label: 'KG Yok', ...noOutcome });

        const probs = calculateProbabilities(orderedOutcomes);

        let gridHtml = probs.map(p => `
            <div class="odd-card">
                <span class="odd-label">${p.label}</span>
                <span class="odd-value">${p.price ? p.price.toFixed(2) : '-'}</span>
                <div class="prob-container">
                    <span class="prob-value">%${p.probPercent}</span>
                    <div class="prob-bar-bg">
                        <div class="prob-bar-fill" style="width: ${p.probPercent}%"></div>
                    </div>
                </div>
            </div>
        `).join('');

        card.innerHTML = `
            <div class="market-title">
                <span>Karşılıklı Gol (KG)</span>
            </div>
            <div class="odds-grid cols-2">
                ${gridHtml}
            </div>
        `;

        detailMarkets.appendChild(card);
    }

    // Open Standings View
    async function openStandingsView(leagueId, leagueName) {
        if (standingsTitle) {
            standingsTitle.textContent = `${leagueName} Puan Durumu`;
        }

        if (standingsTbody) {
            standingsTbody.innerHTML = '';
        }

        mainView.classList.add('hidden');
        detailView.classList.add('hidden');
        if (settingsView) settingsView.classList.add('hidden');
        if (standingsView) standingsView.classList.remove('hidden');
        window.scrollTo(0, 0);

        showStandingsStatus('Puan durumu yükleniyor...', 'loading');

        try {
            const standings = await fetchLeagueStandings(leagueId);
            hideStandingsStatus();

            if (!standings || standings.length === 0) {
                showStandingsStatus('Puan durumu verisi bulunamadı.', 'error');
                return;
            }

            renderStandingsTable(standings);
        } catch (err) {
            console.error('Puan durumu hatası:', err);
            showStandingsStatus('Puan durumu yüklenirken bir hata oluştu.', 'error');
        }
    }

    function renderStandingsTable(standings) {
        if (!standingsTbody) return;
        standingsTbody.innerHTML = '';

        standings.forEach(row => {
            const tr = document.createElement('tr');
            const rank = row.rank || '-';
            const teamName = row.team ? row.team.name : '-';
            const logo = row.team ? row.team.logo : '';
            const played = row.all ? row.all.played : 0;
            const win = row.all ? row.all.win : 0;
            const draw = row.all ? row.all.draw : 0;
            const lose = row.all ? row.all.lose : 0;
            const points = row.points ?? 0;

            tr.innerHTML = `
                <td class="col-rank">${rank}</td>
                <td class="col-team">
                    ${logo ? `<img src="${logo}" alt="" class="team-logo-small">` : ''}
                    <span class="team-title-str">${teamName}</span>
                </td>
                <td class="col-num">${played}</td>
                <td class="col-num">${win}</td>
                <td class="col-num">${draw}</td>
                <td class="col-num">${lose}</td>
                <td class="col-num col-pts">${points}</td>
            `;

            standingsTbody.appendChild(tr);
        });
    }

    // Toggle Live Mode
    async function toggleLiveMode() {
        isLiveModeActive = !isLiveModeActive;

        if (liveBtn) {
            if (isLiveModeActive) {
                liveBtn.classList.add('active');
            } else {
                liveBtn.classList.remove('active');
            }
        }

        if (isLiveModeActive) {
            showStatus('Canlı maçlar yükleniyor...', 'loading');
            await fetchLiveMatches();
            hideStatus();
            renderMatches();

            // Set auto-refresh timer every 3 mins while live tab is open
            if (!liveAutoRefreshTimer) {
                liveAutoRefreshTimer = setInterval(async () => {
                    if (isLiveModeActive) {
                        await fetchLiveMatches();
                        renderMatches();
                    }
                }, LIVE_FETCH_INTERVAL_MS);
            }
        } else {
            if (liveAutoRefreshTimer) {
                clearInterval(liveAutoRefreshTimer);
                liveAutoRefreshTimer = null;
            }
            renderMatches();
        }
    }

    // Attach Event Listeners for Standings Buttons
    standingsBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const leagueId = parseInt(btn.dataset.leagueId, 10);
            const leagueName = btn.dataset.leagueName || 'Puan Durumu';
            openStandingsView(leagueId, leagueName);
        });
    });

    if (standingsBackBtn) {
        standingsBackBtn.addEventListener('click', () => {
            if (standingsView) standingsView.classList.add('hidden');
            mainView.classList.remove('hidden');
            window.scrollTo(0, 0);
        });
    }

    if (liveBtn) {
        liveBtn.addEventListener('click', toggleLiveMode);
    }

    // Navigation Back to Main View from Detail
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            detailView.classList.add('hidden');
            mainView.classList.remove('hidden');
            window.scrollTo(0, 0);
        });
    }

    // Settings Navigation & Logic
    function openSettings() {
        if (apiKeyInput) {
            apiKeyInput.value = getApiKey();
        }
        if (apiKeyStatus) {
            apiKeyStatus.classList.add('hidden');
        }
        mainView.classList.add('hidden');
        detailView.classList.add('hidden');
        if (settingsView) {
            settingsView.classList.remove('hidden');
        }
        window.scrollTo(0, 0);
    }

    function closeSettings() {
        if (settingsView) {
            settingsView.classList.add('hidden');
        }
        mainView.classList.remove('hidden');
        window.scrollTo(0, 0);
    }

    if (settingsBtn) {
        settingsBtn.addEventListener('click', openSettings);
    }

    if (settingsBackBtn) {
        settingsBackBtn.addEventListener('click', closeSettings);
    }

    if (saveApiKeyBtn && apiKeyInput) {
        saveApiKeyBtn.addEventListener('click', () => {
            const newKey = apiKeyInput.value.trim();
            if (!newKey) {
                if (apiKeyStatus) {
                    apiKeyStatus.textContent = 'Lütfen geçerli bir API Key giriniz.';
                    apiKeyStatus.className = 'form-help-text error';
                    apiKeyStatus.classList.remove('hidden');
                }
                return;
            }

            localStorage.setItem(API_KEY_STORAGE_KEY, newKey);
            if (apiKeyStatus) {
                apiKeyStatus.textContent = 'API Key başarıyla kaydedildi.';
                apiKeyStatus.className = 'form-help-text success';
                apiKeyStatus.classList.remove('hidden');
            }
        });
    }

    if (refreshDataBtn) {
        refreshDataBtn.addEventListener('click', () => {
            closeSettings();
            loadAllMatches();
        });
    }

    // Date Tab Selection
    dateTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            dateTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilterDate = tab.dataset.dateFilter || 'all';
            renderMatches();
        });
    });

    // Search Input Event
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.toLowerCase().trim();
            renderMatches();
        });
    }

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service Worker registered successfully:', reg.scope))
                .catch(err => console.log('Service Worker registration failed:', err));
        });
    }

    // Initial Fetch on App Start
    loadAllMatches();
});
