/* In-memory stand-in for the Prisma models this feature touches (test-only). */
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
      if (args.skip) out = out.slice(args.skip);
      if (args.take) out = out.slice(0, args.take);
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
      if (!r) throw new Error('not found');
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
    invitations: model(),
    channels: model(),
  };
  db.$transaction = async (fn: (tx: Row) => Promise<unknown>) => fn(db);
  return db;
}

export type FakeDb = ReturnType<typeof fakePrisma>;
