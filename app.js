/* ── Constants ── */
const GDB_SEARCH  = 'https://gdbrowser.com/api/search/';
const PC_API      = 'https://pointercrate.com/api/v1/demons/?limit=100';
const API_DELAY   = 2500;
const LS_HISTORY  = 'gdr-history-v1';
const LS_ACTIVE   = 'gdr-active-v2';

const DIFF_NAMES = {
    easy:        'Easy',
    normal:      'Normal',
    hard:        'Hard',
    harder:      'Harder',
    insane:      'Insane',
    easydemon:   'Easy Demon',
    mediumdemon: 'Medium Demon',
    harddemon:   'Hard Demon',
    insanedemon: 'Insane Demon',
    anydemon:    'Any Demon',
    extremedemon:'Extreme Demon',
    demonlist:   'Extreme Demon List',
};

const DIFF_MULT = {
    easy:        1,
    normal:      1.5,
    hard:        2,
    harder:      3,
    insane:      5,
    easydemon:   8,
    mediumdemon: 13,
    harddemon:   20,
    insanedemon: 35,
    anydemon:    10,
    extremedemon:50,
    demonlist:   60,
};

const SPLASH = [
    'Don\'t rage quit!', '2.2 when?', 'git gud',
    'How are your fingers?', 'ID auto-copied!',
    'Challenge accepted', 'Robtop when?', 'FINGERDASH!!!',
    'Is that buffed or nerfed?', 'One more attempt...',
    'What\'s your PB?', 'Clubstep is mid', 'GG EZ',
];

/* ── Seeded RNG ── */
let rngSeed = Math.floor(Math.random() * 1e10);

function seededRandom() {
    rngSeed = (rngSeed * 9301 + 49297) % 233280;
    return rngSeed / 233280;
}

function shuffled(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/* ── State ── */
const S = {
    mode:            null,
    apiQuery:        '',
    levelPool:       [],
    pcPool:          [],
    pages:           {},
    diffId:          '',
    diffName:        '',
    diffMult:        1,
    levelCount:      0,
    nextPct:         1,
    score:           0,
    startTime:       null,
    timerRef:        null,
    active:          false,
    elapsedOffset:   0,    // seconds already elapsed before this session (for resume)
    currentCardData: null, // {name, author, idOrNote} of the card being played
    completedLevels: [],   // saved history of completed cards for resume
};

/* ── Init ── */
document.getElementById('splash').textContent = SPLASH[Math.floor(Math.random() * SPLASH.length)];

const seedInput = document.getElementById('seed');
seedInput.value = rngSeed;
seedInput.addEventListener('change', () => {
    rngSeed = parseInt(seedInput.value) || rngSeed;
    seedInput.value = rngSeed;
});

const radios = document.getElementsByName('difficulty');
for (const r of radios) {
    r.addEventListener('change', () => {
        document.getElementById('start').disabled = false;
    });
}

// URL params
const params = new URLSearchParams(window.location.search);
for (const r of radios) {
    if (params.has(r.id)) {
        r.checked = true;
        document.getElementById('start').disabled = false;
    }
}
if (params.has('seed')) {
    const s = parseInt(params.get('seed'));
    if (!isNaN(s)) { rngSeed = s; seedInput.value = s; document.getElementById('addSeed').checked = true; }
}

refreshBestBadge();
checkSavedGame();

/* ── Copy link ── */
function copyLink() {
    const adds = [];
    for (const r of radios) { if (r.checked) { adds.push(r.id); break; } }
    if (document.getElementById('addSeed').checked) adds.push('seed=' + rngSeed);
    const url = location.href.split('?')[0] + (adds.length ? '?' + adds.join('&') : '');
    clipboardCopy(url);
    const el = document.getElementById('copy-link-text');
    el.textContent = 'Copied!';
    setTimeout(() => { el.textContent = 'Copy Link'; }, 1200);
}

/* ── Custom start toggle ── */
function toggleCustomStart() {
    const on = document.getElementById('custom-start-toggle').checked;
    document.getElementById('custom-start-fields').classList.toggle('is-hidden', !on);
}

/* ── Timer ── */
function startTimer() {
    S.startTime = Date.now();
    S.timerRef = setInterval(() => {
        const s = elapsedSecs();
        document.getElementById('live-timer').textContent =
            Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
}

function stopTimer() {
    clearInterval(S.timerRef);
    return elapsedSecs();
}

function elapsedSecs() {
    return S.elapsedOffset + (S.startTime ? Math.floor((Date.now() - S.startTime) / 1000) : 0);
}

function updateStats() {
    document.getElementById('live-score').textContent  = Math.round(S.score).toLocaleString();
    document.getElementById('live-levels').textContent = S.levelCount;
    document.getElementById('live-target').textContent = S.nextPct + '%';
}

/* ── Points ── */
function calcPoints(required, got) {
    const m         = S.diffMult;
    const base      = 5 * m;
    const overshoot = Math.max(0, got - required) * 2.5 * m;
    return base + overshoot;
}

/* ── GDB API ── */
function delay() { return new Promise(r => setTimeout(r, API_DELAY)); }

async function fetchPage(page, iter = 0) {
    const key = 'p' + page;
    if (S.pages[key]) return S.pages[key];
    await delay();
    const res = await axios.get(S.apiQuery + '&page=' + page);
    if (res.data === -1 || res.data === '-1') {
        if (iter < 5) return fetchPage(page, iter + 1);
        showError('GDBrowser rate-limited. Wait a moment and refresh.');
        throw new Error('rate-limited');
    }
    S.pages[key] = res.data;
    return res.data;
}

/* ── Start roulette ── */
async function startRoulette() {
    let selected = null;
    for (const r of radios) { if (r.checked) { selected = r; break; } }
    if (!selected) { alert('Pick a difficulty first!'); return; }

    // Custom start values
    const useCustom = document.getElementById('custom-start-toggle').checked;
    const customPct   = useCustom ? (parseInt(document.getElementById('custom-pct').value)   || 1) : 1;
    const customScore = useCustom ? (parseInt(document.getElementById('custom-score').value)  || 0) : 0;

    S.diffId          = selected.id;
    S.diffName        = DIFF_NAMES[S.diffId] || S.diffId;
    S.diffMult        = DIFF_MULT[S.diffId]  || 1;
    S.levelPool       = [];
    S.pcPool          = [];
    S.pages           = {};
    S.levelCount      = 0;
    S.nextPct         = customPct;
    S.score           = customScore;
    S.elapsedOffset   = 0;
    S.completedLevels = [];
    S.active          = true;

    clearActiveGame();

    const startBtn = document.getElementById('start');
    startBtn.classList.add('is-loading');

    try {
        if (S.diffId === 'demonlist') {
            S.mode = 'pointercrate';
            const res = await axios.get(PC_API);
            S.pcPool = shuffled(res.data).slice(0, 100);
        } else {
            S.mode = 'gdb';
            S.apiQuery = GDB_SEARCH + '*' + selected.value;
            const page0 = await fetchPage(0);
            const total = page0[0]?.results || 0;
            if (!total) { showError('No levels found for that difficulty.'); startBtn.classList.remove('is-loading'); return; }
            for (let i = 1; i <= total; i++) S.levelPool.push(i);
            S.levelPool = shuffled(S.levelPool).slice(0, 100);
        }
    } catch (e) {
        startBtn.classList.remove('is-loading');
        if (e.message !== 'rate-limited') showError('Failed to load levels. Check your connection.');
        return;
    }

    hideSettings();
    showGameUI();

    if (S.mode === 'gdb') getNextGDB();
    else getNextPC();
}

function hideSettings() {
    const el = document.getElementById('settings');
    el.classList.add('animate__fadeOut');
    setTimeout(() => el.classList.add('is-hidden'), 350);
    document.getElementById('resume-banner').classList.add('is-hidden');
}

function showGameUI() {
    document.getElementById('stats-bar').classList.remove('is-hidden');
    updateStats();
    startTimer();
}

/* ── New game / Play again ── */
function newGame() {
    clearActiveGame();
    location.reload();
}

function playAgainSame() {
    clearActiveGame();
    location.href = location.href.split('?')[0] + '?' + S.diffId;
}

/* ── GDB: next level ── */
async function getNextGDB() {
    if (S.levelPool.length === 0) { endRun(false); return; }
    const idx  = S.levelPool.shift();
    const page = Math.floor((idx - 1) / 10);
    const pos  = (idx - 1) % 10;

    let level;
    try {
        const data = await fetchPage(page);
        level = data[pos];
    } catch { return; }

    if (!level) { getNextGDB(); return; }
    appendCard(level.name, level.author, String(level.id), 'completeGDB');
}

/* ── Pointercrate: next level ── */
function getNextPC() {
    if (S.pcPool.length === 0) { endRun(false); return; }
    const lvl = S.pcPool.shift();
    if (!lvl) { getNextPC(); return; }
    const author = lvl.publisher?.name || 'Unknown';
    const note   = lvl.verifier?.name ? `Verified by ${lvl.verifier.name}` : '';
    appendCard(lvl.name, author, note, 'completePC');
}

/* ── Append card ── */
function appendCard(name, author, idOrNote, completeFunc) {
    S.levelCount++;
    S.currentCardData = { name, author, idOrNote };

    const card = document.createElement('div');
    card.className = 'level-card animate__animated animate__fadeInUpBig';

    const subLine = idOrNote
        ? `By ${esc(author)} · <span style="opacity:.5">${esc(idOrNote)}</span>`
        : `By ${esc(author)}`;

    card.innerHTML = `
        <div class="level-meta">
            <div class="level-num">Level #${S.levelCount}</div>
            <div class="level-name">${esc(name)}</div>
            <div class="level-sub">${subLine}</div>
        </div>
        <div class="level-action" id="current-action">
            <input type="number" class="gd-input" id="pct-input"
                placeholder="Min ${S.nextPct}%" min="${S.nextPct}" max="100"
                onkeydown="if(event.key==='Enter') ${completeFunc}()">
            <div class="action-btns">
                <button class="gd-btn-success" onclick="${completeFunc}()">Complete</button>
                <button class="gd-btn-danger"  onclick="giveUp()">Give Up</button>
            </div>
        </div>
    `;

    document.getElementById('levels').appendChild(card);
    if (idOrNote && /^\d+$/.test(idOrNote)) clipboardCopy(idOrNote);
    card.scrollIntoView({ behavior: 'smooth', block: 'end' });
    document.getElementById('pct-input').focus();
}

/* ── Append a read-only (already completed) card — used when resuming ── */
function appendLockedCard(level) {
    const card = document.createElement('div');
    card.className = 'level-card is-done';

    const subLine = level.idOrNote
        ? `By ${esc(level.author)} · <span style="opacity:.5">${esc(level.idOrNote)}</span>`
        : `By ${esc(level.author)}`;

    const overshootLine = level.wasOvershoot
        ? `<div class="done-overshoot">Overshoot (half pts on extra %)</div>` : '';

    card.innerHTML = `
        <div class="level-meta">
            <div class="level-num">Level #${card._num}</div>
            <div class="level-name">${esc(level.name)}</div>
            <div class="level-sub">${subLine}</div>
        </div>
        <div class="level-done">
            <div class="done-percent">${level.pct}%</div>
            <div class="done-points">+${Math.round(level.pts)} pts</div>
            ${overshootLine}
        </div>
    `;

    document.getElementById('levels').appendChild(card);
    // fix level number after appending
    card.querySelector('.level-num').textContent = `Level #${level.num}`;
}

/* ── Complete handlers ── */
function completeGDB() { handleComplete(() => getNextGDB()); }
function completePC()  { handleComplete(() => getNextPC()); }

function handleComplete(next) {
    const input = document.getElementById('pct-input');
    if (!input) return;
    const pct = parseInt(input.value);

    if (isNaN(pct) || pct < S.nextPct || pct > 100) {
        input.style.borderColor = 'var(--red)';
        setTimeout(() => { input.style.borderColor = ''; }, 800);
        return;
    }

    const required = S.nextPct;
    const pts = calcPoints(required, pct);
    S.score += pts;

    lockAction(pct, pts, pct > required);

    S.nextPct = pct + 1;
    updateStats();
    saveActiveGame();

    if (pct >= 100) { endRun(false); return; }
    const poolEmpty = S.mode === 'gdb' ? S.levelPool.length === 0 : S.pcPool.length === 0;
    if (poolEmpty) { endRun(false); return; }

    next();
}

/* ── Lock completed action div ── */
function lockAction(pct, pts, wasOvershoot) {
    const el = document.getElementById('current-action');
    if (!el) return;
    el.removeAttribute('id');

    // Record for resume
    if (S.currentCardData) {
        S.completedLevels.push({ ...S.currentCardData, num: S.levelCount, pct, pts, wasOvershoot });
    }

    const overshootLine = wasOvershoot
        ? `<div class="done-overshoot">Overshoot (half pts on extra %)</div>` : '';
    el.innerHTML = `
        <div class="level-done">
            <div class="done-percent">${pct}%</div>
            <div class="done-points">+${Math.round(pts)} pts</div>
            ${overshootLine}
        </div>
    `;
    el.closest('.level-card')?.classList.add('is-done');
}

/* ── Give up ── */
function giveUp() { endRun(true); }

/* ── End run ── */
function endRun(givenUp) {
    if (!S.active) return;
    S.active = false;
    const elapsed    = stopTimer();
    const highestPct = S.nextPct - 1;
    const score      = Math.round(S.score);

    const dangling = document.getElementById('current-action');
    if (dangling) {
        dangling.removeAttribute('id');
        dangling.innerHTML = givenUp
            ? `<div class="level-done"><div class="done-percent" style="color:var(--red)">Given up</div></div>`
            : `<div class="level-done"><div class="done-percent">${highestPct}%</div></div>`;
        dangling.closest('.level-card')?.classList.add('is-done');
    }

    clearActiveGame();
    saveRun({ date: new Date().toISOString(), diff: S.diffName, levels: S.levelCount, score, highestPct, elapsed, givenUp });

    const mins     = Math.floor(elapsed / 60);
    const secs     = elapsed % 60;
    const complete = highestPct >= 100;

    const el = document.createElement('div');
    el.className = 'results-card animate__animated animate__fadeInUpBig';
    el.innerHTML = `
        <div class="results-title">${complete ? 'Roulette Complete!' : givenUp ? 'Given Up' : 'Run Over'}</div>
        <div class="results-diff">${S.diffName}</div>
        <div class="results-grid">
            <div class="results-stat">
                <div class="results-stat-value">${score.toLocaleString()}</div>
                <div class="results-stat-label">Total Score</div>
            </div>
            <div class="results-stat">
                <div class="results-stat-value">${S.levelCount}</div>
                <div class="results-stat-label">Levels Cleared</div>
            </div>
            <div class="results-stat">
                <div class="results-stat-value">${highestPct}%</div>
                <div class="results-stat-label">Highest %</div>
            </div>
            <div class="results-stat">
                <div class="results-stat-value">${mins}m ${secs}s</div>
                <div class="results-stat-label">Time</div>
            </div>
        </div>
        <div class="results-btns">
            <button class="gd-btn" onclick="newGame()">New Game</button>
            <button class="gd-btn-outline" onclick="playAgainSame()">Same Difficulty</button>
        </div>
    `;
    document.getElementById('levels').appendChild(el);
    el.scrollIntoView({ behavior: 'smooth' });
    refreshBestBadge();
}

/* ══════════════════════════════════════════
   Active game save / resume
══════════════════════════════════════════ */

function saveActiveGame() {
    if (!S.active) return;
    try {
        const save = {
            v: 2,
            ts: Date.now(),
            mode:            S.mode,
            diffId:          S.diffId,
            diffName:        S.diffName,
            diffMult:        S.diffMult,
            rngSeed,
            apiQuery:        S.apiQuery,
            nextPct:         S.nextPct,
            score:           S.score,
            levelCount:      S.levelCount,
            elapsedSecs:     elapsedSecs(),
            levelPool:       S.levelPool,
            pcPool:          S.pcPool,
            completedLevels: S.completedLevels,
        };
        localStorage.setItem(LS_ACTIVE, JSON.stringify(save));
    } catch {}
}

function clearActiveGame() {
    localStorage.removeItem(LS_ACTIVE);
}

function checkSavedGame() {
    try {
        const raw = localStorage.getItem(LS_ACTIVE);
        if (!raw) return;
        const save = JSON.parse(raw);
        if (!save || save.v !== 2) { clearActiveGame(); return; }

        const banner = document.getElementById('resume-banner');
        document.getElementById('resume-diff').textContent   = save.diffName;
        document.getElementById('resume-detail').textContent =
            `Level ${save.levelCount} · ${Math.round(save.score).toLocaleString()} pts · Next: ${save.nextPct}%`;
        banner.classList.remove('is-hidden');
    } catch { clearActiveGame(); }
}

function resumeGame() {
    try {
        const save = JSON.parse(localStorage.getItem(LS_ACTIVE));
        if (!save) return;

        // Restore state
        S.mode            = save.mode;
        S.diffId          = save.diffId;
        S.diffName        = save.diffName;
        S.diffMult        = save.diffMult;
        S.apiQuery        = save.apiQuery;
        S.nextPct         = save.nextPct;
        S.score           = save.score;
        S.levelCount      = save.levelCount;
        S.levelPool       = save.levelPool || [];
        S.pcPool          = save.pcPool    || [];
        S.pages           = {};
        S.completedLevels = save.completedLevels || [];
        S.elapsedOffset   = save.elapsedSecs || 0;
        S.active          = true;
        rngSeed           = save.rngSeed;

        // Re-render completed level cards
        for (const level of S.completedLevels) {
            appendLockedCard(level);
        }

        hideSettings();
        showGameUI();

        if (S.mode === 'gdb') getNextGDB();
        else getNextPC();

    } catch (e) {
        clearActiveGame();
        showError('Could not resume saved game. Starting fresh.');
    }
}

function discardGame() {
    clearActiveGame();
    document.getElementById('resume-banner').classList.add('is-hidden');
}

/* ══════════════════════════════════════════
   Run history
══════════════════════════════════════════ */

function saveRun(run) {
    const hist = loadHistory();
    hist.unshift(run);
    if (hist.length > 100) hist.pop();
    localStorage.setItem(LS_HISTORY, JSON.stringify(hist));
}

function loadHistory() {
    try { return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { return []; }
}

function refreshBestBadge() {
    const hist  = loadHistory();
    const badge = document.getElementById('best-badge');
    if (!hist.length) { badge.textContent = ''; return; }
    const best = Math.max(...hist.map(r => r.score));
    badge.textContent = `Best Score: ${best.toLocaleString()} pts`;
}

function showHistory() {
    const hist = loadHistory();
    const body = document.getElementById('history-body');

    if (!hist.length) {
        body.innerHTML = '<div class="history-empty">No runs yet. Play a roulette!</div>';
    } else {
        const best  = Math.max(...hist.map(r => r.score));
        const total = hist.length;
        const entries = hist.map(run => {
            const d    = new Date(run.date).toLocaleDateString();
            const mins = Math.floor(run.elapsed / 60);
            const secs = run.elapsed % 60;
            return `<div class="history-entry">
                <div>
                    <span class="history-diff">${run.diff}</span>
                    <span class="history-date" style="margin-left:8px">${d}</span>
                </div>
                <div>
                    <div class="history-score">${run.score.toLocaleString()} pts</div>
                    <div class="history-sub">${run.levels} lvls · ${run.highestPct}% · ${mins}m${String(secs).padStart(2,'0')}s</div>
                </div>
            </div>`;
        }).join('');

        body.innerHTML = `
            <div class="history-summary">
                Best: <strong>${best.toLocaleString()} pts</strong> &nbsp;·&nbsp; ${total} run${total !== 1 ? 's' : ''}
            </div>
            ${entries}
        `;
    }

    document.getElementById('history-modal').classList.add('is-active');
}

function closeHistory() {
    document.getElementById('history-modal').classList.remove('is-active');
}

function clearHistory() {
    if (!confirm('Clear all run history?')) return;
    localStorage.removeItem(LS_HISTORY);
    closeHistory();
    refreshBestBadge();
}

/* ── Error modal ── */
function showError(msg) {
    document.getElementById('error-content').textContent = msg;
    document.getElementById('error-modal').classList.add('is-active');
}

/* ── Helpers ── */
function esc(str) {
    return String(str)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function clipboardCopy(text) {
    try {
        const el = document.getElementById('copypaste');
        el.value = text; el.select();
        document.execCommand('copy');
    } catch {}
}

/* ── GDB status check ── */
setTimeout(async () => {
    try {
        const res = await axios.get(GDB_SEARCH + '*');
        if (res.data === -1 || res.data === '-1')
            showError('GDBrowser appears to be down right now. Levels may not load.');
    } catch {}
}, 0);
