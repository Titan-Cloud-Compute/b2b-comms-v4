/**
 * In-memory stand-in for the Prisma models used by the General Channels feature.
 * Supports the findFirst / findMany / findUnique / create / update / count calls
 * that ChannelsService and ChannelAccessService make.
 * Test-only — never import from production code.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    if (key === 'AND') return (cond as Row[]).every((c) => matches(row, c));
    if (key === 'NOT') return !matches(row, cond as Row);
    const v = row[key] ?? null;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(v);
      if ('not' in cond) return v !== null && v !== cond.not;
    }
    return v === cond;
  });
}

let seq = 0;

function model(fill: (r: Row) => Row = (r) => r) {
  const rows: Row[] = [];
  return {
    rows,
    async findMany(args: Row = {}) {
      let out = rows.filter((r) => matches(r, args.where));
      if (args.orderBy && typeof args.orderBy === 'object') {
        const entries = Object.entries(args.orderBy as Record<string, string>);
        if (entries.length > 0) {
          const [field, dir] = entries[0];
          out = [...out].sort((a, b) => {
            const av = a[field] ?? null;
            const bv = b[field] ?? null;
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return dir === 'desc' ? -cmp : cmp;
          });
        }
      }
      if (args.skip) out = out.slice(args.skip as number);
      if (args.take) out = out.slice(0, args.take as number);
      return out.map((r) => ({ ...r }));
    },
    async findUnique(args: Row) {
      const r = rows.find((x) => matches(x, args.where));
      return r ? { ...r } : null;
    },
    async findFirst(args: Row = {}) {
      const r = rows.find((x) => matches(x, args.where));
      return r ? { ...r } : null;
    },
    async count(args: Row = {}) {
      return rows.filter((r) => matches(r, args.where)).length;
    },
    async create(args: Row) {
      const r = fill({ id: `id-${++seq}`, createdAt: new Date(), ...args.data });
      rows.push(r);
      return { ...r };
    },
    async update(args: Row) {
      const r = rows.find((x) => matches(x, args.where));
      if (!r) throw new Error('row not found');
      Object.assign(r, args.data);
      return { ...r };
    },
  };
}

export function fakePrisma() {
  const db: Row = {
    user: model((r) => ({ role: 'USER', organization_id: null, ...r })),
    organizations: model(),
    projects: model(),
    project_members: model(),
    channels: model(),
    channel_read_state: model(),
    messages: model(),
    message_attachments: model(),
    references: model(),
    files: model(),
  };
  // Both $transaction and runAsAdmin delegate to the in-memory db directly.
  db.$transaction = async (fn: (tx: Row) => Promise<unknown>) => fn(db);
  db.runAsAdmin = async (fn: (tx: Row) => Promise<unknown>) => fn(db);
  return db;
}

export type FakeDb = ReturnType<typeof fakePrisma>;
