const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3");
const session = require("express-session");
const connectSqlite3 = require("connect-sqlite3");

const SQLiteStore = connectSqlite3(session);

let singleton = null;

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes
      });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row || null);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows || []);
    });
  });
}

async function initializeSchema(db) {
  await run(db, "PRAGMA foreign_keys = ON");
  await run(db, "PRAGMA journal_mode = WAL");
  await run(db, "PRAGMA busy_timeout = 5000");

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      mygpt_opt_in INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );

  await run(
    db,
    `CREATE TABLE IF NOT EXISTS saved_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      format TEXT,
      title TEXT NOT NULL,
      encrypted_payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`
  );

  await run(
    db,
    "CREATE INDEX IF NOT EXISTS idx_saved_items_user_kind ON saved_items (user_id, kind, updated_at DESC)"
  );
}

async function initializeDatabase(rootDir) {
  if (singleton) {
    return singleton;
  }

  const storageDir = path.join(rootDir, "storage");
  fs.mkdirSync(storageDir, { recursive: true });

  const dbPath = process.env.INTERVIEWPAL_DB_PATH || path.join(storageDir, "interviewpal.sqlite");
  const db = new sqlite3.Database(dbPath);

  await initializeSchema(db);

  singleton = {
    path: dbPath,
    db,
    run: (sql, params) => run(db, sql, params),
    get: (sql, params) => get(db, sql, params),
    all: (sql, params) => all(db, sql, params)
  };

  return singleton;
}

function createSessionStore(rootDir) {
  const storageDir = path.join(rootDir, "storage");
  fs.mkdirSync(storageDir, { recursive: true });

  return new SQLiteStore({
    db: "sessions.sqlite",
    dir: storageDir,
    concurrentDB: true
  });
}

module.exports = {
  createSessionStore,
  initializeDatabase
};
