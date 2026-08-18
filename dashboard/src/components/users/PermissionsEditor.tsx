/**
 * The permission grid on the user form: ten modules by three flags.
 *
 * Shaped as a controlled input (value / onChange) so antd's Form owns the state
 * like any other field, and so the value is already the `permissions` array the
 * API expects - PUT /api/users/{id} replaces the whole set, which is exactly
 * what this edits.
 *
 * A flag the acting user does not hold themselves is disabled rather than
 * hidden. The backend refuses to grant it ("You may only grant permissions that
 * you hold yourself" in user.service.js) and would answer with a 403 after the
 * form was filled in; showing it greyed out says so before that happens. As
 * everywhere else in the UI, the server is still the one that decides.
 */

import { Alert, Checkbox, Space, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';

import {
  MODULE_NAMES,
  type ModuleName,
  type PermissionAction,
  type User,
  type UserPermissionInput,
} from '@/types/auth';
import { hasPermission } from '@/utils/permissions';

const ACTIONS: { action: PermissionAction; attribute: keyof UserPermissionInput; label: string }[] =
  [
    { action: 'read', attribute: 'canRead', label: 'Read' },
    { action: 'edit', attribute: 'canEdit', label: 'Edit' },
    { action: 'delete', attribute: 'canDelete', label: 'Delete' },
  ];

/**
 * One line of the grid. The index signature is not decoration: the generated
 * UserPermissionInput carries one (the spec builds it with allOf), and a row is
 * handed back as exactly that.
 */
interface Row {
  [key: string]: unknown;
  moduleName: ModuleName;
  canRead: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

interface PermissionsEditorProps {
  /** Supplied by Form.Item. */
  value?: UserPermissionInput[];
  onChange?: (value: UserPermissionInput[]) => void;
  /** The signed-in user, whose own grants bound what they can hand out. */
  actor: User | null;
  disabled?: boolean;
}

export default function PermissionsEditor({
  value = [],
  onChange,
  actor,
  disabled = false,
}: PermissionsEditorProps) {
  const granted = new Map(value.map((entry) => [entry.moduleName, entry]));

  const rows: Row[] = MODULE_NAMES.map((moduleName) => {
    const entry = granted.get(moduleName);

    return {
      moduleName,
      canRead: entry?.canRead === true,
      canEdit: entry?.canEdit === true,
      canDelete: entry?.canDelete === true,
    };
  });

  /**
   * Only modules with at least one flag are sent: a row of three falses is the
   * same as no row, and the backend caps the array at one row per module.
   */
  const commit = (next: Row[]) => {
    onChange?.(next.filter((row) => row.canRead || row.canEdit || row.canDelete));
  };

  const toggle = (moduleName: ModuleName, attribute: keyof Row, checked: boolean) => {
    commit(
      rows.map((row) => (row.moduleName === moduleName ? { ...row, [attribute]: checked } : row))
    );
  };

  /**
   * Tick or clear a whole column from its header.
   *
   * Modules the acting user cannot grant are skipped rather than silently
   * failing, which is also why the header checkbox reads its state from that
   * same subset: "all" here means every row this person can actually set. Tick
   * all three headers and the user ends up with everything available to grant.
   */
  const toggleColumn = (attribute: keyof Row, action: PermissionAction, checked: boolean) => {
    commit(
      rows.map((row) =>
        hasPermission(actor, row.moduleName, action) ? { ...row, [attribute]: checked } : row
      )
    );
  };

  const columns: ColumnsType<Row> = [
    { title: 'Module', dataIndex: 'moduleName', key: 'moduleName' },
    ...ACTIONS.map(({ action, attribute, label }) => {
      const field = attribute as keyof Row;
      const grantable = rows.filter((row) => hasPermission(actor, row.moduleName, action));
      const selected = grantable.filter((row) => row[field] === true);

      return {
        title: (
          <Checkbox
            checked={grantable.length > 0 && selected.length === grantable.length}
            indeterminate={selected.length > 0 && selected.length < grantable.length}
            disabled={disabled || grantable.length === 0}
            onChange={(event) => toggleColumn(field, action, event.target.checked)}
            aria-label={`${label} for every module`}
          >
            {label}
          </Checkbox>
        ),
        key: attribute,
        width: 110,
        align: 'center' as const,
        render: (_: unknown, row: Row) => {
          const allowed = hasPermission(actor, row.moduleName, action);

          const checkbox = (
            <Checkbox
              checked={row[field] as boolean}
              disabled={disabled || !allowed}
              onChange={(event) => toggle(row.moduleName, field, event.target.checked)}
              aria-label={`${label} ${row.moduleName}`}
            />
          );

          return allowed ? (
            checkbox
          ) : (
            <Tooltip
              title={`You do not have ${label.toLowerCase()} access to ${row.moduleName}, so you cannot grant it`}
            >
              <span>{checkbox}</span>
            </Tooltip>
          );
        },
      };
    }),
  ];

  return (
    <Space orientation="vertical" size="small" className="stack">
      {actor?.role === 'owner' ? null : (
        <Alert type="info" showIcon message="You can only grant permissions you hold yourself." />
      )}

      <Table<Row>
        rowKey="moduleName"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={false}
      />
    </Space>
  );
}
