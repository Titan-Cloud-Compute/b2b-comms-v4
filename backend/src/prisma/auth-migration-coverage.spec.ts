/**
 * Auth migration coverage: every auth column the shared `users` model declares
 * (display_name, organization_id, active) and every seeded demo role (USER,
 * MANAGER, ADMIN) must exist BOTH in schema.prisma AND in a committed
 * migration — a schema-only field generates a client that 500s at runtime
 * ("column does not exist") on a migrated database.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const PRISMA_DIR = join(__dirname, '..', '..', 'prisma');
const MIGRATIONS_DIR = join(PRISMA_DIR, 'migrations');

const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');

function block(kind: 'model' | 'enum', name: string): string {
  const m = schema.match(new RegExp(`^${kind} ${name} \\{([\\s\\S]*?)^\\}`, 'm'));
  return m ? m[1] : '';
}

const migrationSql = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^\d{4}_/.test(d.name))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((d) => {
    try {
      return readFileSync(join(MIGRATIONS_DIR, d.name, 'migration.sql'), 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

describe('auth migration coverage', () => {
  const userModel = block('model', 'User');
  const roleEnum = block('enum', 'UserRole');

  it('the User model and UserRole enum are found (non-vacuous)', () => {
    expect(userModel).not.toBe('');
    expect(roleEnum).not.toBe('');
  });

  it.each(['display_name', 'organization_id', 'active'])(
    'User.%s is declared in schema.prisma and added by a migration',
    (column) => {
      expect(userModel).toMatch(new RegExp(`^\\s*${column}\\s`, 'm'));
      expect(migrationSql).toMatch(
        new RegExp(`ALTER TABLE "User" ADD COLUMN (IF NOT EXISTS )?"${column}"`),
      );
    },
  );

  it.each(['USER', 'MANAGER', 'ADMIN'])(
    'role %s is in the UserRole enum and in the migrated enum type',
    (role) => {
      expect(roleEnum).toMatch(new RegExp(`^\\s*${role}\\s*$`, 'm'));
      expect(migrationSql).toMatch(new RegExp(`'${role}'`));
    },
  );
});
