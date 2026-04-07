const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Parse cookies
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    header.split(';').forEach(c => {
      const [k, v] = c.trim().split('=');
      if (k && v) req.cookies[k] = decodeURIComponent(v);
    });
  }
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// === Auth helpers ===
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return hash === test;
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Auth middleware — attaches req.userId or returns 401
function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  const session = db.get('SELECT user_id FROM sessions WHERE token = ?', [token]);
  if (!session) return res.status(401).json({ error: 'Invalid session' });

  req.userId = session.user_id;
  next();
}

// === Auth routes ===
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const existing = db.get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(400).json({ error: 'Username already taken' });

  const passwordHash = hashPassword(password);
  const userId = db.insert('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);

  const token = generateToken();
  db.insert('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, userId]);

  res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60*60*24*365}`);
  res.json({ username });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = generateToken();
  db.insert('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, user.id]);

  res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60*60*24*365}`);
  res.json({ username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.cookies.token;
  if (token) db.run('DELETE FROM sessions WHERE token = ?', [token]);
  res.setHeader('Set-Cookie', 'token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ user: null });

  const session = db.get('SELECT user_id FROM sessions WHERE token = ?', [token]);
  if (!session) return res.json({ user: null });

  const user = db.get('SELECT id, username FROM users WHERE id = ?', [session.user_id]);
  res.json({ user: user || null });
});

// === Exercise routes (no auth needed, shared plan) ===
app.get('/api/exercises', (req, res) => {
  const { day, phase, session } = req.query;
  const exercises = db.all(
    'SELECT * FROM exercises WHERE day = ? AND phase = ? AND session = ? ORDER BY sort_order',
    [Number(day), Number(phase), session]
  );
  res.json(exercises);
});

app.get('/api/exercises/day', (req, res) => {
  const { day, phase } = req.query;
  const exercises = db.all(
    'SELECT * FROM exercises WHERE day = ? AND phase = ? ORDER BY session DESC, sort_order',
    [Number(day), Number(phase)]
  );
  res.json(exercises);
});

// === Workout log routes (auth required, user-scoped) ===
app.get('/api/logs/:exerciseId/:date', requireAuth, (req, res) => {
  const logs = db.all(
    'SELECT * FROM workout_logs WHERE exercise_id = ? AND date = ? AND user_id = ? ORDER BY set_number',
    [Number(req.params.exerciseId), req.params.date, req.userId]
  );
  res.json(logs);
});

app.get('/api/logs/date/:date', requireAuth, (req, res) => {
  const logs = db.all(`
    SELECT wl.*, e.name as exercise_name, e.session
    FROM workout_logs wl
    JOIN exercises e ON wl.exercise_id = e.id
    WHERE wl.date = ? AND wl.user_id = ?
    ORDER BY e.session DESC, e.sort_order, wl.set_number
  `, [req.params.date, req.userId]);
  res.json(logs);
});

app.post('/api/logs', requireAuth, (req, res) => {
  const { exercise_id, date, set_number, weight_kg, reps } = req.body;

  const existing = db.get(
    'SELECT id FROM workout_logs WHERE exercise_id = ? AND date = ? AND set_number = ? AND user_id = ?',
    [exercise_id, date, set_number, req.userId]
  );

  if (existing) {
    db.run(
      'UPDATE workout_logs SET weight_kg = ?, reps = ? WHERE id = ?',
      [weight_kg, reps, existing.id]
    );
    res.json({ id: existing.id, updated: true });
  } else {
    const lastId = db.insert(
      'INSERT INTO workout_logs (exercise_id, date, set_number, weight_kg, reps, user_id) VALUES (?, ?, ?, ?, ?, ?)',
      [exercise_id, date, set_number, weight_kg, reps, req.userId]
    );
    res.json({ id: lastId, updated: false });
  }
});

app.delete('/api/logs/:id', requireAuth, (req, res) => {
  db.run('DELETE FROM workout_logs WHERE id = ? AND user_id = ?', [Number(req.params.id), req.userId]);
  res.json({ success: true });
});

app.delete('/api/logs/trim/:exerciseId/:date/:maxSet', requireAuth, (req, res) => {
  db.run(
    'DELETE FROM workout_logs WHERE exercise_id = ? AND date = ? AND set_number > ? AND user_id = ?',
    [Number(req.params.exerciseId), req.params.date, Number(req.params.maxSet), req.userId]
  );
  res.json({ success: true });
});

// === PBs (user-scoped) ===
app.get('/api/pbs', requireAuth, (req, res) => {
  const pbs = db.all(`
    SELECT e.id as exercise_id, e.name,
           MAX(wl.weight_kg) as max_weight,
           MAX(wl.weight_kg * wl.reps) as max_volume
    FROM workout_logs wl
    JOIN exercises e ON wl.exercise_id = e.id
    WHERE wl.weight_kg > 0 AND wl.reps > 0 AND wl.user_id = ?
    GROUP BY e.id
  `, [req.userId]);
  res.json(pbs);
});

app.get('/api/pbs/:exerciseId', requireAuth, (req, res) => {
  const pb = db.get(`
    SELECT MAX(weight_kg) as max_weight,
           MAX(weight_kg * reps) as max_volume
    FROM workout_logs
    WHERE exercise_id = ? AND weight_kg > 0 AND reps > 0 AND user_id = ?
  `, [Number(req.params.exerciseId), req.userId]);
  res.json(pb || { max_weight: 0, max_volume: 0 });
});

// === History (user-scoped) ===
app.get('/api/history/:exerciseId', requireAuth, (req, res) => {
  const { before } = req.query;
  const prevDate = db.get(`
    SELECT DISTINCT date FROM workout_logs
    WHERE exercise_id = ? AND date < ? AND user_id = ?
    ORDER BY date DESC LIMIT 1
  `, [Number(req.params.exerciseId), before, req.userId]);

  if (!prevDate) return res.json({ date: null, sets: [] });

  const sets = db.all(`
    SELECT * FROM workout_logs
    WHERE exercise_id = ? AND date = ? AND user_id = ?
    ORDER BY set_number
  `, [Number(req.params.exerciseId), prevDate.date, req.userId]);

  res.json({ date: prevDate.date, sets });
});

// === Stats (user-scoped) ===
app.get('/api/stats/:date', requireAuth, (req, res) => {
  const stats = db.get(`
    SELECT
      COUNT(*) as total_sets,
      COALESCE(SUM(weight_kg * reps), 0) as total_volume
    FROM workout_logs
    WHERE date = ? AND weight_kg > 0 AND reps > 0 AND user_id = ?
  `, [req.params.date, req.userId]);

  const pbCount = db.get(`
    SELECT COUNT(*) as count FROM (
      SELECT wl.exercise_id
      FROM workout_logs wl
      WHERE wl.date = ? AND wl.weight_kg > 0 AND wl.reps > 0 AND wl.user_id = ?
      AND wl.weight_kg >= (
        SELECT MAX(w2.weight_kg) FROM workout_logs w2
        WHERE w2.exercise_id = wl.exercise_id AND w2.weight_kg > 0 AND w2.user_id = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM workout_logs w3
        WHERE w3.exercise_id = wl.exercise_id
        AND w3.date < wl.date
        AND w3.weight_kg >= wl.weight_kg
        AND w3.user_id = ?
      )
      GROUP BY wl.exercise_id
    )
  `, [req.params.date, req.userId, req.userId, req.userId]);

  res.json({
    total_sets: stats ? stats.total_sets : 0,
    total_volume: stats ? Math.round(stats.total_volume) : 0,
    pb_count: pbCount ? pbCount.count : 0
  });
});

// === Weekly volume by muscle group ===
const MUSCLE_GROUPS = {
  'Chest': ['bench', 'press', 'flye', 'fly', 'dip', 'push-up', 'pushup', 'svend', 'landmine press', 'spoto'],
  'Back': ['row', 'pull', 'deadlift', 'lat ', 'pulldown', 'chin', 'pullover', 'seal row', 'helms', 'kroc', 'meadows', 't-bar'],
  'Shoulders': ['overhead press', 'ohp', 'military', 'lateral raise', 'front raise', 'face pull', 'arnold', 'z-press', 'push press', 'lu raise', 'upright row', 'rear delt', 'reverse pec', 'shrug'],
  'Arms': ['curl', 'tricep', 'skull crush', 'extension', 'pushdown', 'kickback', 'jm press', 'french press', 'tate', '21s', 'forearm', 'wrist'],
  'Legs': ['squat', 'leg press', 'leg ext', 'leg curl', 'lunge', 'calf', 'hip thrust', 'glute', 'hack', 'step-up', 'split squat', 'pistol', 'nordic', 'good morning', 'belt squat', 'sissy', 'tibialis'],
  'Core': ['ab', 'crunch', 'plank', 'leg raise', 'russian twist', 'woodchop', 'pallof', 'dead bug', 'dragon flag', 'toes to bar', 'sit-up', 'copenhagen', 'rollout']
};

function getExerciseMuscleGroup(name) {
  const lower = name.toLowerCase();
  for (const [group, keywords] of Object.entries(MUSCLE_GROUPS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return group;
    }
  }
  return 'Other';
}

app.get('/api/weekly-volume', requireAuth, (req, res) => {
  const { weeks } = req.query;
  const numWeeks = parseInt(weeks) || 8;

  // Get all exercises to map to muscle groups
  const allExercises = db.all('SELECT id, name FROM exercises');
  const exerciseGroupMap = {};
  allExercises.forEach(e => {
    exerciseGroupMap[e.id] = getExerciseMuscleGroup(e.name);
  });

  // Get logs for the last N weeks
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (numWeeks * 7));
  const startStr = startDate.toISOString().split('T')[0];

  const logs = db.all(`
    SELECT exercise_id, date, weight_kg, reps
    FROM workout_logs
    WHERE user_id = ? AND date >= ? AND weight_kg > 0 AND reps > 0
    ORDER BY date
  `, [req.userId, startStr]);

  // Group by week and muscle group
  const weeklyData = {};
  logs.forEach(log => {
    const d = new Date(log.date);
    // Get Monday of that week
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    const weekKey = monday.toISOString().split('T')[0];

    const group = exerciseGroupMap[log.exercise_id] || 'Other';
    if (!weeklyData[weekKey]) weeklyData[weekKey] = {};
    if (!weeklyData[weekKey][group]) weeklyData[weekKey][group] = 0;
    weeklyData[weekKey][group] += log.weight_kg * log.reps;
  });

  // Build ordered result
  const weeks_arr = Object.keys(weeklyData).sort();
  const groups = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core'];
  const result = weeks_arr.map(w => {
    const entry = { week: w };
    groups.forEach(g => {
      entry[g] = Math.round(weeklyData[w][g] || 0);
    });
    return entry;
  });

  res.json({ groups, data: result });
});

// === Editor API ===
app.put('/api/exercises/:id', (req, res) => {
  const { name } = req.body;
  db.run('UPDATE exercises SET name = ? WHERE id = ?', [name, Number(req.params.id)]);
  res.json({ success: true });
});

app.post('/api/exercises', (req, res) => {
  const { name, day, phase, session } = req.body;
  const maxOrder = db.get(
    'SELECT COALESCE(MAX(sort_order), -1) as m FROM exercises WHERE day = ? AND phase = ? AND session = ?',
    [day, phase, session]
  );
  const sortOrder = (maxOrder ? maxOrder.m : -1) + 1;
  const lastId = db.insert(
    'INSERT INTO exercises (name, day, phase, session, sort_order) VALUES (?, ?, ?, ?, ?)',
    [name, day, phase, session, sortOrder]
  );
  res.json({ id: lastId, sort_order: sortOrder });
});

app.delete('/api/exercises/:id', (req, res) => {
  const id = Number(req.params.id);
  db.run('DELETE FROM workout_logs WHERE exercise_id = ?', [id]);
  db.run('DELETE FROM exercises WHERE id = ?', [id]);
  res.json({ success: true });
});

app.put('/api/exercises/reorder', (req, res) => {
  const { orders } = req.body;
  for (const o of orders) {
    db.run('UPDATE exercises SET sort_order = ? WHERE id = ?', [o.sort_order, o.id]);
  }
  db.save();
  res.json({ success: true });
});

// Start server after DB is ready
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Workout Tracker running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
