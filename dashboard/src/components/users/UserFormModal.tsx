/**
 * Create and edit a user.
 *
 * One modal for both, because the fields are almost the same set: creating adds
 * a password and, for owners, a chain; editing drops both. `chainId` cannot
 * change after creation and a password is only ever set through
 * /api/auth/change-password, which is why neither appears on the edit form.
 *
 * Editing loads the user again through GET /api/users/{id} rather than reusing
 * the row from the table: the list endpoint does not include permissions, and
 * saving the form with an empty permission array would wipe them.
 *
 * Mounted only while it is open, so each open starts from a clean form and a
 * correct initial loading state instead of an effect resetting the last one.
 *
 * Client-side rules mirror the backend validators so the obvious mistakes are
 * caught before a round trip. Where the two disagree the server wins - its
 * field errors are mapped back onto the form below.
 */

import { useEffect, useState } from 'react';
import { Alert, App, Form, Input, Modal, Select, Spin, Switch } from 'antd';

import type {
  PostApiUsersBody,
  PutApiUsersIdBody,
} from '@/api/generated/cinemaOrderingAPI.schemas';
import ChainSelect from '@/components/chains/ChainSelect';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import PermissionsEditor from '@/components/users/PermissionsEditor';
import { toApiError } from '@/services/api';
import * as usersService from '@/services/users.service';
import { useAuthStore } from '@/stores/auth.store';
import { ROLES, type Role, type User, type UserPermissionInput } from '@/types/auth';
import { ROLE_LABELS } from '@/utils/permissions';
import { fieldErrorsFrom } from '@/utils/validation';

interface FormValues {
  username: string;
  password?: string;
  firstName?: string | null;
  lastName?: string | null;
  mobile?: string | null;
  role: Role;
  chainId?: number;
  cinemaId?: number | null;
  isActive: boolean;
  permissions: UserPermissionInput[];
}

interface UserFormModalProps {
  /** Omitted for a new user. Only `id` is read - the rest is refetched. */
  user?: User;
  onClose: () => void;
  onSaved: () => void;
}

export default function UserFormModal({ user, onClose, onSaved }: UserFormModalProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const userId = user?.id;
  const isEdit = userId !== undefined;
  const isSelf = actor?.id !== undefined && actor.id === userId;

  const [loading, setLoading] = useState(isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The modal closes itself and tells the parent afterwards, through
   * `afterClose`. Unmounting on the click instead would skip the closing
   * animation and make every dismissal look like a glitch.
   */
  const [visible, setVisible] = useState(true);

  /**
   * Owners can put a user in another chain, so the cinema list follows whatever
   * chain the form currently names. Every other role is scoped to one chain by
   * the backend, which ignores the parameter.
   */
  const chainId = Form.useWatch('chainId', form);

  useEffect(() => {
    if (userId === undefined) return;

    let active = true;

    usersService
      .getUser(userId)
      .then((full) => {
        if (!active) return;

        form.setFieldsValue({
          username: full.username,
          firstName: full.firstName,
          lastName: full.lastName,
          mobile: full.mobile,
          role: full.role,
          cinemaId: full.cinemaId,
          isActive: full.isActive !== false,
          permissions: (full.permissions ?? []) as UserPermissionInput[],
        });

        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        // Saving is blocked from here on: the form still holds the defaults for
        // a *new* user, so submitting it would write those over the account
        // that failed to load.
        setLoadFailed(true);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [form, userId]);

  const handleSubmit = async (values: FormValues) => {
    setSubmitting(true);
    setError(null);

    try {
      if (userId !== undefined) {
        const body: PutApiUsersIdBody = {
          username: values.username,
          firstName: values.firstName ?? null,
          lastName: values.lastName ?? null,
          mobile: values.mobile ?? null,
          role: values.role,
          cinemaId: values.cinemaId ?? null,
          isActive: values.isActive,
          permissions: values.permissions ?? [],
        };

        await usersService.updateUser(userId, body);
        message.success('User updated');
      } else {
        const body: PostApiUsersBody = {
          username: values.username,
          password: values.password ?? '',
          firstName: values.firstName ?? null,
          lastName: values.lastName ?? null,
          mobile: values.mobile ?? null,
          role: values.role,
          // Honoured for owners only; ignored for every other role, which
          // creates inside its own chain whatever is sent.
          //
          // Cleared means "omit the field", not "send null": the validator
          // types chainId as a positive integer with no null allowed, so a
          // null would come back as a 400 rather than defaulting to the
          // actor's own chain. cinemaId below is the opposite - it does allow
          // null, which is how a chain-wide role is expressed.
          chainId: values.chainId ?? undefined,
          cinemaId: values.cinemaId ?? null,
          isActive: values.isActive,
          permissions: values.permissions ?? [],
        };

        await usersService.createUser(body);
        message.success('User created');
      }

      onSaved();
      setVisible(false);
    } catch (caught) {
      const apiError = toApiError(caught);

      // A 400 names the fields it rejected, so put those messages where the
      // user is looking instead of only at the top of the form.
      form.setFields(fieldErrorsFrom<FormValues>(apiError));

      setError(apiError.message);
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={visible}
      title={isEdit ? `Edit ${user?.username ?? 'user'}` : 'New user'}
      okText={isEdit ? 'Save changes' : 'Create user'}
      onOk={() => form.submit()}
      onCancel={() => setVisible(false)}
      afterClose={onClose}
      confirmLoading={submitting}
      okButtonProps={{ disabled: loading || loadFailed }}
      width={720}
      // This form is taller than a laptop viewport once the permission grid is
      // in it. Centred with a scrolling body rather than antd's default, which
      // pins the modal 100px from the top and lets it run off the bottom of the
      // screen - taking the Save button with it.
      centered
      styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' } }}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      <Spin spinning={loading}>
        <Form<FormValues>
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={handleSubmit}
          disabled={submitting || loading || loadFailed}
          // Only meaningful when creating; the edit form is filled from the
          // response above, which overwrites all of these.
          initialValues={{
            role: 'cinema_admin',
            isActive: true,
            permissions: [],
            chainId: actor?.chainId,
          }}
        >
          <Form.Item
            name="username"
            label="Username"
            rules={[
              { required: true, message: 'Enter a username' },
              { min: 3, message: 'Use at least 3 characters' },
              { max: 50, message: 'Use at most 50 characters' },
            ]}
          >
            <Input autoComplete="off" />
          </Form.Item>

          {isEdit ? null : (
            <Form.Item
              name="password"
              label="Password"
              extra="The user can change this themselves after signing in."
              rules={[
                { required: true, message: 'Enter a password' },
                { min: 8, message: 'Use at least 8 characters' },
                { max: 72, message: 'Use at most 72 characters' },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          )}

          <Form.Item
            name="firstName"
            label="First name"
            rules={[{ max: 50, message: 'Use at most 50 characters' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="lastName"
            label="Last name"
            rules={[{ max: 50, message: 'Use at most 50 characters' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="mobile"
            label="Mobile"
            rules={[{ max: 15, message: 'Use at most 15 characters' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            name="role"
            label="Role"
            rules={[{ required: true, message: 'Choose a role' }]}
          >
            <Select
              options={ROLES.map((role) => ({
                value: role,
                label: ROLE_LABELS[role],
                // Only an owner may hand out the owner role - the backend
                // refuses it outright, so it is not offered.
                disabled: role === 'owner' && actor?.role !== 'owner',
              }))}
            />
          </Form.Item>

          {isEdit || actor?.role !== 'owner' ? null : (
            <Form.Item
              name="chainId"
              label="Chain"
              extra="Cannot be changed after the user is created."
            >
              <ChainSelect allowClear placeholder="Your own chain" />
            </Form.Item>
          )}

          <Form.Item
            name="cinemaId"
            label="Cinema"
            extra="Required for roles that work at a single cinema; leave empty for chain-wide roles."
          >
            <CinemaSelect
              allowClear
              placeholder="All cinemas"
              chainId={actor?.role === 'owner' ? chainId : undefined}
            />
          </Form.Item>

          <Form.Item
            name="isActive"
            label="Active"
            valuePropName="checked"
            extra={isSelf ? 'You cannot deactivate your own account.' : undefined}
          >
            <Switch disabled={isSelf} />
          </Form.Item>

          <Form.Item name="permissions" label="Permissions">
            <PermissionsEditor actor={actor} />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
