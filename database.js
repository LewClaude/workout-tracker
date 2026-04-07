const { Pool } = require('pg');

const dbUrl = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl ? { rejectUnauthorized: false } : false
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exercises (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      day INTEGER NOT NULL,
      phase INTEGER NOT NULL,
      session TEXT NOT NULL CHECK(session IN ('AM', 'PM')),
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS workout_logs (
      id SERIAL PRIMARY KEY,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      user_id INTEGER NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      set_number INTEGER NOT NULL,
      weight_kg REAL NOT NULL DEFAULT 0,
      reps INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS idx_logs_exercise_date ON workout_logs(exercise_id, date)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_logs_date ON workout_logs(date)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_logs_user ON workout_logs(user_id)');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL REFERENCES users(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    )
  `);

  // Seed exercises if empty
  const result = await pool.query('SELECT COUNT(*) as c FROM exercises');
  if (parseInt(result.rows[0].c) === 0) {
    await seedExercises();
  }
}

async function all(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function get(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows.length > 0 ? result.rows[0] : null;
}

async function run(sql, params = []) {
  await pool.query(sql, params);
}

async function insert(sql, params = []) {
  // Append RETURNING id if not already present
  const q = sql.toLowerCase().includes('returning') ? sql : sql + ' RETURNING id';
  const result = await pool.query(q, params);
  return result.rows[0] ? result.rows[0].id : null;
}

async function seedExercises() {
  const plan = {
    1: {
      1: {
        AM: ['Flat Barbell Bench Press', 'Incline Dumbbell Press', 'Cable Flyes', 'Tricep Pushdowns', 'Overhead Tricep Extension'],
        PM: ['Overhead Press', 'Lateral Raises', 'Front Raises', 'Face Pulls', 'Shrugs']
      },
      2: {
        AM: ['Barbell Rows', 'Lat Pulldowns', 'Seated Cable Rows', 'Barbell Curls', 'Hammer Curls'],
        PM: ['Pull-Ups', 'Rear Delt Flyes', 'Straight Arm Pulldowns', 'Preacher Curls', 'Wrist Curls']
      },
      3: {
        AM: ['Barbell Back Squat', 'Leg Press', 'Leg Extensions', 'Calf Raises', 'Seated Calf Raises'],
        PM: ['Romanian Deadlift', 'Leg Curls', 'Hip Thrusts', 'Bulgarian Split Squats', 'Glute Kickbacks']
      },
      4: {
        AM: ['Incline Barbell Bench', 'Dumbbell Flyes', 'Dips', 'Arnold Press', 'Lateral Raises'],
        PM: ['Close-Grip Bench Press', 'Skull Crushers', 'Barbell Curls', 'Incline Dumbbell Curls', 'Cable Curls']
      },
      5: {
        AM: ['Deadlift', 'T-Bar Rows', 'Single Arm Dumbbell Rows', 'Barbell Shrugs', 'Rack Pulls'],
        PM: ['Wide-Grip Pulldowns', 'Cable Rows', 'Reverse Flyes', 'Concentration Curls', 'Forearm Curls']
      },
      6: {
        AM: ['Front Squats', 'Hack Squats', 'Walking Lunges', 'Leg Extensions', 'Leg Curls'],
        PM: ['Hanging Leg Raises', 'Cable Crunches', 'Planks', 'Russian Twists', 'Ab Wheel Rollouts']
      }
    },
    2: {
      1: {
        AM: ['Flat Barbell Bench Press', 'Close-Grip Bench Press', 'Weighted Dips', 'Tricep Pushdowns', 'Diamond Push-Ups'],
        PM: ['Push Press', 'Seated Dumbbell Press', 'Lateral Raises', 'Cable Face Pulls', 'Plate Front Raises']
      },
      2: {
        AM: ['Pendlay Rows', 'Weighted Pull-Ups', 'Meadows Rows', 'Barbell Curls', 'Spider Curls'],
        PM: ['Chest-Supported Rows', 'Rear Delt Flyes', 'Straight Arm Pulldowns', 'Incline Curls', 'Reverse Curls']
      },
      3: {
        AM: ['Barbell Back Squat', 'Pause Squats', 'Leg Press', 'Standing Calf Raises', 'Seated Calf Raises'],
        PM: ['Sumo Deadlift', 'Nordic Curls', 'Hip Thrusts', 'Step-Ups', 'Glute Bridges']
      },
      4: {
        AM: ['Incline Dumbbell Press', 'Floor Press', 'Chest Dips', 'Military Press', 'Upright Rows'],
        PM: ['JM Press', 'Overhead Extensions', 'EZ Bar Curls', 'Cross-Body Curls', 'Reverse Grip Curls']
      },
      5: {
        AM: ['Conventional Deadlift', 'Barbell Rows', 'Chest-Supported Rows', 'Power Shrugs', 'Farmers Walks'],
        PM: ['Neutral Grip Pulldowns', 'Cable Rows', 'Band Pull-Aparts', 'Hammer Curls', 'Pinwheel Curls']
      },
      6: {
        AM: ['Safety Bar Squats', 'Leg Press', 'Sissy Squats', 'Leg Extensions', 'Leg Curls'],
        PM: ['Dragon Flags', 'Weighted Crunches', 'Pallof Press', 'Dead Bugs', 'Suitcase Carries']
      }
    },
    3: {
      1: {
        AM: ['Flat Barbell Bench Press', 'Spoto Press', 'Dumbbell Flyes', 'Rope Pushdowns', 'Kickbacks'],
        PM: ['Overhead Press', 'Z-Press', 'Cable Lateral Raises', 'Reverse Pec Deck', 'Barbell Shrugs']
      },
      2: {
        AM: ['Barbell Rows', 'Weighted Chin-Ups', 'Kroc Rows', 'Drag Curls', 'Bayesian Curls'],
        PM: ['Pullover Machine', 'Rear Delt Rows', 'Straight Arm Pulldowns', 'Preacher Curls', 'Wrist Rollers']
      },
      3: {
        AM: ['Barbell Back Squat', 'Anderson Squats', 'Leg Press', 'Donkey Calf Raises', 'Tibialis Raises'],
        PM: ['Romanian Deadlift', 'Good Mornings', 'Hip Thrusts', 'Reverse Lunges', 'Cable Pull-Throughs']
      },
      4: {
        AM: ['Decline Bench Press', 'Landmine Press', 'Svend Press', 'Seated DB Press', 'Lu Raises'],
        PM: ['French Press', 'Tate Press', 'Barbell Curls', '21s Curls', 'Behind-Back Curls']
      },
      5: {
        AM: ['Deficit Deadlift', 'Seal Rows', 'Helms Rows', 'Kirk Shrugs', 'Snatch Grip Deadlift'],
        PM: ['V-Bar Pulldowns', 'Machine Rows', 'Facepulls', 'Zottman Curls', 'Fat Grip Curls']
      },
      6: {
        AM: ['Belt Squats', 'Hack Squats', 'Pistol Squats', 'Leg Extensions', 'Leg Curls'],
        PM: ['Toes to Bar', 'Decline Sit-Ups', 'Copenhagen Planks', 'Woodchops', 'Farmer Walks']
      }
    }
  };

  for (const [phase, days] of Object.entries(plan)) {
    for (const [day, sessions] of Object.entries(days)) {
      for (const [session, exercises] of Object.entries(sessions)) {
        for (let idx = 0; idx < exercises.length; idx++) {
          await pool.query(
            'INSERT INTO exercises (name, day, phase, session, sort_order) VALUES ($1, $2, $3, $4, $5)',
            [exercises[idx], parseInt(day), parseInt(phase), session, idx]
          );
        }
      }
    }
  }
}

module.exports = { init, all, get, run, insert };
