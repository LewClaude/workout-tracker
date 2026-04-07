(() => {
  // State
  let currentDate = new Date();
  let currentPhase = 1;
  let currentDay = currentDate.getDay() || 7;
  let currentSession = 'AM';
  let exercises = [];
  let saveTimeout = null;
  let pbCache = {};
  let currentUser = null;
  let timerInterval = null;
  let timerSeconds = 0;
  let restDays = [0]; // default: Sunday

  // Auth DOM refs
  const authScreen = document.getElementById('authScreen');
  const mainApp = document.getElementById('mainApp');
  const authUsername = document.getElementById('authUsername');
  const authPassword = document.getElementById('authPassword');
  const loginBtn = document.getElementById('loginBtn');
  const registerBtn = document.getElementById('registerBtn');
  const authError = document.getElementById('authError');
  const usernameDisplay = document.getElementById('usernameDisplay');
  const logoutBtn = document.getElementById('logoutBtn');

  // DOM refs
  const dateInput = document.getElementById('dateInput');
  const prevDayBtn = document.getElementById('prevDay');
  const nextDayBtn = document.getElementById('nextDay');
  const todayBtn = document.getElementById('todayBtn');
  const phaseGroup = document.getElementById('phaseGroup');
  const dayTabs = document.getElementById('dayTabs');
  const restDay = document.getElementById('restDay');
  const workoutContent = document.getElementById('workoutContent');
  const exerciseList = document.getElementById('exerciseList');

  // === Auth ===
  async function checkAuth() {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (data.user) {
      currentUser = data.user;
      showApp();
    } else {
      showAuth();
    }
  }

  function showAuth() {
    authScreen.style.display = 'flex';
    mainApp.style.display = 'none';
    authError.style.display = 'none';
    authUsername.value = '';
    authPassword.value = '';
  }

  async function showApp() {
    authScreen.style.display = 'none';
    mainApp.style.display = 'block';
    usernameDisplay.textContent = currentUser.username;
    await loadRestDays();
    setDate(new Date());
    bindEvents();
    loadPBs();
    loadChart();
  }

  function showAuthError(msg) {
    authError.textContent = msg;
    authError.style.display = 'block';
  }

  loginBtn.addEventListener('click', async () => {
    const username = authUsername.value.trim();
    const password = authPassword.value;
    if (!username || !password) return showAuthError('Enter username and password');

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    currentUser = { username: data.username };
    showApp();
  });

  registerBtn.addEventListener('click', async () => {
    const username = authUsername.value.trim();
    const password = authPassword.value;
    if (!username || !password) return showAuthError('Enter username and password');

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);
    currentUser = { username: data.username };
    showApp();
  });

  authPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loginBtn.click();
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    showAuth();
  });

  // Init
  function init() {
    checkAuth();
  }

  function formatDate(d) {
    return d.toISOString().split('T')[0];
  }

  function setDate(d) {
    currentDate = d;
    dateInput.value = formatDate(d);
    const jsDay = d.getDay();
    currentDay = jsDay === 0 ? 0 : jsDay;
    updateDayTabs();
    loadWorkout();
  }

  let eventsBound = false;
  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    dateInput.addEventListener('change', () => {
      const parts = dateInput.value.split('-');
      setDate(new Date(parts[0], parts[1] - 1, parts[2]));
    });

    prevDayBtn.addEventListener('click', () => {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setDate(d);
    });

    nextDayBtn.addEventListener('click', () => {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setDate(d);
    });

    todayBtn.addEventListener('click', () => setDate(new Date()));

    phaseGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-phase]');
      if (!btn) return;
      currentPhase = parseInt(btn.dataset.phase);
      phaseGroup.querySelectorAll('.btn-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadWorkout();
    });

    dayTabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-day]');
      if (!btn) return;
      const day = parseInt(btn.dataset.day);
      const curr = new Date(currentDate);
      const currentJsDay = curr.getDay();
      const diff = day - currentJsDay;
      curr.setDate(curr.getDate() + diff);
      setDate(curr);
    });

    // Session toggle click
    document.querySelector('.session-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-session]');
      if (!btn) return;
      switchSession(btn.dataset.session);
    });

    // Swipe between AM/PM
    let touchStartX = 0;
    let touchStartY = 0;
    exerciseList.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    exerciseList.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      const dy = e.changedTouches[0].clientY - touchStartY;
      // Only trigger if horizontal swipe is dominant and long enough
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (dx < 0 && currentSession === 'AM') {
          switchSession('PM');
        } else if (dx > 0 && currentSession === 'PM') {
          switchSession('AM');
        }
      }
    }, { passive: true });

    // Rest timer buttons
    document.querySelectorAll('.timer-btn').forEach(btn => {
      btn.addEventListener('click', () => startTimer(parseInt(btn.dataset.seconds)));
    });
    document.getElementById('timerClose').addEventListener('click', stopTimer);
  }

  function switchSession(session) {
    currentSession = session;
    document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-session="${session}"]`).classList.add('active');
    renderExercises();
  }

  function updateDayTabs() {
    document.querySelectorAll('.day-tab').forEach(tab => {
      const day = parseInt(tab.dataset.day);
      tab.classList.toggle('active', day === currentDay);
      tab.classList.toggle('user-rest', restDays.includes(day));
    });
  }

  async function loadPBs() {
    const res = await fetch('/api/pbs');
    const pbs = await res.json();
    pbCache = {};
    pbs.forEach(pb => {
      pbCache[pb.exercise_id] = pb;
    });
  }

  async function loadWorkout() {
    if (restDays.includes(currentDay)) {
      // Check if there's logged data for this date — if so, show workout anyway
      const date = formatDate(currentDate);
      const logsRes = await fetch(`/api/logs/date/${date}`);
      const existingLogs = await logsRes.json();

      if (existingLogs.length === 0) {
        restDay.style.display = 'block';
        workoutContent.style.display = 'none';
        updateStats();
        return;
      }
    }

    restDay.style.display = 'none';
    workoutContent.style.display = 'block';

    const res = await fetch(`/api/exercises/day?day=${currentDay}&phase=${currentPhase}`);
    exercises = await res.json();

    const date = formatDate(currentDate);
    await Promise.all(exercises.map(async (ex) => {
      const logsRes = await fetch(`/api/logs/${ex.id}/${date}`);
      ex.logs = await logsRes.json();

      const histRes = await fetch(`/api/history/${ex.id}?before=${date}`);
      ex.history = await histRes.json();

      const pbRes = await fetch(`/api/pbs/${ex.id}`);
      ex.pb = await pbRes.json();
    }));

    renderExercises();
    updateStats();
  }

  function renderExercises() {
    const sessionExercises = exercises.filter(e => e.session === currentSession);
    exerciseList.innerHTML = '';

    if (sessionExercises.length === 0) {
      exerciseList.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:40px">No exercises for this session</p>';
      return;
    }

    sessionExercises.forEach(ex => {
      const card = document.createElement('div');
      card.className = 'exercise-card';
      card.dataset.exerciseId = ex.id;

      const prevSets = (ex.history && ex.history.sets) ? ex.history.sets : [];

      // Build sets — use logs or default 3 empty rows
      const sets = ex.logs.length > 0 ? ex.logs : [
        { set_number: 1, weight_kg: '', reps: '' },
        { set_number: 2, weight_kg: '', reps: '' },
        { set_number: 3, weight_kg: '', reps: '' }
      ];

      const isPB = checkIsPB(ex, sets);
      const maxWeight = (ex.pb && ex.pb.max_weight) ? ex.pb.max_weight : 0;

      let historyHtml = '';
      if (prevSets.length > 0) {
        const histSets = prevSets
          .map(s => `${s.weight_kg}kg x ${s.reps}`)
          .join(' | ');
        historyHtml = `
          <div class="exercise-history">
            <span class="hist-label">Last (${ex.history.date}):</span> ${histSets}
          </div>`;
      }

      card.innerHTML = `
        <div class="exercise-header">
          <span class="exercise-name">${ex.name}</span>
          ${isPB ? '<span class="pb-badge">NEW PB!</span>' : ''}
          <button class="btn-rest-timer" title="Rest timer">&#9202;</button>
        </div>
        ${historyHtml}
        <div class="sets-container">
          ${sets.map((s, i) => {
            const prev = prevSets[i];
            const placeholderW = prev ? prev.weight_kg : '0';
            const placeholderR = prev ? prev.reps : '0';
            const w = parseFloat(s.weight_kg) || 0;
            const r = parseInt(s.reps) || 0;
            const isSetPB = w > 0 && r > 0 && maxWeight > 0 && w > maxWeight;
            // Also highlight if equals max but this is the session that set it
            const isSetMatchPB = w > 0 && r > 0 && maxWeight > 0 && w >= maxWeight && isPB;
            return renderSetRow(i + 1, s.weight_kg, s.reps, s.id, placeholderW, placeholderR, isSetPB || isSetMatchPB);
          }).join('')}
        </div>
        <button class="btn-add-set" data-exercise-id="${ex.id}">+ Add Set</button>
      `;

      // Rest timer button
      card.querySelector('.btn-rest-timer').addEventListener('click', () => {
        showTimerUI();
      });

      // Bind set input events
      card.querySelectorAll('.set-input').forEach(input => {
        input.addEventListener('change', () => handleSetChange(ex.id, card));
        input.addEventListener('blur', () => handleSetChange(ex.id, card));
      });

      card.querySelector('.btn-add-set').addEventListener('click', () => {
        const container = card.querySelector('.sets-container');
        const setCount = container.children.length + 1;
        const prev = prevSets[setCount - 1];
        const placeholderW = prev ? prev.weight_kg : '0';
        const placeholderR = prev ? prev.reps : '0';
        const row = document.createElement('div');
        row.innerHTML = renderSetRow(setCount, '', '', null, placeholderW, placeholderR, false);
        const newRow = row.firstElementChild;
        container.appendChild(newRow);

        newRow.querySelectorAll('.set-input').forEach(input => {
          input.addEventListener('change', () => handleSetChange(ex.id, card));
          input.addEventListener('blur', () => handleSetChange(ex.id, card));
        });

        newRow.querySelector('.btn-remove-set').addEventListener('click', () => {
          removeSet(ex.id, card, newRow);
        });
      });

      card.querySelectorAll('.btn-remove-set').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = btn.closest('.set-row');
          removeSet(ex.id, card, row);
        });
      });

      exerciseList.appendChild(card);
    });
  }

  function renderSetRow(num, weight, reps, logId, placeholderW, placeholderR, isPBRow) {
    const hasValue = (v) => v !== '' && v !== null && v !== undefined;
    return `
      <div class="set-row ${isPBRow ? 'set-row-pb' : ''}" data-log-id="${logId || ''}">
        <span class="set-number">${num}</span>
        <input type="number" class="set-input weight-input" placeholder="${placeholderW}"
               value="${hasValue(weight) ? weight : ''}"
               min="0" step="0.5" inputmode="decimal">
        <span class="input-label">KG</span>
        <input type="number" class="set-input reps-input" placeholder="${placeholderR}"
               value="${hasValue(reps) ? reps : ''}"
               min="0" step="1" inputmode="numeric">
        <span class="input-label">REPS</span>
        <button class="btn-remove-set">&times;</button>
      </div>`;
  }

  async function handleSetChange(exerciseId, card) {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      await saveExerciseSets(exerciseId, card);
    }, 400);
  }

  async function saveExerciseSets(exerciseId, card) {
    const rows = card.querySelectorAll('.set-row');
    const date = formatDate(currentDate);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const weight = parseFloat(row.querySelector('.weight-input').value) || 0;
      const reps = parseInt(row.querySelector('.reps-input').value) || 0;

      if (weight > 0 || reps > 0) {
        await fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            exercise_id: exerciseId,
            date,
            set_number: i + 1,
            weight_kg: weight,
            reps
          })
        });
      }
    }

    await fetch(`/api/logs/trim/${exerciseId}/${date}/${rows.length}`, { method: 'DELETE' });

    const ex = exercises.find(e => e.id === exerciseId);
    if (ex) {
      const logsRes = await fetch(`/api/logs/${exerciseId}/${date}`);
      ex.logs = await logsRes.json();

      const pbRes = await fetch(`/api/pbs/${exerciseId}`);
      ex.pb = await pbRes.json();
    }

    showSaved();
    updateStats();
    await loadPBs();
    loadChart();

    // Update PB badge and per-row PB highlights
    const header = card.querySelector('.exercise-header');
    const existingBadge = header.querySelector('.pb-badge');
    const sets = [];
    rows.forEach(row => {
      sets.push({
        weight_kg: parseFloat(row.querySelector('.weight-input').value) || 0,
        reps: parseInt(row.querySelector('.reps-input').value) || 0
      });
    });

    const isPB = checkIsPB(ex, sets);
    const maxWeight = (ex && ex.pb && ex.pb.max_weight) ? ex.pb.max_weight : 0;

    if (isPB && !existingBadge) {
      const badge = document.createElement('span');
      badge.className = 'pb-badge';
      badge.textContent = 'NEW PB!';
      header.insertBefore(badge, header.querySelector('.btn-rest-timer'));
    } else if (!isPB && existingBadge) {
      existingBadge.remove();
    }

    // Update per-row PB highlight
    rows.forEach(row => {
      const w = parseFloat(row.querySelector('.weight-input').value) || 0;
      const r = parseInt(row.querySelector('.reps-input').value) || 0;
      const isRowPB = w > 0 && r > 0 && maxWeight > 0 && w >= maxWeight && isPB;
      row.classList.toggle('set-row-pb', isRowPB);
    });
  }

  function checkIsPB(ex, sets) {
    if (!ex || !ex.pb) return false;
    const maxWeight = ex.pb.max_weight || 0;
    for (const s of sets) {
      const w = parseFloat(s.weight_kg) || 0;
      const r = parseInt(s.reps) || 0;
      if (w > 0 && r > 0 && w >= maxWeight && maxWeight > 0) return true;
    }
    return false;
  }

  async function removeSet(exerciseId, card, row) {
    const container = card.querySelector('.sets-container');
    if (container.children.length <= 1) return;

    const logId = row.dataset.logId;
    if (logId) {
      await fetch(`/api/logs/${logId}`, { method: 'DELETE' });
    }

    row.remove();
    container.querySelectorAll('.set-row').forEach((r, i) => {
      r.querySelector('.set-number').textContent = i + 1;
    });

    await saveExerciseSets(exerciseId, card);
  }

  async function updateStats() {
    const date = formatDate(currentDate);
    const res = await fetch(`/api/stats/${date}`);
    const stats = await res.json();

    document.getElementById('statVolume').textContent = stats.total_volume.toLocaleString();
    document.getElementById('statSets').textContent = stats.total_sets;
    document.getElementById('statPBs').textContent = stats.pb_count;
  }

  function showSaved() {
    let indicator = document.querySelector('.save-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'save-indicator';
      indicator.textContent = 'Saved';
      document.body.appendChild(indicator);
    }
    indicator.classList.add('show');
    setTimeout(() => indicator.classList.remove('show'), 1200);
  }

  // === Rest Timer ===
  function showTimerUI() {
    document.getElementById('restTimer').style.display = 'flex';
  }

  function startTimer(seconds) {
    clearInterval(timerInterval);
    timerSeconds = seconds;
    updateTimerDisplay();
    document.getElementById('restTimer').style.display = 'flex';

    timerInterval = setInterval(() => {
      timerSeconds--;
      updateTimerDisplay();
      if (timerSeconds <= 0) {
        clearInterval(timerInterval);
        // Vibrate if supported
        if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
        document.getElementById('timerDisplay').textContent = 'GO!';
        document.getElementById('timerDisplay').classList.add('timer-done');
        setTimeout(() => {
          document.getElementById('timerDisplay').classList.remove('timer-done');
          stopTimer();
        }, 2000);
      }
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    document.getElementById('restTimer').style.display = 'none';
  }

  function updateTimerDisplay() {
    const mins = Math.floor(timerSeconds / 60);
    const secs = timerSeconds % 60;
    document.getElementById('timerDisplay').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // === Weekly Volume Chart ===
  const CHART_COLORS = {
    'Chest': '#f07030',
    'Back': '#2dd4a8',
    'Shoulders': '#ffd166',
    'Arms': '#ff6b9d',
    'Legs': '#5cabff',
    'Core': '#c084fc'
  };

  async function loadChart() {
    const res = await fetch('/api/weekly-volume?weeks=8');
    const { groups, data } = await res.json();

    const container = document.getElementById('chartContainer');
    const legend = document.getElementById('chartLegend');

    if (data.length === 0) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-dim);padding:20px;font-size:13px">Log some workouts to see your weekly volume chart</p>';
      legend.innerHTML = '';
      return;
    }

    // Find max total volume for scaling
    let maxTotal = 0;
    data.forEach(week => {
      let total = 0;
      groups.forEach(g => total += week[g] || 0);
      if (total > maxTotal) maxTotal = total;
    });

    // Render stacked bars
    let barsHtml = '';
    data.forEach(week => {
      const weekLabel = week.week.slice(5); // MM-DD
      let segments = '';
      groups.forEach(g => {
        const vol = week[g] || 0;
        const pct = maxTotal > 0 ? (vol / maxTotal) * 100 : 0;
        if (pct > 0) {
          segments += `<div class="chart-segment" style="height:${pct}%;background:${CHART_COLORS[g]}" title="${g}: ${vol.toLocaleString()}kg"></div>`;
        }
      });
      barsHtml += `
        <div class="chart-bar-wrapper">
          <div class="chart-bar">${segments}</div>
          <span class="chart-bar-label">${weekLabel}</span>
        </div>`;
    });

    container.innerHTML = barsHtml;

    // Legend
    legend.innerHTML = groups.map(g =>
      `<span class="legend-item"><span class="legend-dot" style="background:${CHART_COLORS[g]}"></span>${g}</span>`
    ).join('');
  }

  // === Rest Day Settings ===
  async function loadRestDays() {
    const res = await fetch('/api/settings/rest-days');
    const data = await res.json();
    restDays = data.rest_days;
    updateDayTabs();
  }

  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettings = document.getElementById('closeSettings');
  const restDayGrid = document.getElementById('restDayGrid');
  const settingsSummary = document.getElementById('settingsSummary');

  settingsBtn.addEventListener('click', openSettings);
  closeSettings.addEventListener('click', closeSettingsModal);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });

  function openSettings() {
    renderRestDayGrid();
    settingsModal.style.display = 'flex';
  }

  function closeSettingsModal() {
    settingsModal.style.display = 'none';
    updateDayTabs();
    loadWorkout();
  }

  function renderRestDayGrid() {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const buttons = restDayGrid.querySelectorAll('.rest-day-toggle');
    buttons.forEach(btn => {
      const day = parseInt(btn.dataset.day);
      const isRest = restDays.includes(day);
      btn.classList.toggle('resting', isRest);
      btn.classList.toggle('training', !isRest);
      btn.querySelector('.rdt-status').textContent = isRest ? 'Rest' : 'Train';

      // Remove old listeners by cloning
      const newBtn = btn.cloneNode(true);
      btn.replaceWith(newBtn);
      newBtn.addEventListener('click', () => toggleRestDay(day));
    });
    updateSettingsSummary();
  }

  async function toggleRestDay(day) {
    if (restDays.includes(day)) {
      restDays = restDays.filter(d => d !== day);
    } else {
      restDays.push(day);
    }

    await fetch('/api/settings/rest-days', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rest_days: restDays })
    });

    renderRestDayGrid();
    showSaved();
  }

  function updateSettingsSummary() {
    const trainCount = 7 - restDays.length;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const restNames = restDays.map(d => dayNames[d]).join(', ') || 'None';
    settingsSummary.innerHTML = `<strong>${trainCount}</strong> training days / week &mdash; Rest: ${restNames}`;
  }

  // === Editor ===
  const editBtn = document.getElementById('editBtn');
  const editorModal = document.getElementById('editorModal');
  const closeEditor = document.getElementById('closeEditor');
  const editorList = document.getElementById('editorList');
  const editorContext = document.getElementById('editorContext');
  const newExerciseName = document.getElementById('newExerciseName');
  const addExerciseBtn = document.getElementById('addExerciseBtn');

  let editorExercises = [];

  editBtn.addEventListener('click', openEditor);
  closeEditor.addEventListener('click', closeEditorModal);
  editorModal.addEventListener('click', (e) => {
    if (e.target === editorModal) closeEditorModal();
  });
  addExerciseBtn.addEventListener('click', addNewExercise);
  newExerciseName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNewExercise();
  });

  async function openEditor() {
    if (currentDay === 0) return;
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    editorContext.textContent = `Phase ${currentPhase} / ${dayNames[currentDay]} / ${currentSession}`;

    const res = await fetch(`/api/exercises?day=${currentDay}&phase=${currentPhase}&session=${currentSession}`);
    editorExercises = await res.json();
    renderEditor();
    editorModal.style.display = 'flex';
  }

  function closeEditorModal() {
    editorModal.style.display = 'none';
    loadWorkout();
  }

  function renderEditor() {
    editorList.innerHTML = '';
    editorExercises.forEach((ex, idx) => {
      const row = document.createElement('div');
      row.className = 'editor-row';
      row.dataset.id = ex.id;
      row.dataset.idx = idx;
      row.draggable = true;

      row.innerHTML = `
        <span class="drag-handle">&#9776;</span>
        <input type="text" class="exercise-name-input" value="${ex.name}" data-id="${ex.id}">
        <button class="btn-delete-exercise" data-id="${ex.id}">&times;</button>
      `;

      row.querySelector('.exercise-name-input').addEventListener('blur', async (e) => {
        const newName = e.target.value.trim();
        if (newName && newName !== ex.name) {
          await fetch(`/api/exercises/${ex.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
          });
          ex.name = newName;
          showSaved();
        }
      });

      row.querySelector('.btn-delete-exercise').addEventListener('click', async () => {
        if (!confirm(`Delete "${ex.name}"? This also removes all its logged data.`)) return;
        await fetch(`/api/exercises/${ex.id}`, { method: 'DELETE' });
        editorExercises = editorExercises.filter(e => e.id !== ex.id);
        renderEditor();
        showSaved();
      });

      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', idx);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        if (fromIdx === idx) return;

        const [moved] = editorExercises.splice(fromIdx, 1);
        editorExercises.splice(idx, 0, moved);

        const orders = editorExercises.map((ex, i) => ({ id: ex.id, sort_order: i }));
        await fetch('/api/exercises/reorder', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orders })
        });
        renderEditor();
        showSaved();
      });

      let touchStartY = 0;
      const handle = row.querySelector('.drag-handle');

      handle.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
        row.classList.add('dragging');
      }, { passive: true });

      handle.addEventListener('touchmove', (e) => {
        e.preventDefault();
      }, { passive: false });

      handle.addEventListener('touchend', async (e) => {
        row.classList.remove('dragging');
        const diff = e.changedTouches[0].clientY - touchStartY;
        const moveBy = Math.round(diff / 52);
        if (moveBy === 0) return;

        let newIdx = Math.max(0, Math.min(editorExercises.length - 1, idx + moveBy));
        if (newIdx === idx) return;

        const [moved] = editorExercises.splice(idx, 1);
        editorExercises.splice(newIdx, 0, moved);

        const orders = editorExercises.map((ex, i) => ({ id: ex.id, sort_order: i }));
        await fetch('/api/exercises/reorder', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orders })
        });
        renderEditor();
        showSaved();
      });

      editorList.appendChild(row);
    });
  }

  async function addNewExercise() {
    const name = newExerciseName.value.trim();
    if (!name) return;

    const res = await fetch('/api/exercises', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        day: currentDay,
        phase: currentPhase,
        session: currentSession
      })
    });
    const result = await res.json();
    editorExercises.push({ id: result.id, name, sort_order: result.sort_order });
    newExerciseName.value = '';
    renderEditor();
    showSaved();
  }

  init();
})();
