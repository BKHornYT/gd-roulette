/* ── Constants ── */
const GDB_SEARCH  = 'https://gdbrowser.com/api/search/';
const PC_API      = 'https://pointercrate.com/api/v1/demons/?limit=100';
const API_DELAY   = 2500;
const LS_HISTORY  = 'gdr-history-v1';
const LS_ACTIVE   = 'gdr-active-v3';

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
    mode:            null,    // 'gdb' | 'pointercrate'
    selectedDiffs:   [],      // selected diff IDs
    diffName:        '',      // display name for the run
    // GDB multi-diff:
    diffQueries:     {},      // { diffId: { query, pages } }
    combinedPool:    [],      // [{ diffId, idx }, ...] shuffled
    currentDiffId:   '',      // diffId of the level currently being played
    // Pointercrate:
    pcPool:          [],
    // Common:
    levelCount:      0,
    nextPct:         1,
    score:           0,
    startTime:       null,
    timerRef:        null,
    active:          false,
    elapsedOffset:   0,
    currentCardData: null,
    completedLevels: [],
};

/* ── Init ── */
document.getElementById('splash').textContent = SPLASH[Math.floor(Math.random() * SPLASH.length)];

const seedInput = document.getElementById('seed');
seedInput.value = rngSeed;
seedInput.addEventListener('change', () => {
    rngSeed = parseInt(seedInput.value) || rngSeed;
    seedInput.value = rngSeed;
});

// Attach change listeners to all difficulty checkboxes
document.querySelectorAll('.diff-check').forEach(c => {
    c.addEventListener('change', () => onDiffChange(c));
});

// URL params: pre-check difficulties
const params = new URLSearchParams(window.location.search);
document.querySelectorAll('.diff-check').forEach(c => {
    if (params.has(c.id)) { c.checked = true; }
});
if (params.has('seed')) {
    const s = parseInt(params.get('seed'));
    if (!isNaN(s)) { rngSeed = s; seedInput.value = s; document.getElementById('addSeed').checked = true; }
}
updateStartButton();
refreshBestBadge();
checkSavedGame();

/* ── Difficulty checkbox logic ── */
function onDiffChange(el) {
    // Demonlist is mutually exclusive with everything else
    if (el.id === 'demonlist' && el.checked) {
        document.querySelectorAll('.diff-check:not(#demonlist)').forEach(c => { c.checked = false; });
    } else if (el.checked) {
        document.getElementById('demonlist').checked = false;
    }
    updateStartButton();
}

function updateStartButton() {
    const any = [...document.querySelectorAll('.diff-check')].some(c => c.checked);
    document.getElementById('start').disabled = !any;
}

function getSelectedDiffs() {
    return [...document.querySelectorAll('.diff-check')]
        .filter(c => c.checked)
        .map(c => c.id);
}

function diffDisplayName(diffs) {
    if (diffs.length === 1) return DIFF_NAMES[diffs[0]] || diffs[0];
    const names = diffs.map(d => DIFF_NAMES[d] || d);
    if (names.length <= 2) return names.join(' + ');
    return names.slice(0, 2).join(' + ') + ` (+${names.length - 2} more)`;
}

/* ── Copy link ── */
function copyLink() {
    const diffs = getSelectedDiffs();
    const adds  = diffs.length === 1 ? [diffs[0]] : [];
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
function calcPoints(required, got, diffId) {
    const m         = DIFF_MULT[diffId] || 1;
    const base      = 5 * m;
    const overshoot = Math.max(0, got - required) * 2.5 * m;
    return base + overshoot;
}

/* ── GDB API ── */
function shortDelay() { return new Promise(r => setTimeout(r, 500)); }
function fullDelay()  { return new Promise(r => setTimeout(r, API_DELAY)); }

async function fetchPageFrom(diffData, page, iter = 0) {
    const key = 'p' + page;
    if (diffData.pages[key]) return diffData.pages[key];
    await fullDelay();
    const res = await axios.get(diffData.query + '&page=' + page);
    if (res.data === -1 || res.data === '-1') {
        if (iter < 5) return fetchPageFrom(diffData, page, iter + 1);
        showError('GDBrowser rate-limited. Wait a moment and refresh.');
        throw new Error('rate-limited');
    }
    diffData.pages[key] = res.data;
    return res.data;
}

/* ── Start roulette ── */
async function startRoulette() {
    const selectedDiffs = getSelectedDiffs();
    if (!selectedDiffs.length) { alert('Pick at least one difficulty!'); return; }

    const useCustom   = document.getElementById('custom-start-toggle').checked;
    const customPct   = useCustom ? (parseInt(document.getElementById('custom-pct').value)   || 1) : 1;
    const customScore = useCustom ? (parseInt(document.getElementById('custom-score').value)  || 0) : 0;

    S.selectedDiffs   = selectedDiffs;
    S.diffName        = diffDisplayName(selectedDiffs);
    S.diffQueries     = {};
    S.combinedPool    = [];
    S.pcPool          = [];
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
        if (selectedDiffs.includes('demonlist')) {
            S.mode = 'pointercrate';
            const res = await axios.get(PC_API);
            S.pcPool = shuffled(res.data).slice(0, 100);
        } else {
            S.mode = 'gdb';
            // How many levels to pull per difficulty (totals ~100)
            const perDiff = Math.max(10, Math.round(100 / selectedDiffs.length));

            for (let i = 0; i < selectedDiffs.length; i++) {
                const diffId = selectedDiffs[i];
                const query  = GDB_SEARCH + '*' + document.getElementById(diffId).value;

                // Init entry so fetchPageFrom can cache into it
                S.diffQueries[diffId] = { query, pages: {} };

                // Use fetchPageFrom so we get the proper 2.5s delay + retry logic
                let pageData;
                try { pageData = await fetchPageFrom(S.diffQueries[diffId], 0); }
                catch { continue; }

                const total = pageData?.[0]?.results || 0;
                if (!total) continue;

                const pool = [];
                for (let j = 1; j <= total; j++) pool.push(j);
                const trimmed = shuffled(pool).slice(0, perDiff);

                for (const idx of trimmed) {
                    S.combinedPool.push({ diffId, idx });
                }
            }

            S.combinedPool = shuffled(S.combinedPool);

            if (!S.combinedPool.length) {
                showError('No levels found for the selected difficulties.');
                startBtn.classList.remove('is-loading');
                return;
            }
        }
    } catch (e) {
        S.active = false;
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
function newGame()        { clearActiveGame(); location.reload(); }
function playAgainSame()  {
    clearActiveGame();
    // Re-check same difficulties via URL params (single diff only)
    if (S.selectedDiffs.length === 1) {
        location.href = location.href.split('?')[0] + '?' + S.selectedDiffs[0];
    } else {
        location.reload();
    }
}

/* ── GDB: next level ── */
async function getNextGDB() {
    if (!S.combinedPool.length) { endRun(false); return; }
    const { diffId, idx } = S.combinedPool.shift();
    S.currentDiffId = diffId;

    const diffData = S.diffQueries[diffId];
    const page = Math.floor((idx - 1) / 10);
    const pos  = (idx - 1) % 10;

    let level;
    try {
        const data = await fetchPageFrom(diffData, page);
        level = data[pos];
    } catch { return; }

    if (!level) { getNextGDB(); return; }
    appendCard(level.name, level.author, String(level.id), diffId, 'completeGDB');
}

/* ── Pointercrate: next level ── */
function getNextPC() {
    if (!S.pcPool.length) { endRun(false); return; }
    const lvl = S.pcPool.shift();
    if (!lvl) { getNextPC(); return; }
    S.currentDiffId = 'demonlist';
    const author = lvl.publisher?.name || 'Unknown';
    const note   = lvl.verifier?.name ? `Verified by ${lvl.verifier.name}` : '';
    appendCard(lvl.name, author, note, 'demonlist', 'completePC');
}

/* ── Append active card ── */
function appendCard(name, author, idOrNote, diffId, completeFunc) {
    S.levelCount++;
    S.currentCardData = { name, author, idOrNote, diffId };

    const showBadge = S.selectedDiffs.length > 1 || S.mode === 'pointercrate';
    const badge     = showBadge
        ? `<span class="diff-badge">${esc(DIFF_NAMES[diffId] || diffId)}</span>`
        : '';

    const subLine = idOrNote
        ? `By ${esc(author)} · <span style="opacity:.5">${esc(idOrNote)}</span>`
        : `By ${esc(author)}`;

    const card = document.createElement('div');
    card.className = 'level-card animate__animated animate__fadeInUpBig';
    card.innerHTML = `
        <div class="level-meta">
            <div class="level-num">Level #${S.levelCount} ${badge}</div>
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

/* ── Append read-only card (for resume) ── */
function appendLockedCard(level) {
    const showBadge = S.selectedDiffs.length > 1 || S.mode === 'pointercrate';
    const badge     = showBadge
        ? `<span class="diff-badge">${esc(DIFF_NAMES[level.diffId] || level.diffId)}</span>`
        : '';

    const subLine = level.idOrNote
        ? `By ${esc(level.author)} · <span style="opacity:.5">${esc(level.idOrNote)}</span>`
        : `By ${esc(level.author)}`;

    const overshootLine = level.wasOvershoot
        ? `<div class="done-overshoot">Overshoot (half pts on extra %)</div>` : '';

    const card = document.createElement('div');
    card.className = 'level-card is-done';
    card.innerHTML = `
        <div class="level-meta">
            <div class="level-num">Level #${level.num} ${badge}</div>
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
    const pts      = calcPoints(required, pct, S.currentDiffId);
    S.score       += pts;

    lockAction(pct, pts, pct > required);
    S.nextPct = pct + 1;
    updateStats();
    saveActiveGame();

    if (pct >= 100) { endRun(false); return; }
    const poolEmpty = S.mode === 'gdb' ? S.combinedPool.length === 0 : S.pcPool.length === 0;
    if (poolEmpty)  { endRun(false); return; }

    next();
}

function lockAction(pct, pts, wasOvershoot) {
    const el = document.getElementById('current-action');
    if (!el) return;
    el.removeAttribute('id');

    if (S.currentCardData) {
        S.completedLevels.push({
            ...S.currentCardData,
            num: S.levelCount,
            pct, pts, wasOvershoot,
        });
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
        <div class="results-diff">${esc(S.diffName)}</div>
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
        localStorage.setItem(LS_ACTIVE, JSON.stringify({
            v: 3,
            ts:              Date.now(),
            mode:            S.mode,
            selectedDiffs:   S.selectedDiffs,
            diffName:        S.diffName,
            currentDiffId:   S.currentDiffId,
            diffQueries:     Object.fromEntries(
                Object.entries(S.diffQueries).map(([id, d]) => [id, { query: d.query }])
            ),
            combinedPool:    S.combinedPool,
            pcPool:          S.pcPool,
            nextPct:         S.nextPct,
            score:           S.score,
            levelCount:      S.levelCount,
            elapsedSecs:     elapsedSecs(),
            completedLevels: S.completedLevels,
            rngSeed,
        }));
    } catch {}
}

function clearActiveGame() {
    localStorage.removeItem(LS_ACTIVE);
}

function checkSavedGame() {
    try {
        const save = JSON.parse(localStorage.getItem(LS_ACTIVE));
        if (!save || save.v !== 3) { clearActiveGame(); return; }

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

        S.mode            = save.mode;
        S.selectedDiffs   = save.selectedDiffs   || [];
        S.diffName        = save.diffName        || '';
        S.currentDiffId   = save.currentDiffId   || '';
        S.combinedPool    = save.combinedPool    || [];
        S.pcPool          = save.pcPool          || [];
        S.nextPct         = save.nextPct;
        S.score           = save.score;
        S.levelCount      = save.levelCount;
        S.elapsedOffset   = save.elapsedSecs     || 0;
        S.completedLevels = save.completedLevels || [];
        S.active          = true;
        rngSeed           = save.rngSeed;

        // Rebuild diffQueries with empty page caches
        S.diffQueries = {};
        for (const [id, d] of Object.entries(save.diffQueries || {})) {
            S.diffQueries[id] = { query: d.query, pages: {} };
        }

        for (const level of S.completedLevels) appendLockedCard(level);

        hideSettings();
        showGameUI();

        if (S.mode === 'gdb') getNextGDB();
        else getNextPC();

    } catch {
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
        body.innerHTML = `
            <div class="history-summary">
                Best: <strong>${best.toLocaleString()} pts</strong> &nbsp;·&nbsp; ${total} run${total !== 1 ? 's' : ''}
            </div>
            ${hist.map(run => {
                const d    = new Date(run.date).toLocaleDateString();
                const mins = Math.floor(run.elapsed / 60);
                const secs = run.elapsed % 60;
                return `<div class="history-entry">
                    <div>
                        <span class="history-diff">${esc(run.diff)}</span>
                        <span class="history-date" style="margin-left:8px">${d}</span>
                    </div>
                    <div>
                        <div class="history-score">${run.score.toLocaleString()} pts</div>
                        <div class="history-sub">${run.levels} lvls · ${run.highestPct}% · ${mins}m${String(secs).padStart(2,'0')}s</div>
                    </div>
                </div>`;
            }).join('')}
        `;
    }

    document.getElementById('history-modal').classList.add('is-active');
}

function closeHistory()  { document.getElementById('history-modal').classList.remove('is-active'); }
function clearHistory()  {
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

/* ── GDB status check (silent — shows warning only if levels fail to load) ── */
setTimeout(async () => {
    try {
        const res = await axios.get(GDB_SEARCH + '*');
        if (res.data === -1 || res.data === '-1')
            console.warn('GDBrowser may be down or rate-limiting.');
    } catch {}
}, 0);
