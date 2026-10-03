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
      if ('lt' in cond) return val !== null && val < (cond as Row).lt;
      if ('lte' in cond) return val !== null && val <= (cond as Row).lte;
      if ('gt' in cond) return val !== null && val > (cond as Row).gt;
      if ('gte' in cond) return val !== null && val >= (cond as Row).gte;
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
        // Support both a single object { field: dir } and an array [{ field: dir }, ...]
        const orderList: [string, string][] = Array.isArray(args.orderBy)
          ? (args.orderBy as Record<string, string>[]).flatMap((o) =>
              Object.entries(o) as [string, string][],
            )
          : (Object.entries(args.orderBy as Record<string, string>) as [string, string][]);

        if (orderList.length > 0) {
          out = [...out].sort((a, b) => {
            for (const [key, dir] of orderList) {
              const av = a[key] ?? null;
              const bv = b[key] ?? null;
              const cmp = av < bv ? -1 : av > bv ? 1 : 0;
              if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
            }
            return 0;
          });
        }
      }
      // Support Prisma-style `take` (limit rows returned).
      if (args?.take !== undefined) {
        out = out.slice(0, args.take as number);
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
