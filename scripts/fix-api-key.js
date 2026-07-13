/**
 * Reset Default Admin Key to dev-admin-key (local dev only).
 * Usage: node scripts/fix-api-key.js
 */
const sqlite3 = require('sqlite3');
const { createHash } = require('crypto');
const { writeFileSync } = require('fs');
const path = require('path');

const KEY = 'dev-admin-key';
const hash = createHash('sha256').update(KEY).digest('hex');
const prefix = KEY.slice(0, 12);
const dbPath = path.resolve(process.cwd(), 'data', 'main.sqlite');

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.all(
    `SELECT id, name, keyPrefix, role, isActive FROM api_keys`,
    (err, rows) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      console.log('before:', rows);

      db.run(
        `UPDATE api_keys SET keyHash = ?, keyPrefix = ?, isActive = 1 WHERE role = 'admin'`,
        [hash, prefix],
        function (uErr) {
          if (uErr) {
            console.error(uErr);
            process.exit(1);
          }
          console.log('admin keys updated:', this.changes);

          if (this.changes === 0) {
            const id = require('crypto').randomUUID();
            db.run(
              `INSERT INTO api_keys (id, name, keyHash, keyPrefix, role, isActive, usageCount, createdAt, updatedAt)
               VALUES (?, 'Default Admin Key', ?, ?, 'admin', 1, 0, datetime('now'), datetime('now'))`,
              [id, hash, prefix],
              function (iErr) {
                if (iErr) console.error('insert failed', iErr);
                else console.log('inserted admin key', id);
                done();
              },
            );
          } else {
            done();
          }
        },
      );
    },
  );
});

function done() {
  writeFileSync(path.resolve(process.cwd(), 'data', '.api-key'), KEY);
  db.all(`SELECT id, name, keyPrefix, role, isActive FROM api_keys`, (err, rows) => {
    console.log('after:', rows);
    console.log('login with:', KEY);
    db.close();
  });
}
