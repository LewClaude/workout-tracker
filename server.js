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

// Auth middleware
async function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Not logged in' });

  const session = await db.get('SELECT user_id FROM sessions WHERE token = $1', [token]);
  if (!session) return res.status(401).json({ error: 'Invalid session' });

  req.userId = session.user_id;
  next();
}

// === Auth routes ===
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const existing = await db.get('SELECT id FROM users WHERE username = $1', [username]);
  if (existing) return res.status(400).json({ error: 'Username already taken' });

  const passwordHash = hashPassword(password);
  const userId = await db.insert('INSERT INTO users (username, password_hash) VALUES ($1, $2)', [username, passwordHash]);

  const token = generateToken();
  await db.run('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, userId]);

  res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60*60*24*365}`);
  res.json({ username });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = await db.get('SELECT * FROM users WHERE username = $1', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = generateToken();
  await db.run('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);

  res.setHeader('Set-Cookie', `token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60*60*24*365}`);
  res.json({ username: user.username });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies.token;
  if (token) await db.run('DELETE FROM sessions WHERE token = $1', [token]);
  res.setHeader('Set-Cookie', 'token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ success: true });
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({ user: null });

  const session = await db.get('SELECT user_id FROM sessions WHERE token = $1', [token]);
  if (!session) return res.json({ user: null });

  const user = await db.get('SELECT id, username FROM users WHERE id = $1', [session.user_id]);
  res.json({ user: user || null });
});

// === Exercise routes ===
app.get('/api/exercises', async (req, res) => {
  const { day, phase, session } = req.query;
  const exercises = await db.all(
    'SELECT * FROM exercises WHERE day = $1 AND phase = $2 AND session = $3 ORDER BY sort_order',
    [Number(day), Number(phase), session]
  );
  res.json(exercises);
});

app.get('/api/exercises/day', async (req, res) => {
  const { day, phase } = req.query;
  const exercises = await db.all(
    'SELECT * FROM exercises WHERE day = $1 AND phase = $2 ORDER BY session DESC, sort_order',
    [Number(day), Number(phase)]
  );
  res.json(exercises);
});

// === Workout log routes ===
app.get('/api/logs/:exerciseId/:date', requireAuth, async (req, res) => {
  const logs = await db.all(
    'SELECT * FROM workout_logs WHERE exercise_id = $1 AND date = $2 AND user_id = $3 ORDER BY set_number',
    [Number(req.params.exerciseId), req.params.date, req.userId]
  );
  res.json(logs);
});

app.get('/api/logs/date/:date', requireAuth, async (req, res) => {
  const logs = await db.all(`
    SELECT wl.*, e.name as exercise_name, e.session
    FROM workout_logs wl
    JOIN exercises e ON wl.exercise_id = e.id
    WHERE wl.date = $1 AND wl.user_id = $2
    ORDER BY e.session DESC, e.sort_order, wl.set_number
  `, [req.params.date, req.userId]);
  res.json(logs);
});

app.post('/api/logs', requireAuth, async (req, res) => {
  const { exercise_id, date, set_number, weight_kg, reps } = req.body;

  const existing = await db.get(
    'SELECT id FROM workout_logs WHERE exercise_id = $1 AND date = $2 AND set_number = $3 AND user_id = $4',
    [exercise_id, date, set_number, req.userId]
  );

  if (existing) {
    await db.run(
      'UPDATE workout_logs SET weight_kg = $1, reps = $2 WHERE id = $3',
      [weight_kg, reps, existing.id]
    );
    res.json({ id: existing.id, updated: true });
  } else {
    const lastId = await db.insert(
      'INSERT INTO workout_logs (exercise_id, date, set_number, weight_kg, reps, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [exercise_id, date, set_number, weight_kg, reps, req.userId]
    );
    res.json({ id: lastId, updated: false });
  }
});

app.delete('/api/logs/:id', requireAuth, async (req, res) => {
  await db.run('DELETE FROM workout_logs WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.userId]);
  res.json({ success: true });
});

app.delete('/api/logs/trim/:exerciseId/:date/:maxSet', requireAuth, async (req, res) => {
  await db.run(
    'DELETE FROM workout_logs WHERE exercise_id = $1 AND date = $2 AND set_number > $3 AND user_id = $4',
    [Number(req.params.exerciseId), req.params.date, Number(req.params.maxSet), req.userId]
  );
  res.json({ success: true });
});

// === PBs ===
app.get('/api/pbs', requireAuth, async (req, res) => {
  const pbs = await db.all(`
    SELECT e.id as exercise_id, e.name,
           MAX(wl.weight_kg) as max_weight,
           MAX(wl.weight_kg * wl.reps) as max_volume
    FROM workout_logs wl
    JOIN exercises e ON wl.exercise_id = e.id
    WHERE wl.weight_kg > 0 AND wl.reps > 0 AND wl.user_id = $1
    GROUP BY e.id, e.name
  `, [req.userId]);
  res.json(pbs);
});

app.get('/api/pbs/:exerciseId', requireAuth, async (req, res) => {
  const pb = await db.get(`
    SELECT MAX(weight_kg) as max_weight,
           MAX(weight_kg * reps) as max_volume
    FROM workout_logs
    WHERE exercise_id = $1 AND weight_kg > 0 AND reps > 0 AND user_id = $2
  `, [Number(req.params.exerciseId), req.userId]);
  res.json(pb || { max_weight: 0, max_volume: 0 });
});

// === History ===
app.get('/api/history/:exerciseId', requireAuth, async (req, res) => {
  const { before } = req.query;
  const prevDate = await db.get(`
    SELECT DISTINCT date FROM workout_logs
    WHERE exercise_id = $1 AND date < $2 AND user_id = $3
    ORDER BY date DESC LIMIT 1
  `, [Number(req.params.exerciseId), before, req.userId]);

  if (!prevDate) return res.json({ date: null, sets: [] });

  const sets = await db.all(`
    SELECT * FROM workout_logs
    WHERE exercise_id = $1 AND date = $2 AND user_id = $3
    ORDER BY set_number
  `, [Number(req.params.exerciseId), prevDate.date, req.userId]);

  res.json({ date: prevDate.date, sets });
});

// === Stats ===
app.get('/api/stats/:date', requireAuth, async (req, res) => {
  const stats = await db.get(`
    SELECT
      COUNT(*) as total_sets,
      COALESCE(SUM(weight_kg * reps), 0) as total_volume
    FROM workout_logs
    WHERE date = $1 AND weight_kg > 0 AND reps > 0 AND user_id = $2
  `, [req.params.date, req.userId]);

  const pbCount = await db.get(`
    SELECT COUNT(*) as count FROM (
      SELECT wl.exercise_id
      FROM workout_logs wl
      WHERE wl.date = $1 AND wl.weight_kg > 0 AND wl.reps > 0 AND wl.user_id = $2
      AND wl.weight_kg >= (
        SELECT MAX(w2.weight_kg) FROM workout_logs w2
        WHERE w2.exercise_id = wl.exercise_id AND w2.weight_kg > 0 AND w2.user_id = $3
      )
      AND NOT EXISTS (
        SELECT 1 FROM workout_logs w3
        WHERE w3.exercise_id = wl.exercise_id
        AND w3.date < wl.date
        AND w3.weight_kg >= wl.weight_kg
        AND w3.user_id = $4
      )
      GROUP BY wl.exercise_id
    ) sub
  `, [req.params.date, req.userId, req.userId, req.userId]);

  res.json({
    total_sets: stats ? parseInt(stats.total_sets) : 0,
    total_volume: stats ? Math.round(parseFloat(stats.total_volume)) : 0,
    pb_count: pbCount ? parseInt(pbCount.count) : 0
  });
});

// === User Settings (rest days) ===
app.get('/api/settings/rest-days', requireAuth, async (req, res) => {
  const setting = await db.get(
    "SELECT value FROM user_settings WHERE user_id = $1 AND key = 'rest_days'",
    [req.userId]
  );
  const restDays = setting ? JSON.parse(setting.value) : [0];
  res.json({ rest_days: restDays });
});

app.put('/api/settings/rest-days', requireAuth, async (req, res) => {
  const { rest_days } = req.body;
  const existing = await db.get(
    "SELECT value FROM user_settings WHERE user_id = $1 AND key = 'rest_days'",
    [req.userId]
  );
  if (existing) {
    await db.run(
      "UPDATE user_settings SET value = $1 WHERE user_id = $2 AND key = 'rest_days'",
      [JSON.stringify(rest_days), req.userId]
    );
  } else {
    await db.run(
      "INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'rest_days', $2)",
      [req.userId, JSON.stringify(rest_days)]
    );
  }
  res.json({ success: true, rest_days });
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

app.get('/api/weekly-volume', requireAuth, async (req, res) => {
  const { weeks } = req.query;
  const numWeeks = parseInt(weeks) || 8;

  const allExercises = await db.all('SELECT id, name FROM exercises');
  const exerciseGroupMap = {};
  allExercises.forEach(e => {
    exerciseGroupMap[e.id] = getExerciseMuscleGroup(e.name);
  });

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (numWeeks * 7));
  const startStr = startDate.toISOString().split('T')[0];

  const logs = await db.all(`
    SELECT exercise_id, date, weight_kg, reps
    FROM workout_logs
    WHERE user_id = $1 AND date >= $2 AND weight_kg > 0 AND reps > 0
    ORDER BY date
  `, [req.userId, startStr]);

  const weeklyData = {};
  logs.forEach(log => {
    const d = new Date(log.date);
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
app.put('/api/exercises/:id', async (req, res) => {
  const { name } = req.body;
  await db.run('UPDATE exercises SET name = $1 WHERE id = $2', [name, Number(req.params.id)]);
  res.json({ success: true });
});

app.post('/api/exercises', async (req, res) => {
  const { name, day, phase, session } = req.body;
  const maxOrder = await db.get(
    'SELECT COALESCE(MAX(sort_order), -1) as m FROM exercises WHERE day = $1 AND phase = $2 AND session = $3',
    [day, phase, session]
  );
  const sortOrder = (maxOrder ? parseInt(maxOrder.m) : -1) + 1;
  const lastId = await db.insert(
    'INSERT INTO exercises (name, day, phase, session, sort_order) VALUES ($1, $2, $3, $4, $5)',
    [name, day, phase, session, sortOrder]
  );
  res.json({ id: lastId, sort_order: sortOrder });
});

app.delete('/api/exercises/:id', async (req, res) => {
  const id = Number(req.params.id);
  await db.run('DELETE FROM workout_logs WHERE exercise_id = $1', [id]);
  await db.run('DELETE FROM exercises WHERE id = $1', [id]);
  res.json({ success: true });
});

app.put('/api/exercises/reorder', async (req, res) => {
  const { orders } = req.body;
  for (const o of orders) {
    await db.run('UPDATE exercises SET sort_order = $1 WHERE id = $2', [o.sort_order, o.id]);
  }
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
