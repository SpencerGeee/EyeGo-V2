'use strict';

/**
 * Creates the first console superadmin.
 *
 * Run once after migrating:
 *   node prisma/seed-admin.js --email you@eyego.app --name "Your Name"
 *
 * A password may be supplied with --password, but omitting it is better: one is
 * generated, printed once, and flagged mustChangePassword so it cannot become a
 * long-lived shared credential the way ADMIN_SECRET_KEY did.
 *
 * Idempotent: re-running for an existing email promotes that account to
 * SUPERADMIN and reactivates it rather than failing or creating a duplicate.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Ambiguous glyphs removed so a password read off a screen transcribes cleanly. */
function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  // Guarantee the composition rule in adminAuth.service is satisfied.
  return `Ey${out}7`;
}

async function main() {
  const email = (arg('email') || process.env.ADMIN_SEED_EMAIL || '').trim().toLowerCase();
  const name = arg('name') || process.env.ADMIN_SEED_NAME || 'Superadmin';
  const supplied = arg('password') || process.env.ADMIN_SEED_PASSWORD;

  if (!email || !email.includes('@')) {
    console.error('\n  Missing email.\n  Usage: node prisma/seed-admin.js --email you@eyego.app --name "Your Name"\n');
    process.exit(1);
  }

  const password = supplied || generatePassword();
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.adminUser.findUnique({ where: { email } });

  if (existing) {
    await prisma.adminUser.update({
      where: { email },
      data: { role: 'SUPERADMIN', isActive: true, failedLoginCount: 0, lockedUntil: null },
    });
    console.log(`\n  ${email} already existed — promoted to SUPERADMIN and reactivated.`);
    console.log('  Password unchanged. Use --password to set a new one, or the console\'s reset action.\n');
    return;
  }

  await prisma.adminUser.create({
    data: {
      email,
      name,
      role: 'SUPERADMIN',
      passwordHash,
      mustChangePassword: true,
    },
  });

  console.log('\n  ── Console superadmin created ──────────────────────');
  console.log(`  email:    ${email}`);
  if (!supplied) {
    console.log(`  password: ${password}`);
    console.log('  This is shown once. It must be changed at first sign-in.');
  } else {
    console.log('  password: (the one you supplied) — must be changed at first sign-in.');
  }
  console.log('  ───────────────────────────────────────────────────\n');
  console.log('  Next: set ADMIN_LEGACY_SECRET=false once the old console is retired,');
  console.log('  so the shared ADMIN_SECRET_KEY stops granting unattributed access.\n');
}

main()
  .catch((err) => {
    console.error('\n  Seed failed:', err.message, '\n');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
