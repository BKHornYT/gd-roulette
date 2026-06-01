/* ── Constants ── */
const GDB_SEARCH  = 'https://gdbrowser.com/api/search/';
const PC_API      = 'https://pointercrate.com/api/v1/demons/?limit=100';
const API_DELAY   = 2500; // ms between GDB requests

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
    'Don\'t rage quit!',
    '2.2 when?',
    'git gud',
    'How are your fingers?',
    'ID auto-copied!',
    'Challenge accepted',
    'Robtop when?',
    'FINGERDASH!!!',
    'Is that buffed or nerfed?',
    'One more attempt...',
    'What\'s your PB?',
    'Clubstep is mid',
    'GG EZ',
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
    mode:       null,   // 'gdb' | 'pointercrate'
    apiQuery:   '',
    levelPool:  [],     // array of 1-based indices (gdb mode)
    pcPool:     [],     // array of pointercrate level objects
    pages:      {},     // cache: page index → array of level objects
    diffId:     '',
    diffName:   '',
    diffMult:   1,
    levelCount: 0,
    nextPct:    1,      // minimum % the player must achieve
    score:      0,
    startTime:  null,
    timerRef:   null,
    active:     false,
};

/* ── Init ── */
document.getElementById('splash').textContent = SPLASH[Math.floor(Math.random() * SPLASH.length)];

const seedInput = document.getElementById('seed');
seedInput.value = rngSeed;
seedInput.addEventListener('change', () => {
    rngSeed = parseInt(seedInput.value) || rngSeed;
    seedInput.value = rngSeed;
});

// Difficulty radio enable start button
const radios = document.getElementsByName('difficulty');
for (const r of radios) {
    r.addEventListener('change', () => {
        document.getElementById('start').disabled = false;
    });
}

// URL params: pre-select difficulty and seed
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

// Show best score in header
refreshBestBadge();

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

/* ── Timer ── */
function startTimer() {
    S.startTime = Date.now();
    S.timerRef = setInterval(() => {
        const secs = elapsedSecs();
        document.getElementById('live-timer').textContent =
            Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    }, 1000);
}

function stopTimer() {
    clearInterval(S.timerRef);
    return elapsedSecs();
}

function elapsedSecs() {
    return S.startTime ? Math.floor((Date.now() - S.startTime) / 1000) : 0;
}

function updateStats() {
    document.getElementById('live-score').textContent  = Math.round(S.score).toLocaleString();
    document.getElementById('live-levels').textContent = S.levelCount;
    document.getElementById('live-target').textContent = S.nextPct + '%';
}

/* ── Points ── */
function calcPoints(required, got) {
    const m = S.diffMult;
    const exact    = 5 * m;
    const overshoot = Math.max(0, got - required) * 2.5 * m;
    return exact + overshoot;
}

/* ── GDB API helpers ── */
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

    S.diffId   = selected.id;
    S.diffName = DIFF_NAMES[S.diffId] || S.diffId;
    S.diffMult = DIFF_MULT[S.diffId]  || 1;
    S.levelPool = [];
    S.pcPool    = [];
    S.pages     = {};
    S.levelCount = 0;
    S.nextPct    = 1;
    S.score      = 0;
    S.active     = true;

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
            if (!total) { showError('No levels found for that difficulty.'); return; }
            for (let i = 1; i <= total; i++) S.levelPool.push(i);
            S.levelPool = shuffled(S.levelPool).slice(0, 100);
        }
    } catch (e) {
        startBtn.classList.remove('is-loading');
        if (e.message !== 'rate-limited') showError('Failed to load levels. Check your connection.');
        return;
    }

    // Hide settings
    const settings = document.getElementById('settings');
    settings.classList.add('animate__fadeOut');
    setTimeout(() => settings.classList.add('is-hidden'), 350);

    // Show stats bar
    document.getElementById('stats-bar').classList.remove('is-hidden');
    updateStats();
    startTimer();

    // First level
    if (S.mode === 'gdb') getNextGDB();
    else getNextPC();
}

/* ── GDB: get next level ── */
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
    appendCard(level.name, level.author, level.id, 'completeGDB');
}

/* ── Pointercrate: get next level ── */
function getNextPC() {
    if (S.pcPool.length === 0) { endRun(false); return; }
    const lvl = S.pcPool.shift();
    if (!lvl) { getNextPC(); return; }
    const author = lvl.publisher?.name || 'Unknown';
    const note   = lvl.verifier?.name ? `Verified by ${lvl.verifier.name}` : '';
    appendCard(lvl.name, author, note, 'completePC');
}

/* ── Append a level card ── */
function appendCard(name, author, idOrNote, completeFunc) {
    S.levelCount++;
    const card = document.createElement('div');
    card.className = 'level-card animate__animated animate__fadeInUpBig';

    const subLine = idOrNote
        ? `By ${esc(String(author))} · <span style="opacity:.5">${esc(String(idOrNote))}</span>`
        : `By ${esc(String(author))}`;

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

    // Auto-copy level ID to clipboard if it's a number
    if (idOrNote && /^\d+$/.test(String(idOrNote))) clipboardCopy(String(idOrNote));

    card.scrollIntoView({ behavior: 'smooth', block: 'end' });
    document.getElementById('pct-input').focus();
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
    const overshootLine = wasOvershoot
        ? `<div class="done-overshoot">Overshoot (half pts on extra %)</div>`
        : '';
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
    const elapsed = stopTimer();
    const highestPct = S.nextPct - 1;
    const score = Math.round(S.score);

    // Lock any dangling action div
    const dangling = document.getElementById('current-action');
    if (dangling) {
        dangling.removeAttribute('id');
        dangling.innerHTML = givenUp
            ? `<div class="level-done"><div class="done-percent" style="color:var(--red)">Given up</div></div>`
            : `<div class="level-done"><div class="done-percent">${highestPct}%</div></div>`;
        dangling.closest('.level-card')?.classList.add('is-done');
    }

    // Save
    saveRun({ date: new Date().toISOString(), diff: S.diffName, levels: S.levelCount, score, highestPct, elapsed, givenUp });

    // Results card
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
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
        <button class="gd-btn" onclick="location.reload()">Play Again</button>
    `;
    document.getElementById('levels').appendChild(el);
    el.scrollIntoView({ behavior: 'smooth' });

    refreshBestBadge();
}

/* ── LocalStorage ── */
const LS_KEY = 'gdr-history-v1';

function saveRun(run) {
    const hist = loadHistory();
    hist.unshift(run);
    if (hist.length > 100) hist.pop();
    localStorage.setItem(LS_KEY, JSON.stringify(hist));
}

function loadHistory() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}

function refreshBestBadge() {
    const hist = loadHistory();
    const badge = document.getElementById('best-badge');
    if (!hist.length) { badge.textContent = ''; return; }
    const best = Math.max(...hist.map(r => r.score));
    badge.textContent = `Best Score: ${best.toLocaleString()} pts`;
}

/* ── History modal ── */
function showHistory() {
    const hist = loadHistory();
    const body = document.getElementById('history-body');

    if (!hist.length) {
        body.innerHTML = '<div class="history-empty">No runs yet. Play a roulette!</div>';
    } else {
        const best    = Math.max(...hist.map(r => r.score));
        const total   = hist.length;
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
                Best: <strong>${best.toLocaleString()} pts</strong> &nbsp;·&nbsp; ${total} total run${total !== 1 ? 's' : ''}
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
    localStorage.removeItem(LS_KEY);
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
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function clipboardCopy(text) {
    try {
        const el = document.getElementById('copypaste');
        el.value = text;
        el.select();
        document.execCommand('copy');
    } catch {}
}

/* ── Check GDB status on load ── */
setTimeout(async () => {
    try {
        const res = await axios.get(GDB_SEARCH + '*');
        if (res.data === -1 || res.data === '-1') {
            showError('GDBrowser appears to be down right now. Levels may not load.');
        }
    } catch {}
}, 0);
