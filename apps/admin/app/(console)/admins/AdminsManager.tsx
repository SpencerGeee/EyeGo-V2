'use client';

import { useState, useTransition } from 'react';

import { ActionButton } from '@/components/ui/ActionButton';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Icon } from '@/components/ui/Icon';
import { Modal } from '@/components/ui/Modal';
import { Avatar, Badge, Card, EmptyState } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { createAdmin, resetAdminPassword, updateAdmin } from '@/lib/actions';
import { dateTime, relative } from '@/lib/format';
import { ROLE_LABEL, ROLES, type Role } from '@/lib/roles';

export type AdminRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  lockedUntil?: string | null;
  createdAt: string;
};

/** Ambiguous glyphs excluded so a password read off a screen transcribes cleanly. */
function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  // Guarantees the API's composition rule is met.
  return `Ey${out}7`;
}

export function AdminsManager({
  admins,
  currentAdminId,
}: {
  admins: AdminRow[];
  currentAdminId: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<AdminRow | null>(null);

  const activeSuperadmins = admins.filter((a) => a.role === 'SUPERADMIN' && a.isActive).length;

  const columns: Column<AdminRow>[] = [
    {
      key: 'name',
      header: 'Admin',
      sortValue: (a) => a.name.toLowerCase(),
      render: (a) => (
        <>
          <Avatar name={a.name} size={28} />
          <span className="min-w-0">
            <span className="block truncate-1 max-w-[180px]">
              {a.name}
              {a.id === currentAdminId ? (
                <span className="text-text-faint"> (you)</span>
              ) : null}
            </span>
            <span className="block text-[11.5px] text-text-faint truncate-1 max-w-[180px]">
              {a.email}
            </span>
          </span>
        </>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortValue: (a) => a.role,
      render: (a) => (
        <Badge tone={a.role === 'SUPERADMIN' ? 'warn' : a.role === 'VIEWER' ? 'neutral' : 'info'}>
          {ROLE_LABEL[a.role]}
        </Badge>
      ),
    },
    {
      key: 'state',
      header: 'State',
      sortValue: (a) => (a.isActive ? 1 : 0),
      render: (a) => {
        if (!a.isActive) return <Badge tone="danger" icon="ban">Disabled</Badge>;
        if (a.lockedUntil && new Date(a.lockedUntil) > new Date()) {
          return <Badge tone="warn" icon="lock">Locked out</Badge>;
        }
        if (a.mustChangePassword) {
          return <Badge tone="warn" icon="alert">Must set password</Badge>;
        }
        return <Badge tone="accent" icon="check">Active</Badge>;
      },
    },
    {
      key: 'lastLogin',
      header: 'Last signed in',
      hideBelow: 'md',
      sortValue: (a) => a.lastLoginAt ?? null,
      render: (a) =>
        a.lastLoginAt ? (
          <span title={dateTime(a.lastLoginAt)}>
            {relative(a.lastLoginAt)}
            {a.lastLoginIp ? (
              <span className="block text-[11.5px] text-text-faint mono">{a.lastLoginIp}</span>
            ) : null}
          </span>
        ) : (
          <span className="text-text-faint">never</span>
        ),
    },
    {
      key: 'created',
      header: 'Created',
      align: 'right',
      hideBelow: 'lg',
      sortValue: (a) => a.createdAt,
      render: (a) => <span className="text-text-faint">{relative(a.createdAt)}</span>,
    },
  ];

  return (
    <>
      <Card flush>
        <div className="card-head">
          <div>
            <div className="t-heading">{admins.length} account{admins.length === 1 ? '' : 's'}</div>
            <div className="t-small text-text-faint mt-0.5">
              {activeSuperadmins} active superadmin{activeSuperadmins === 1 ? '' : 's'}
            </div>
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} />
            New admin
          </button>
        </div>

        <DataTable
          rows={admins}
          columns={columns}
          rowKey={(a) => a.id}
          caption="Console admin accounts"
          empty={<EmptyState icon="shield" title="No admin accounts" body="Create the first one." />}
          rowTone={(a) => (!a.isActive ? 'danger' : a.mustChangePassword ? 'warn' : null)}
          rowActions={(a) => {
            const isSelf = a.id === currentAdminId;
            // The last active superadmin must not be demotable or disable-able,
            // or the organisation locks itself out of its own console. The API
            // refuses this too; disabling it here just avoids a pointless error.
            const isLastSuperadmin = a.role === 'SUPERADMIN' && a.isActive && activeSuperadmins <= 1;

            return (
              <>
                <RoleChanger
                  admin={a}
                  disabled={isSelf || isLastSuperadmin}
                  disabledReason={
                    isSelf
                      ? 'You cannot change your own role.'
                      : 'This is the last active superadmin.'
                  }
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setResetting(a)}
                  title="Issue a new password and end every session for this account"
                >
                  <Icon name="lock" size={12} />
                  Reset
                </button>
                {a.isActive ? (
                  <ActionButton
                    action={() => updateAdmin(a.id, { isActive: false })}
                    label="Disable"
                    icon="ban"
                    variant="danger"
                    disabled={isSelf || isLastSuperadmin}
                    disabledReason={
                      isSelf
                        ? 'You cannot disable your own account.'
                        : 'This is the last active superadmin.'
                    }
                    confirm={{
                      title: `Disable ${a.name}?`,
                      body: 'Every session for this account ends immediately and they cannot sign in. Their audit history is kept.',
                      confirmLabel: 'Disable account',
                    }}
                  />
                ) : (
                  <ActionButton
                    action={() => updateAdmin(a.id, { isActive: true })}
                    label="Enable"
                    icon="check"
                    variant="secondary"
                    confirm={{
                      title: `Re-enable ${a.name}?`,
                      body: 'They will be able to sign in again with their existing password.',
                      confirmLabel: 'Enable account',
                    }}
                  />
                )}
              </>
            );
          }}
        />
      </Card>

      <CreateAdminDialog open={creating} onClose={() => setCreating(false)} />
      <ResetPasswordDialog admin={resetting} onClose={() => setResetting(null)} />
    </>
  );
}

function RoleChanger({
  admin,
  disabled,
  disabledReason,
}: {
  admin: AdminRow;
  disabled: boolean;
  disabledReason: string;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <label className="inline-flex items-center" title={disabled ? disabledReason : 'Change role'}>
      <span className="sr-only">Role for {admin.name}</span>
      <select
        className="select !w-auto !h-7 !text-xs"
        value={admin.role}
        disabled={disabled || pending}
        onChange={(e) => {
          const role = e.target.value;
          startTransition(async () => {
            const result = await updateAdmin(admin.id, { role });
            if (result.ok) toast.success(`${admin.name} is now ${ROLE_LABEL[role as Role]}`);
            else toast.error(result.message);
          });
        }}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

function CreateAdminDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('SUPPORT');
  const [password, setPassword] = useState(generatePassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  const reset = () => {
    setName('');
    setEmail('');
    setRole('SUPPORT');
    setPassword(generatePassword());
    setError(null);
    setIssued(null);
    onClose();
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    const result = await createAdmin({ name, email, password, role });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Shown once, on screen, so it can be handed over. Deliberately not emailed:
    // the console has no mail path, and pretending otherwise would leave the new
    // admin locked out with nobody knowing.
    setIssued({ email, password });
    toast.success('Admin created');
  };

  if (issued) {
    return (
      <Modal
        open={open}
        onClose={reset}
        title="Account created"
        description="Hand these over now — the password is not shown again."
        footer={
          <button type="button" className="btn btn-primary btn-sm" onClick={reset}>
            Done
          </button>
        }
      >
        <div className="p-3 rounded-md bg-surface-2 border border-line space-y-2">
          <div>
            <p className="t-eyebrow">Email</p>
            <p className="mono t-body">{issued.email}</p>
          </div>
          <div>
            <p className="t-eyebrow">Temporary password</p>
            <p className="mono t-body select-all">{issued.password}</p>
          </div>
        </div>
        <p className="hint mt-3">
          They must change it at first sign-in before they can use the console.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={reset}
      title="New admin account"
      description="They will be asked to set their own password at first sign-in."
      confirmOnDismiss={!!name || !!email}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-sm" onClick={reset} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={busy || name.trim().length < 2 || !email.includes('@')}
            aria-busy={busy}
          >
            {busy ? <Icon name="refresh" size={13} className="spin" /> : null}
            Create admin
          </button>
        </>
      }
    >
      {error ? (
        <div role="alert" className="flex items-start gap-2 p-3 mb-4 rounded-md bg-danger-soft border border-danger-rim">
          <Icon name="alert" size={14} className="text-danger mt-0.5" />
          <p className="t-small text-danger">{error}</p>
        </div>
      ) : null}

      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="admin-name">
            Full name
          </label>
          <input id="admin-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="admin-email">
            Work email
          </label>
          <input
            id="admin-email"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <p className="hint">This is their sign-in identity and cannot be changed later.</p>
        </div>
        <div>
          <label className="label" htmlFor="admin-role">
            Role
          </label>
          <select
            id="admin-role"
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <p className="hint">Grant the narrowest role that lets them do their job.</p>
        </div>
        <div>
          <label className="label" htmlFor="admin-password">
            Temporary password
          </label>
          <div className="flex gap-2">
            <input
              id="admin-password"
              className="input mono"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm flex-none"
              onClick={() => setPassword(generatePassword())}
            >
              <Icon name="refresh" size={13} />
              New
            </button>
          </div>
          <p className="hint">At least 12 characters with upper case, lower case and a digit.</p>
        </div>
      </div>
    </Modal>
  );
}

function ResetPasswordDialog({ admin, onClose }: { admin: AdminRow | null; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState(generatePassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const close = () => {
    setPassword(generatePassword());
    setError(null);
    setDone(false);
    onClose();
  };

  const submit = async () => {
    if (!admin) return;
    setError(null);
    setBusy(true);
    const result = await resetAdminPassword(admin.id, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(true);
    toast.success(result.message);
  };

  return (
    <Modal
      open={!!admin}
      onClose={close}
      title={admin ? `Reset password for ${admin.name}` : ''}
      description={
        done
          ? 'Hand this over now — it is not shown again.'
          : 'Every session for this account ends immediately, and they must set their own password at next sign-in.'
      }
      footer={
        done ? (
          <button type="button" className="btn btn-primary btn-sm" onClick={close}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={submit}
              disabled={busy || password.length < 12}
              aria-busy={busy}
            >
              {busy ? <Icon name="refresh" size={13} className="spin" /> : null}
              Reset password
            </button>
          </>
        )
      }
    >
      {error ? (
        <div role="alert" className="flex items-start gap-2 p-3 mb-4 rounded-md bg-danger-soft border border-danger-rim">
          <Icon name="alert" size={14} className="text-danger mt-0.5" />
          <p className="t-small text-danger">{error}</p>
        </div>
      ) : null}

      <label className="label" htmlFor="reset-password">
        New temporary password
      </label>
      <div className="flex gap-2">
        <input
          id="reset-password"
          className="input mono select-all"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          readOnly={done}
        />
        {!done ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm flex-none"
            onClick={() => setPassword(generatePassword())}
          >
            <Icon name="refresh" size={13} />
            New
          </button>
        ) : null}
      </div>
      <p className="hint">At least 12 characters with upper case, lower case and a digit.</p>
    </Modal>
  );
}
