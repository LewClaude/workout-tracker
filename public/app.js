(() => {
  // State
  let currentDate = new Date();
  let currentPhase = 1;
  let currentDay = currentDate.getDay() || 7; // 1=Mon...6=Sat, 7 mapped to 0 for Sun
  let currentSession = 'AM';
  let exercises = [];
  let saveTimeout = null;
  let pbCache = {};

  // DOM refs
  const dateInput = document.getElementById('dateInput');
  const prevDayBtn = document.getElementById('prevDay');
  const nextDayBtn = document.getElementById('nextDay');
  const todayBtn = document.getElementById('todayBtn');
  const phaseGroup = document.getElementById('phaseGroup');
  const dayTabs = document.getElementById('dayTabs');
  const statsBar = document.getElementById('statsBar');
  const restDay = document.getElementById('restDay');
  const workoutContent = document.getElementById('workoutContent');
  const exerciseList = document.getElementById('exerciseList');

  // Init
  function init() {
    setDate(new Date());
    bindEvents();
    loadPBs();
  }

  function formatDate(d) {
    return d.toISOString().split('T')[0];
  }

  function setDate(d) {
    currentDate = d;
    dateInput.value = formatDate(d);
    // Map JS day (0=Sun) to our day system
    const jsDay = d.getDay();
    currentDay = jsDay === 0 ? 0 : jsDay; // 0=Sun, 1=Mon...6=Sat
    updateDayTabs();
    loadWorkout();
  }

  function bindEvents() {
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
      // Find the date for this day of the week relative to current week
      const curr = new Date(currentDate);
      const currentJsDay = curr.getDay();
      const targetJsDay = day;
      const diff = targetJsDay - currentJsDay;
      curr.setDate(curr.getDate() + diff);
      setDate(curr);
    });

    document.querySelector('.session-toggle').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-session]');
      if (!btn) return;
      currentSession = btn.dataset.session;
      document.querySelectorAll('.session-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderExercises();
    });
  }

  function updateDayTabs() {
    document.querySelectorAll('.day-tab').forEach(tab => {
      tab.classList.toggle('active', parseInt(tab.dataset.day) === currentDay);
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
    if (currentDay === 0) {
      restDay.style.display = 'block';
      workoutContent.style.display = 'none';
      updateStats();
      return;
    }

    restDay.style.display = 'none';
    workoutContent.style.display = 'block';

    // Load exercises for the day
    const res = await fetch(`/api/exercises/day?day=${currentDay}&phase=${currentPhase}`);
    exercises = await res.json();

    // Load existing logs for each exercise
    const date = formatDate(currentDate);
    await Promise.all(exercises.map(async (ex) => {
      const logsRes = await fetch(`/api/logs/${ex.id}/${date}`);
      ex.logs = await logsRes.json();

      // Load history
      const histRes = await fetch(`/api/history/${ex.id}?before=${date}`);
      ex.history = await histRes.json();

      // Load PB
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

      // Determine sets - at least 3 by default
      const sets = ex.logs.length > 0 ? ex.logs : [
        { set_number: 1, weight_kg: '', reps: '' },
        { set_number: 2, weight_kg: '', reps: '' },
        { set_number: 3, weight_kg: '', reps: '' }
      ];

      // Check for PB
      const isPB = checkIsPB(ex, sets);

      let historyHtml = '';
      if (ex.history && ex.history.sets && ex.history.sets.length > 0) {
        const histSets = ex.history.sets
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
        </div>
        ${historyHtml}
        <div class="sets-container">
          ${sets.map((s, i) => renderSetRow(i + 1, s.weight_kg, s.reps, s.id)).join('')}
        </div>
        <button class="btn-add-set" data-exercise-id="${ex.id}">+ Add Set</button>
      `;

      // Bind events
      card.querySelectorAll('.set-input').forEach(input => {
        input.addEventListener('change', () => handleSetChange(ex.id, card));
        input.addEventListener('blur', () => handleSetChange(ex.id, card));
      });

      card.querySelector('.btn-add-set').addEventListener('click', () => {
        const container = card.querySelector('.sets-container');
        const setCount = container.children.length + 1;
        const row = document.createElement('div');
        row.innerHTML = renderSetRow(setCount, '', '', null);
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

  function renderSetRow(num, weight, reps, logId) {
    return `
      <div class="set-row" data-log-id="${logId || ''}">
        <span class="set-number">${num}</span>
        <input type="number" class="set-input weight-input" placeholder="0"
               value="${weight !== '' && weight !== null && weight !== undefined ? weight : ''}"
               min="0" step="0.5" inputmode="decimal">
        <span class="input-label">kg</span>
        <input type="number" class="set-input reps-input" placeholder="0"
               value="${reps !== '' && reps !== null && reps !== undefined ? reps : ''}"
               min="0" step="1" inputmode="numeric">
        <span class="input-label">reps</span>
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

    // Trim extra sets from DB
    await fetch(`/api/logs/trim/${exerciseId}/${date}/${rows.length}`, { method: 'DELETE' });

    // Refresh exercise data
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

    // Re-check PB badge
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
    if (isPB && !existingBadge) {
      const badge = document.createElement('span');
      badge.className = 'pb-badge';
      badge.textContent = 'NEW PB!';
      header.appendChild(badge);
    } else if (!isPB && existingBadge) {
      existingBadge.remove();
    }
  }

  function checkIsPB(ex, sets) {
    if (!ex || !ex.pb) return false;
    const maxWeight = ex.pb.max_weight || 0;
    for (const s of sets) {
      const w = parseFloat(s.weight_kg) || 0;
      const r = parseInt(s.reps) || 0;
      if (w > 0 && r > 0 && w >= maxWeight && maxWeight > 0) {
        // Check if this weight equals the PB max (means this session contains the PB)
        if (w >= maxWeight) return true;
      }
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

    // Renumber sets
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

  init();
})();
