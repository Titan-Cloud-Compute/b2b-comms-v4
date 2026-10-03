/**
 * In-memory PrismaService fake for general-channels unit tests.
 * Supports findFirst / findUnique / findMany / create / update / count
 * for every table this feature touches.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function matches(row: Row, where?: Row): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    if (k === 'AND') return (cond as Row[]).every((c) => matches(row, c));
    const val = row[k] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(val);
      if ('not' in cond) return val !== cond.not;
    }
    return val === cond;
  });
}

let _seq = 0;

function makeModel(defaults: Row = {}) {
  const rows: Row[] = [];
  return {
    rows,
    async findFirst(args?: Row) {
      const r = rows.find((x) => matches(x, args?.where));
      return r ? { ...r } : null;
    },
    async findUnique(args: Row) {
      const r = rows.find((x) => matches(x, args.where));
      return r ? { ...r } : null;
    },
    async findMany(args?: Row) {
      let out = rows.filter((r) => matches(r, args?.where));
      if (args?.orderBy) {
        // Support both object { key: dir } and array [{ key: dir }, ...]
        const orderByClauses: Array<Record<string, string>> = Array.isArray(args.orderBy)
          ? (args.orderBy as Array<Record<string, string>>)
          : [args.orderBy as Record<string, string>];
        out = [...out].sort((a, b) => {
          for (const clause of orderByClauses) {
            const entries = Object.entries(clause);
            if (entries.length > 0) {
              const [key, dir] = entries[0];
              const av = a[key];
              const bv = b[key];
              const cmp = av < bv ? -1 : av > bv ? 1 : 0;
              const result = dir === 'desc' ? -cmp : cmp;
              if (result !== 0) return result;
            }
          }
          return 0;
        });
      }
      return out.map((r) => ({ ...r }));
    },
    async create(args: Row) {
      const r: Row = { id: `id-${++_seq}`, createdAt: new Date(), ...defaults, ...args.data };
      rows.push(r);
      return { ...r };
    },
    async update(args: Row) {
      const r = rows.find((x) => matches(x, args.where));
      if (!r) throw new Error('record not found');
      Object.assign(r, args.data);
      return { ...r };
    },
    async count(args?: Row) {
      return rows.filter((r) => matches(r, args?.where)).length;
    },
  };
}

export function makeFakePrisma() {
  const db: any = {
    channels: makeModel(),
    messages: makeModel(),
    message_attachments: makeModel(),
    project_members: makeModel(),
    organizations: makeModel(),
    projects: makeModel(),
    channel_read_state: makeModel(),
    references: makeModel(),
    files: makeModel(),
    users: makeModel(),
    user: makeModel(),
  };

  const runTx = async (fn: (tx: any) => Promise<any>) => fn(db);
  db.runAsAdmin = runTx;
  db.$transaction = runTx;

  return db;
}

export type FakePrisma = ReturnType<typeof makeFakePrisma>;
