const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Get exercises for a specific day/phase/session
app.get('/api/exercises', (req, res) => {
  const { day, phase, session } = req.query;
  const exercises = db.all(
    'SELECT * FROM exercises WHERE day = ? AND phase = ? AND session = ? ORDER BY sort_order',
    [Number(day), Number(phase), session]
  );
  res.json(exercises);
});

// Get all exercises for a day/phase (both sessions)
app.get('/api/exercises/day', (req, res) => {
  const { day, phase } = req.query;
  const exercises = db.all(
    'SELECT * FROM exercises WHERE day = ? AND phase = ? ORDER BY session DESC, sort_order',
    [Number(day), Number(phase)]
  );
  res.json(exercises);
});

// Get logs for an exercise on a specific date
app.get('/api/logs/:exerciseId/:date', (req, res) => {
  const logs = db.all(
    'SELECT * FROM workout_logs WHERE exercise_id = ? AND date = ? ORDER BY set_number',
    [Number(req.params.exerciseId), req.params.date]
  );
  res.json(logs);
});

// Get all logs for a date
app.get('/api/logs/date/:date', (req, res) => {
  const logs = db.all(`
    SELECT wl.*, e.name as exercise_name, e.session
    FROM workout_logs wl
    JOIN exercises e ON wl.exercise_id = e.id
    WHERE wl.date = ?
    ORDER BY e.session DESC, e.sort_order, wl.set_number
  `, [req.params.date]);
  res.json(logs);
});

// Save a set log
app.post('/api/logs', (req, res) => {
  const { exercise_id, date, set_number, weight_kg, reps } = req.body;

  const existing = db.get(
    'SELECT id FROM workout_logs WHERE exercise_id = ? AND date = ? AND set_number = ?',
    [exercise_id, date, set_number]
  );

  if (existing) {
    db.run(
      'UPDATE workout_logs SET weight_kg = ?, reps = ? WHERE id = ?',
      [weight_kg, reps, existing.id]
    );
    res.json({ id: existing.id, updated: true });
  } else {
    const lastId = db.insert(
      'INSERT INTO workout_logs (exercise_id, date, set_number, weight_kg, reps) VALUES (?, ?, ?, ?, ?)',
      [exercise_id, date, set_number, weight_kg, reps]
    );
    res.json({ id: lastId, updated: false });
  }
});

// Delete a set log
app.delete('/api/logs/:id', (req, res) => {
  db.run('DELETE FROM workout_logs WHERE id = ?', [Number(req.params.id)]);
  res.json({ success: true });
});

// Delete all logs for an exercise on a date with set_number > given value
app.delete('/api/logs/trim/:exerciseId/:date/:maxSet', (req, res) => {
  db.run(
    'DELETE FROM workout_logs WHERE exercise_id = ? AND date = ? AND set_number > ?',
    [Number(req.params.exerciseId), req.params.date, Number(req.params.maxSet)]
  );
  res.json({ success: true });
});

// Get personal bests for all exercises
app.get('/api/pbs', (req, res) => {
  const pbs = db.all(`
    SELECT e.id as exercise_id, e.name,
           MAX(wl.weight_kg) as max_weight,
           MAX(wl.weight_kg * wl.reps) as max_volume
    FROM workout_logs wl
    JOIN exercises e ON wl.exercise_id = e.id
    WHERE wl.weight_kg > 0 AND wl.reps > 0
    GROUP BY e.id
  `);
  res.json(pbs);
});

// Get personal best for a specific exercise
app.get('/api/pbs/:exerciseId', (req, res) => {
  const pb = db.get(`
    SELECT MAX(weight_kg) as max_weight,
           MAX(weight_kg * reps) as max_volume
    FROM workout_logs
    WHERE exercise_id = ? AND weight_kg > 0 AND reps > 0
  `, [Number(req.params.exerciseId)]);
  res.json(pb || { max_weight: 0, max_volume: 0 });
});

// Get previous session data for an exercise
app.get('/api/history/:exerciseId', (req, res) => {
  const { before } = req.query;
  const prevDate = db.get(`
    SELECT DISTINCT date FROM workout_logs
    WHERE exercise_id = ? AND date < ?
    ORDER BY date DESC LIMIT 1
  `, [Number(req.params.exerciseId), before]);

  if (!prevDate) {
    return res.json({ date: null, sets: [] });
  }

  const sets = db.all(`
    SELECT * FROM workout_logs
    WHERE exercise_id = ? AND date = ?
    ORDER BY set_number
  `, [Number(req.params.exerciseId), prevDate.date]);

  res.json({ date: prevDate.date, sets });
});

// Get stats for a date
app.get('/api/stats/:date', (req, res) => {
  const stats = db.get(`
    SELECT
      COUNT(*) as total_sets,
      COALESCE(SUM(weight_kg * reps), 0) as total_volume
    FROM workout_logs
    WHERE date = ? AND weight_kg > 0 AND reps > 0
  `, [req.params.date]);

  const pbCount = db.get(`
    SELECT COUNT(*) as count FROM (
      SELECT wl.exercise_id
      FROM workout_logs wl
      WHERE wl.date = ? AND wl.weight_kg > 0 AND wl.reps > 0
      AND wl.weight_kg >= (
        SELECT MAX(w2.weight_kg) FROM workout_logs w2
        WHERE w2.exercise_id = wl.exercise_id AND w2.weight_kg > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM workout_logs w3
        WHERE w3.exercise_id = wl.exercise_id
        AND w3.date < wl.date
        AND w3.weight_kg >= wl.weight_kg
      )
      GROUP BY wl.exercise_id
    )
  `, [req.params.date]);

  res.json({
    total_sets: stats ? stats.total_sets : 0,
    total_volume: stats ? Math.round(stats.total_volume) : 0,
    pb_count: pbCount ? pbCount.count : 0
  });
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
