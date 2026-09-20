import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

// Load via createRequire so the `node:sqlite` string literal survives bundling:
// esbuild/vite don't recognise this recent builtin and otherwise rewrite the
// import to a bare `sqlite` require that fails at runtime.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

export interface SessionRecord {
  id: string;
  title?: string;
  cwd?: string;
  parentId?: string;
  createdAt: number;
}

export interface SessionCatalog {
  record(id: string, info: { cwd?: string; parentId?: string }): void;
  setTitle(id: string, title: string): void;
  get(id: string): SessionRecord | undefined;
  list(filter?: { cwd?: string; parentId?: string }): SessionRecord[];
  delete(id: string): void;
  close(): void;
}

interface Row {
  id: string;
  title: string | null;
  cwd: string | null;
  parent_id: string | null;
  created_at: number;
}

const toRecord = (row: Row): SessionRecord => ({
  id: row.id,
  title: row.title ?? undefined,
  cwd: row.cwd ?? undefined,
  parentId: row.parent_id ?? undefined,
  createdAt: row.created_at,
});

export const createSessionCatalog = ({ file }: { file: string }): SessionCatalog => {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(
    'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, title TEXT, cwd TEXT, parent_id TEXT, created_at INTEGER NOT NULL)',
  );
  try {
    db.exec('ALTER TABLE sessions ADD COLUMN parent_id TEXT');
  } catch {
    void 0;
  }

  return {
    record: (id, info) => {
      db.prepare('INSERT OR IGNORE INTO sessions (id, cwd, parent_id, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        info.cwd ?? null,
        info.parentId ?? null,
        Date.now(),
      );
    },
    setTitle: (id, title) => {
      db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id);
    },
    get: (id) => {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as Row | undefined;
      return row ? toRecord(row) : undefined;
    },
    list: (filter) => {
      let sql = 'SELECT * FROM sessions';
      const params: (string | null)[] = [];
      if (filter?.parentId !== undefined) {
        sql += ' WHERE parent_id = ?';
        params.push(filter.parentId);
      } else {
        sql += ' WHERE parent_id IS NULL';
        if (filter?.cwd !== undefined) {
          sql += ' AND cwd = ?';
          params.push(filter.cwd);
        }
      }
      sql += ' ORDER BY created_at DESC';
      const rows = db.prepare(sql).all(...params) as unknown as Row[];
      return rows.map(toRecord);
    },
    delete: (id) => {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    },
    close: () => db.close(),
  };
};
