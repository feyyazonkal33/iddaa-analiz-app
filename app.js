document.addEventListener('DOMContentLoaded', () => {
    // API Configuration
    const DEFAULT_API_KEY = '16e175a2a4a2b63d98edeeb7b904df27';
    const API_KEY_STORAGE_KEY = 'ODDS_API_KEY';
    const BASE_URL = 'https://api.the-odds-api.com/v4';

    // API-Football Configuration
    const FOOTBALL_API_BASE_URL = 'https://v3.football.api-sports.io';
    const DEFAULT_FOOTBALL_API_KEY = '04fbc6e6f1916a40d2d1ef6458945170';
    const FOOTBALL_API_KEY_STORAGE_KEY = 'FOOTBALL_API_KEY';

    // Claude API Configuration
    const CLAUDE_API_KEY_STORAGE_KEY = 'CLAUDE_API_KEY';
    const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
    const SYSTEM_PROMPT = "Sen jenerik bir asistan değilsin — tam bir usta bahisçi karaktersin. Deneyimli, kendinden emin, doğrudan konuşan bir bahis analisti gibi cevap ver. Her soruya bahis/analiz zihniyetiyle yaklaş.";
    const LEAGUE_SUPER_LIG_ID = 203;
    const LEAGUE_BUNDESLIGA_ID = 78;

    const LIVE_FETCH_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes interval for live auto-refresh timer

    const LEAGUES = [
        { key: 'soccer_turkey_super_league', footballLeagueId: LEAGUE_SUPER_LIG_ID, name: 'Süper Lig', listId: 'super-league-list', sectionId: 'league-super-league' },
        { key: 'soccer_germany_bundesliga', footballLeagueId: LEAGUE_BUNDESLIGA_ID, name: 'Bundesliga', listId: 'bundesliga-list', sectionId: 'league-bundesliga' }
    ];

    function getApiKey() {
        const savedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
        return (savedKey && savedKey.trim() !== '') ? savedKey.trim() : DEFAULT_API_KEY;
    }

    function getFootballApiKey() {
        const savedKey = localStorage.getItem(FOOTBALL_API_KEY_STORAGE_KEY);
        return (savedKey && savedKey.trim() !== '') ? savedKey.trim() : DEFAULT_FOOTBALL_API_KEY;
    }

    function getClaudeApiKey() {
        const savedKey = localStorage.getItem(CLAUDE_API_KEY_STORAGE_KEY);
        return (savedKey && savedKey.trim() !== '') ? savedKey.trim() : '';
    }

    function getCurrentSeason() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        // European football seasons start in summer (month 7 onwards)
        return month >= 7 ? year : year - 1;
    }

    // App State
    let matchesData = []; // Store fetched matches across leagues
    let liveMatchesMap = new Map(); // Map key: "home_team|away_team" -> live match obj
    let isLiveModeActive = false;
    let liveAutoRefreshTimer = null;
    let currentFilterDate = 'today';
    let searchQuery = '';
    let currentStandingsLeagueId = null;
    let currentStandingsLeagueName = '';
    let currentBaseStandings = null;

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
    const footballApiKeyInput = document.getElementById('football-api-key-input');
    const saveFootballApiKeyBtn = document.getElementById('save-football-api-key-btn');
    const footballApiKeyStatus = document.getElementById('football-api-key-status');
    const claudeApiKeyInput = document.getElementById('claude-api-key-input');
    const saveClaudeApiKeyBtn = document.getElementById('save-claude-api-key-btn');
    const claudeApiKeyStatus = document.getElementById('claude-api-key-status');
    const refreshDataBtn = document.getElementById('refresh-data-btn');

    // Voice Assistant Elements
    const voiceMicBtn = document.getElementById('voice-mic-btn');
    const voiceOverlay = document.getElementById('voice-assistant-overlay');
    const voiceCloseBtn = document.getElementById('voice-card-close');
    const voiceRecognizedText = document.getElementById('voice-recognized-text');
    const voiceStatusContainer = document.getElementById('voice-assistant-status');
    const voiceStatusLabel = document.getElementById('voice-status-label');
    const voiceResponseContainer = document.getElementById('voice-assistant-response');
    const voiceResponseText = document.getElementById('voice-response-text');

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

    // API-Football: Fetch Live Matches fresh from API without caching
    async function fetchLiveMatches() {
        try {
            const apiKey = getFootballApiKey();
            const url = `${FOOTBALL_API_BASE_URL}/fixtures?live=all`;
            const response = await fetch(url, {
                headers: {
                    'x-apisports-key': apiKey
                }
            });

            if (!response.ok) {
                console.error(`API-Football live matches error: HTTP status ${response.status}`);
                throw new Error(`API-Football error HTTP ${response.status}`);
            }

            const result = await response.json();
            if (result && result.errors && Object.keys(result.errors).length > 0) {
                const errMsgs = JSON.stringify(result.errors);
                console.error('API-Football Live Matches API Error:', result.errors);
                if (errMsgs.toLowerCase().includes('missing application key')) {
                    console.warn('FALLBACK VERİ KULLANILIYOR');
                }
            }

            if (result && result.response) {
                processLiveMatchesData(result.response);
            }
            refreshActiveStandingsIfOpen();
        } catch (err) {
            console.error('Failed to fetch live matches:', err);
        }
    }

    function processLiveMatchesData(fixtures) {
        liveMatchesMap.clear();
        if (!Array.isArray(fixtures)) return;

        // Filter fixtures for Süper Lig (203) and Bundesliga (78)
        fixtures.forEach(item => {
            const leagueId = item.league ? item.league.id : null;
            if (leagueId === LEAGUE_SUPER_LIG_ID || leagueId === LEAGUE_BUNDESLIGA_ID) {
                const home = item.teams && item.teams.home ? item.teams.home.name : '';
                const homeId = item.teams && item.teams.home ? item.teams.home.id : null;
                const away = item.teams && item.teams.away ? item.teams.away.name : '';
                const awayId = item.teams && item.teams.away ? item.teams.away.id : null;
                const elapsed = item.fixture && item.fixture.status ? item.fixture.status.elapsed : null;
                const statusShort = item.fixture && item.fixture.status ? item.fixture.status.short : 'LIVE';
                const homeGoals = item.goals ? (item.goals.home ?? 0) : 0;
                const awayGoals = item.goals ? (item.goals.away ?? 0) : 0;

                const matchInfo = {
                    id: item.fixture ? item.fixture.id : null,
                    leagueId,
                    homeTeam: home,
                    homeTeamId: homeId,
                    awayTeam: away,
                    awayTeamId: awayId,
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

    if (saveClaudeApiKeyBtn && claudeApiKeyInput) {
        saveClaudeApiKeyBtn.addEventListener('click', () => {
            const newKey = claudeApiKeyInput.value.trim();
            if (!newKey) {
                if (claudeApiKeyStatus) {
                    claudeApiKeyStatus.textContent = 'Lütfen geçerli bir API Key giriniz.';
                    claudeApiKeyStatus.className = 'form-help-text error';
                    claudeApiKeyStatus.classList.remove('hidden');
                }
                return;
            }

            localStorage.setItem(CLAUDE_API_KEY_STORAGE_KEY, newKey);
            if (claudeApiKeyStatus) {
                claudeApiKeyStatus.textContent = 'Claude API Key başarıyla kaydedildi.';
                claudeApiKeyStatus.className = 'form-help-text success';
                claudeApiKeyStatus.classList.remove('hidden');
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

    // TFF Unofficial API Scraper approach for Süper Lig Standings
    async function fetchTffSuperLigStandings() {
        const corsProxies = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ];

        let htmlText = null;

        // Try direct fetch first (works in environments without CORS restrictions e.g. WebView / PWA / extension / same-origin)
        try {
            const response = await fetch('https://www.tff.org/default.aspx?pageID=198');
            if (response.ok) {
                const buffer = await response.arrayBuffer();
                const decoder = new TextDecoder('windows-1254');
                htmlText = decoder.decode(buffer);
            }
        } catch (directErr) {
            console.warn('Direct TFF fetch skipped due to CORS/network, trying proxy fallback...');
        }

        // Try CORS proxies if direct fetch failed or threw CORS exception
        if (!htmlText) {
            const targetUrl = encodeURIComponent('https://www.tff.org/default.aspx?pageID=198');
            for (const proxyPrefix of corsProxies) {
                try {
                    const proxyUrl = `${proxyPrefix}${targetUrl}`;
                    const response = await fetch(proxyUrl);
                    if (response.ok) {
                        const text = await response.text();
                        if (text && text.includes('s-table')) {
                            htmlText = text;
                            break;
                        }
                    }
                } catch (pErr) {
                    // Try next proxy
                }
            }
        }

        if (!htmlText) {
            console.warn('FALLBACK VERİ KULLANILIYOR');
            return getFallbackStandings(LEAGUE_SUPER_LIG_ID);
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            const table = doc.querySelector('table.s-table');
            if (!table) {
                throw new Error('TFF score table not found');
            }

            const rows = table.querySelectorAll('tr');
            const standings = [];

            rows.forEach(row => {
                const cols = row.querySelectorAll('td');
                if (cols.length < 9) return;

                const rawTeamInfo = cols[0].textContent.trim();
                if (!rawTeamInfo) return;

                let rank = 0;
                let teamName = rawTeamInfo;
                const dotIdx = rawTeamInfo.indexOf('.');
                if (dotIdx !== -1 && !isNaN(rawTeamInfo.substring(0, dotIdx))) {
                    rank = parseInt(rawTeamInfo.substring(0, dotIdx), 10);
                    teamName = rawTeamInfo.substring(dotIdx + 1).trim();
                }

                if (!rank && !teamName) return;

                const played = parseInt(cols[1].textContent.trim(), 10) || 0;
                const win = parseInt(cols[2].textContent.trim(), 10) || 0;
                const draw = parseInt(cols[3].textContent.trim(), 10) || 0;
                const lose = parseInt(cols[4].textContent.trim(), 10) || 0;
                const goalsFor = parseInt(cols[5].textContent.trim(), 10) || 0;
                const goalsAgainst = parseInt(cols[6].textContent.trim(), 10) || 0;
                const goalsDiff = parseInt(cols[7].textContent.trim(), 10) || 0;
                const points = parseInt(cols[8].textContent.trim(), 10) || 0;

                standings.push({
                    rank,
                    team: { name: teamName },
                    all: {
                        played,
                        win,
                        draw,
                        lose,
                        goals: {
                            for: goalsFor,
                            against: goalsAgainst
                        }
                    },
                    goalsDiff,
                    points
                });
            });

            if (standings.length === 0) {
                throw new Error('No standings parsed from TFF');
            }

            return standings;
        } catch (e) {
            console.error('Error fetching TFF Süper Lig standings:', e);
            return getFallbackStandings(LEAGUE_SUPER_LIG_ID);
        }
    }

    // Fetch Standings: Route Süper Lig to TFF scraper, Bundesliga to API-Football
    async function fetchLeagueStandings(leagueId) {
        if (leagueId === LEAGUE_SUPER_LIG_ID) {
            return await fetchTffSuperLigStandings();
        }

        const seasonsToTry = [getCurrentSeason(), 2024, 2023, 2022];
        const uniqueSeasons = [...new Set(seasonsToTry)];

        for (const season of uniqueSeasons) {
            try {
                const apiKey = getFootballApiKey();
                const url = `${FOOTBALL_API_BASE_URL}/standings?league=${leagueId}&season=${season}`;
                const response = await fetch(url, {
                    headers: {
                        'x-apisports-key': apiKey
                    }
                });

                if (!response.ok) {
                    console.error(`API-Football standings error for league ${leagueId} (season ${season}): HTTP status ${response.status}`);
                    continue;
                }

                const result = await response.json();
                if (result && result.errors) {
                    const errorKeys = Object.keys(result.errors);
                    if (errorKeys.length > 0) {
                        const errMsgs = JSON.stringify(result.errors);
                        console.warn(`API-Football Standings API notice for league ${leagueId} (season ${season}):`, result.errors);
                        if (errMsgs.toLowerCase().includes('missing application key')) {
                            console.warn('FALLBACK VERİ KULLANILIYOR');
                        }
                    }
                }

                if (result && result.response && result.response.length > 0 && result.response[0].league && result.response[0].league.standings) {
                    const standingsGroups = result.response[0].league.standings;
                    if (Array.isArray(standingsGroups) && standingsGroups.length > 0) {
                        const standingsData = standingsGroups[0];
                        if (standingsData && standingsData.length > 0) {
                            // Deduplicate teams if necessary
                            const seenTeams = new Set();
                            const deduplicated = standingsData.filter(row => {
                                const id = row.team ? (row.team.id || row.team.name) : null;
                                if (!id || seenTeams.has(id)) return false;
                                seenTeams.add(id);
                                return true;
                            });
                            return deduplicated;
                        }
                    }
                }
            } catch (e) {
                console.error(`Error fetching standings for season ${season} league ${leagueId}:`, e);
            }
        }

        // Return static fallback standings if API key fails or returns error
        return getFallbackStandings(leagueId);
    }

    function getFallbackStandings(leagueId) {
        console.warn('FALLBACK VERİ KULLANILIYOR');
        if (leagueId === LEAGUE_SUPER_LIG_ID) {
            return [
                { rank: 1, team: { name: 'Galatasaray' }, all: { played: 26, win: 21, draw: 4, lose: 1 }, goalsDiff: 38, points: 67 },
                { rank: 2, team: { name: 'Fenerbahçe' }, all: { played: 26, win: 19, draw: 5, lose: 2 }, goalsDiff: 35, points: 62 },
                { rank: 3, team: { name: 'Beşiktaş' }, all: { played: 26, win: 14, draw: 6, lose: 6 }, goalsDiff: 18, points: 48 },
                { rank: 4, team: { name: 'Samsunspor' }, all: { played: 26, win: 14, draw: 5, lose: 7 }, goalsDiff: 12, points: 47 },
                { rank: 5, team: { name: 'Eyüpspor' }, all: { played: 26, win: 12, draw: 8, lose: 6 }, goalsDiff: 8, points: 44 },
                { rank: 6, team: { name: 'Trabzonspor' }, all: { played: 26, win: 10, draw: 9, lose: 7 }, goalsDiff: 6, points: 39 },
                { rank: 7, team: { name: 'Göztepe' }, all: { played: 26, win: 10, draw: 7, lose: 9 }, goalsDiff: 4, points: 37 },
                { rank: 8, team: { name: 'İstanbul Başakşehir' }, all: { played: 26, win: 10, draw: 6, lose: 10 }, goalsDiff: 2, points: 36 },
                { rank: 9, team: { name: 'Sivasspor' }, all: { played: 26, win: 9, draw: 8, lose: 9 }, goalsDiff: -1, points: 35 },
                { rank: 10, team: { name: 'Kasımpaşa' }, all: { played: 26, win: 8, draw: 10, lose: 8 }, goalsDiff: 0, points: 34 },
                { rank: 11, team: { name: 'Konyaspor' }, all: { played: 26, win: 8, draw: 7, lose: 11 }, goalsDiff: -5, points: 31 },
                { rank: 12, team: { name: 'Antalyaspor' }, all: { played: 26, win: 8, draw: 6, lose: 12 }, goalsDiff: -8, points: 30 },
                { rank: 13, team: { name: 'Alanyaspor' }, all: { played: 26, win: 7, draw: 8, lose: 11 }, goalsDiff: -7, points: 29 },
                { rank: 14, team: { name: 'Gaziantep FK' }, all: { played: 26, win: 7, draw: 7, lose: 12 }, goalsDiff: -9, points: 28 },
                { rank: 15, team: { name: 'Çaykur Rizespor' }, all: { played: 26, win: 7, draw: 6, lose: 13 }, goalsDiff: -14, points: 27 },
                { rank: 16, team: { name: 'Kayserispor' }, all: { played: 26, win: 6, draw: 8, lose: 12 }, goalsDiff: -15, points: 26 },
                { rank: 17, team: { name: 'Bodrum FK' }, all: { played: 26, win: 6, draw: 6, lose: 14 }, goalsDiff: -16, points: 24 },
                { rank: 18, team: { name: 'Hatayspor' }, all: { played: 26, win: 3, draw: 10, lose: 13 }, goalsDiff: -20, points: 19 }
            ];
        } else if (leagueId === LEAGUE_BUNDESLIGA_ID) {
            return [
                { rank: 1, team: { name: 'Bayern München' }, all: { played: 25, win: 19, draw: 4, lose: 2 }, goalsDiff: 48, points: 61 },
                { rank: 2, team: { name: 'Bayer Leverkusen' }, all: { played: 25, win: 16, draw: 5, lose: 4 }, goalsDiff: 24, points: 53 },
                { rank: 3, team: { name: 'Eintracht Frankfurt' }, all: { played: 25, win: 14, draw: 6, lose: 5 }, goalsDiff: 18, points: 48 },
                { rank: 4, team: { name: 'RB Leipzig' }, all: { played: 25, win: 13, draw: 6, lose: 6 }, goalsDiff: 16, points: 45 },
                { rank: 5, team: { name: 'Borussia Dortmund' }, all: { played: 25, win: 12, draw: 5, lose: 8 }, goalsDiff: 12, points: 41 },
                { rank: 6, team: { name: 'FSV Mainz 05' }, all: { played: 25, win: 11, draw: 5, lose: 9 }, goalsDiff: 7, points: 38 },
                { rank: 7, team: { name: 'VfB Stuttgart' }, all: { played: 25, win: 10, draw: 7, lose: 8 }, goalsDiff: 6, points: 37 },
                { rank: 8, team: { name: 'SC Freiburg' }, all: { played: 25, win: 10, draw: 6, lose: 9 }, goalsDiff: 1, points: 36 },
                { rank: 9, team: { name: 'Werder Bremen' }, all: { played: 25, win: 9, draw: 6, lose: 10 }, goalsDiff: -3, points: 33 },
                { rank: 10, team: { name: 'Borussia Mönchengladbach' }, all: { played: 25, win: 9, draw: 5, lose: 11 }, goalsDiff: -2, points: 32 },
                { rank: 11, team: { name: 'VfL Wolfsburg' }, all: { played: 25, win: 8, draw: 7, lose: 10 }, goalsDiff: 0, points: 31 },
                { rank: 12, team: { name: 'FC Augsburg' }, all: { played: 25, win: 8, draw: 5, lose: 12 }, goalsDiff: -11, points: 29 },
                { rank: 13, team: { name: 'Union Berlin' }, all: { played: 25, win: 6, draw: 8, lose: 11 }, goalsDiff: -10, points: 26 },
                { rank: 14, team: { name: 'FC St. Pauli' }, all: { played: 25, win: 7, draw: 4, lose: 14 }, goalsDiff: -12, points: 25 },
                { rank: 15, team: { name: 'TSG 1899 Hoffenheim' }, all: { played: 25, win: 5, draw: 7, lose: 13 }, goalsDiff: -15, points: 22 },
                { rank: 16, team: { name: '1. FC Heidenheim' }, all: { played: 25, win: 5, draw: 5, lose: 15 }, goalsDiff: -19, points: 20 },
                { rank: 17, team: { name: 'VfL Bochum' }, all: { played: 25, win: 4, draw: 5, lose: 16 }, goalsDiff: -27, points: 17 },
                { rank: 18, team: { name: 'Holstein Kiel' }, all: { played: 25, win: 3, draw: 4, lose: 18 }, goalsDiff: -32, points: 13 }
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

    // Calculate Live Standings
    function computeLiveStandings(baseStandings, leagueId) {
        if (!baseStandings || !Array.isArray(baseStandings)) return [];

        // Clone base standings data deeply so we don't mutate original
        const standingsCopy = baseStandings.map(row => ({
            rank: row.rank,
            team: {
                id: row.team ? row.team.id : null,
                name: row.team ? row.team.name : '',
                logo: row.team ? row.team.logo : ''
            },
            all: {
                played: row.all ? (row.all.played ?? 0) : 0,
                win: row.all ? (row.all.win ?? 0) : 0,
                draw: row.all ? (row.all.draw ?? 0) : 0,
                lose: row.all ? (row.all.lose ?? 0) : 0
            },
            goalsDiff: row.goalsDiff ?? (row.all && row.all.goals ? (row.all.goals.for - row.all.goals.against) : 0),
            points: row.points ?? 0,
            isLive: false
        }));

        // Deduplicate live matches by unique match id (or unique reference)
        const uniqueLiveMatchesMap = new Map();
        liveMatchesMap.forEach(liveMatch => {
            const key = liveMatch.id || `${liveMatch.homeTeam}|${liveMatch.awayTeam}`;
            if (!uniqueLiveMatchesMap.has(key)) {
                uniqueLiveMatchesMap.set(key, liveMatch);
            }
        });

        // Check active live matches for this leagueId
        uniqueLiveMatchesMap.forEach(liveMatch => {
            if (liveMatch.leagueId !== leagueId) return;

            const homeNorm = normalizeTeamName(liveMatch.homeTeam);
            const awayNorm = normalizeTeamName(liveMatch.awayTeam);

            const homeRow = standingsCopy.find(r => {
                if (r.team.id && liveMatch.homeTeamId && r.team.id === liveMatch.homeTeamId) return true;
                const norm = normalizeTeamName(r.team.name);
                return norm === homeNorm || norm.includes(homeNorm) || homeNorm.includes(norm);
            });

            const awayRow = standingsCopy.find(r => {
                if (r.team.id && liveMatch.awayTeamId && r.team.id === liveMatch.awayTeamId) return true;
                const norm = normalizeTeamName(r.team.name);
                return norm === awayNorm || norm.includes(awayNorm) || awayNorm.includes(norm);
            });

            if (homeRow) {
                homeRow.all.played += 1;
                homeRow.isLive = true;
            }

            if (awayRow) {
                awayRow.all.played += 1;
                awayRow.isLive = true;
            }

            const hG = liveMatch.homeGoals;
            const aG = liveMatch.awayGoals;
            const diff = hG - aG;

            if (hG > aG) {
                // Home winning
                if (homeRow) {
                    homeRow.all.win += 1;
                    homeRow.points += 3;
                    homeRow.goalsDiff += diff;
                }
                if (awayRow) {
                    awayRow.all.lose += 1;
                    awayRow.goalsDiff -= diff;
                }
            } else if (aG > hG) {
                // Away winning
                if (awayRow) {
                    awayRow.all.win += 1;
                    awayRow.points += 3;
                    awayRow.goalsDiff += (-diff);
                }
                if (homeRow) {
                    homeRow.all.lose += 1;
                    homeRow.goalsDiff -= (-diff);
                }
            } else {
                // Draw
                if (homeRow) {
                    homeRow.all.draw += 1;
                    homeRow.points += 1;
                }
                if (awayRow) {
                    awayRow.all.draw += 1;
                    awayRow.points += 1;
                }
            }
        });

        // Re-sort standings by Points (descending) and Goal Difference (descending)
        standingsCopy.sort((a, b) => {
            if (b.points !== a.points) {
                return b.points - a.points;
            }
            return b.goalsDiff - a.goalsDiff;
        });

        // Re-assign rank numbers dynamically based on sorted position
        standingsCopy.forEach((row, index) => {
            row.rank = index + 1;
        });

        return standingsCopy;
    }

    // Refresh active standings view if open
    function refreshActiveStandingsIfOpen() {
        if (currentStandingsLeagueId && currentBaseStandings && standingsView && !standingsView.classList.contains('hidden')) {
            const liveStandings = computeLiveStandings(currentBaseStandings, currentStandingsLeagueId);
            renderStandingsTable(liveStandings);
        }
    }

    // Open Standings View
    async function openStandingsView(leagueId, leagueName) {
        currentStandingsLeagueId = leagueId;
        currentStandingsLeagueName = leagueName;
        currentBaseStandings = null;

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
            // Fetch live matches first to get current live score state
            await fetchLiveMatches();

            const baseStandings = await fetchLeagueStandings(leagueId);
            hideStandingsStatus();

            if (!baseStandings || baseStandings.length === 0) {
                showStandingsStatus('Puan durumu verisi bulunamadı.', 'error');
                return;
            }

            currentBaseStandings = baseStandings;
            const liveStandings = computeLiveStandings(baseStandings, leagueId);
            renderStandingsTable(liveStandings);
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
            if (row.isLive) {
                tr.classList.add('is-live-row');
            }

            const rank = row.rank || '-';
            const teamName = row.team ? row.team.name : '-';
            const logo = row.team ? row.team.logo : '';
            const played = row.all ? row.all.played : 0;
            const win = row.all ? row.all.win : 0;
            const draw = row.all ? row.all.draw : 0;
            const lose = row.all ? row.all.lose : 0;
            const goalsDiff = row.goalsDiff ?? 0;
            const diffFormatted = goalsDiff > 0 ? `+${goalsDiff}` : `${goalsDiff}`;
            const points = row.points ?? 0;

            tr.innerHTML = `
                <td class="col-rank">${rank}</td>
                <td class="col-team">
                    ${logo ? `<img src="${logo}" alt="" class="team-logo-small">` : ''}
                    <span class="team-title-str" title="${teamName}">${teamName}</span>
                    ${row.isLive ? '<span class="standings-live-badge">CANLI</span>' : ''}
                </td>
                <td class="col-num">${played}</td>
                <td class="col-num">${win}</td>
                <td class="col-num">${draw}</td>
                <td class="col-num">${lose}</td>
                <td class="col-num col-av">${diffFormatted}</td>
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
            currentStandingsLeagueId = null;
            currentBaseStandings = null;
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
        if (footballApiKeyInput) {
            footballApiKeyInput.value = getFootballApiKey();
        }
        if (footballApiKeyStatus) {
            footballApiKeyStatus.classList.add('hidden');
        }
        if (claudeApiKeyInput) {
            claudeApiKeyInput.value = getClaudeApiKey();
        }
        if (claudeApiKeyStatus) {
            claudeApiKeyStatus.classList.add('hidden');
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

    if (saveFootballApiKeyBtn && footballApiKeyInput) {
        saveFootballApiKeyBtn.addEventListener('click', () => {
            const newKey = footballApiKeyInput.value.trim();
            if (!newKey) {
                if (footballApiKeyStatus) {
                    footballApiKeyStatus.textContent = 'Lütfen geçerli bir API Key giriniz.';
                    footballApiKeyStatus.className = 'form-help-text error';
                    footballApiKeyStatus.classList.remove('hidden');
                }
                return;
            }

            localStorage.setItem(FOOTBALL_API_KEY_STORAGE_KEY, newKey);
            if (footballApiKeyStatus) {
                footballApiKeyStatus.textContent = 'API-Football Key başarıyla kaydedildi.';
                footballApiKeyStatus.className = 'form-help-text success';
                footballApiKeyStatus.classList.remove('hidden');
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

    // ==========================================
    // Voice Assistant (Web Speech & Claude Integration)
    // ==========================================
    let recognition = null;
    let isRecording = false;
    let recognizedTranscript = '';
    let isSpeechSupported = false;

    // Check Web Speech API Support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
        isSpeechSupported = true;
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'tr-TR';

        recognition.onstart = () => {
            isRecording = true;
            recognizedTranscript = '';
            if (voiceMicBtn) voiceMicBtn.classList.add('listening');
            if (voiceOverlay) voiceOverlay.classList.remove('hidden');
            if (voiceRecognizedText) {
                voiceRecognizedText.classList.remove('empty');
                voiceRecognizedText.innerHTML = '<em>Dinleniyor...</em>';
            }
            if (voiceStatusContainer) voiceStatusContainer.classList.add('hidden');
            if (voiceResponseContainer) voiceResponseContainer.classList.add('hidden');
            stopSpeechSynthesis();
        };

        recognition.onresult = (event) => {
            let currentTranscript = '';
            for (let i = 0; i < event.results.length; i++) {
                currentTranscript += event.results[i][0].transcript;
            }
            recognizedTranscript = currentTranscript.trim();
            if (voiceRecognizedText && recognizedTranscript) {
                voiceRecognizedText.classList.remove('empty');
                voiceRecognizedText.textContent = recognizedTranscript;
            }
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            if (isRecording) {
                stopListening();
            }
            if (voiceRecognizedText && !recognizedTranscript) {
                voiceRecognizedText.classList.add('empty');
                voiceRecognizedText.innerHTML = `<em>Ses tanıma hatası: ${event.error}</em>`;
            }
        };

        recognition.onend = () => {
            if (isRecording) {
                // If recognition unexpectedly stopped while recording flag was true, process transcript
                isRecording = false;
                if (voiceMicBtn) voiceMicBtn.classList.remove('listening');
                processRecognizedSpeech(recognizedTranscript);
            }
        };
    } else {
        console.warn('Web Speech API (SpeechRecognition) is not supported in this browser.');
    }

    function startListening() {
        if (!isSpeechSupported) {
            alert('Tarayıcınız ses tanıma özelliğini desteklemiyor.');
            return;
        }
        if (isRecording) return;

        try {
            recognition.start();
        } catch (err) {
            console.error('Failed to start speech recognition:', err);
        }
    }

    function stopListening() {
        if (!isRecording) return;
        isRecording = false;
        if (voiceMicBtn) voiceMicBtn.classList.remove('listening');

        try {
            recognition.stop();
        } catch (err) {
            console.error('Failed to stop speech recognition:', err);
        }

        processRecognizedSpeech(recognizedTranscript);
    }

    function stopSpeechSynthesis() {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
        }
    }

    function speakText(text) {
        if (!('speechSynthesis' in window) || !text) return;

        stopSpeechSynthesis();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'tr-TR';
        utterance.rate = 1.0;

        // Try to select a Turkish voice if available
        const voices = window.speechSynthesis.getVoices();
        const trVoice = voices.find(v => v.lang.includes('tr') || v.lang.includes('TR'));
        if (trVoice) {
            utterance.voice = trVoice;
        }

        window.speechSynthesis.speak(utterance);
    }

    async function processRecognizedSpeech(transcript) {
        if (!transcript || transcript.trim() === '') {
            if (voiceRecognizedText) {
                voiceRecognizedText.classList.add('empty');
                voiceRecognizedText.innerHTML = '<em>Ses algılanamadı. Lütfen butona basılı tutarak tekrar konuşun.</em>';
            }
            return;
        }

        showVoiceStatus('Usta bahisçi düşünüyor...');

        try {
            const claudeApiKey = getClaudeApiKey();
            let assistantReply = '';

            if (claudeApiKey) {
                // Direct Call to Claude API
                const response = await fetch(CLAUDE_API_URL, {
                    method: 'POST',
                    headers: {
                        'x-api-key': claudeApiKey,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json',
                        'dangerously-allow-browser': 'true'
                    },
                    body: JSON.stringify({
                        model: 'claude-3-5-sonnet-20241022',
                        max_tokens: 500,
                        system: SYSTEM_PROMPT,
                        messages: [
                            { role: 'user', content: transcript }
                        ]
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    console.error('Claude API Error:', response.status, errData);
                    throw new Error(`Claude API HTTP ${response.status}`);
                }

                const data = await response.json();
                if (data && data.content && data.content.length > 0) {
                    assistantReply = data.content.map(item => item.text || '').join('\n');
                }
            } else {
                // Key not configured, give informative persona fallback message
                assistantReply = "Bak dostum, bahis analisti konuşuyor: Ayarlar menüsünden Claude API Key'ini tanımlamadığın için canlı Claude analizi yapamıyorum. Ama unutma, kupon yaparken her zaman disiplin ve oran analizi şarttır!";
            }

            hideVoiceStatus();
            showVoiceResponse(assistantReply);
            speakText(assistantReply);

        } catch (err) {
            console.error('Voice Assistant error:', err);
            hideVoiceStatus();
            const fallbackErrText = "Analiz yaparken bir bağlantı sorunu yaşadık patron. Oranlar çalkalanıyor olabilir, tekrar dene!";
            showVoiceResponse(fallbackErrText);
            speakText(fallbackErrText);
        }
    }

    function showVoiceStatus(text) {
        if (voiceStatusContainer) {
            if (voiceStatusLabel) voiceStatusLabel.textContent = text;
            voiceStatusContainer.classList.remove('hidden');
        }
    }

    function hideVoiceStatus() {
        if (voiceStatusContainer) {
            voiceStatusContainer.classList.add('hidden');
        }
    }

    function showVoiceResponse(text) {
        if (voiceResponseContainer && voiceResponseText) {
            voiceResponseText.textContent = text;
            voiceResponseContainer.classList.remove('hidden');
        }
    }

    // Push-to-Talk Mouse & Touch Event Listeners on Microphone Button
    if (voiceMicBtn) {
        // Mouse Events
        voiceMicBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            startListening();
        });

        voiceMicBtn.addEventListener('mouseup', (e) => {
            e.preventDefault();
            stopListening();
        });

        voiceMicBtn.addEventListener('mouseleave', (e) => {
            e.preventDefault();
            if (isRecording) {
                stopListening();
            }
        });

        // Touch Events (Mobile)
        voiceMicBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            startListening();
        });

        voiceMicBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            stopListening();
        });

        voiceMicBtn.addEventListener('touchcancel', (e) => {
            e.preventDefault();
            if (isRecording) {
                stopListening();
            }
        });
    }

    if (voiceCloseBtn) {
        voiceCloseBtn.addEventListener('click', () => {
            stopSpeechSynthesis();
            if (isRecording) {
                isRecording = false;
                if (recognition) {
                    try { recognition.stop(); } catch(e){}
                }
                if (voiceMicBtn) voiceMicBtn.classList.remove('listening');
            }
            if (voiceOverlay) voiceOverlay.classList.add('hidden');
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
