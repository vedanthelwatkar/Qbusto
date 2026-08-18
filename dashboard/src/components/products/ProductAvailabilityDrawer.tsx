/**
 * When a product is orderable, at one cinema.
 *
 * Availability is part of the product workflow rather than a screen of its own,
 * so this opens over the products table instead of living in the sidebar.
 *
 * The two-step load is what shapes it. A window hangs off a `cinemaProductId`,
 * and this screen starts from a product, so a cinema has to be chosen before
 * there is anything to show: (cinemaId, productId) resolves to the link through
 * GET /api/cinema-products, and the link's id is what the windows are read
 * with. The id is never constructed or guessed - a cinema that does not carry
 * the product simply has no link, which is an ordinary answer and gets its own
 * empty state.
 *
 * Mounted only while it is open, so opening it is a fresh mount.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Flex,
  List,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';

import type { Product, ProductAvailabilityHour } from '@/api/generated/cinemaOrderingAPI.schemas';
import CinemaSelect from '@/components/cinemas/CinemaSelect';
import { DAY_OF_WEEK_LABELS, dayOfWeekLabel } from '@/components/pricing/days';
import AvailabilityFormModal from '@/components/products/AvailabilityFormModal';
import { timeSortKey, windowLabel } from '@/components/products/availabilityTime';
import { toApiError } from '@/services/api';
import * as availabilityService from '@/services/availability.service';
import * as cinemaProductsService from '@/services/cinema-products.service';
import { useAuthStore } from '@/stores/auth.store';
import { useAvailabilityStore } from '@/stores/availability.store';
import { hasPermission } from '@/utils/permissions';

const { Text, Title } = Typography;

/**
 * Every day first, then Monday to Sunday.
 *
 * 0 leads because it applies to all seven and the backend checks it against
 * every one of them, so reading it after Sunday would be reading it too late.
 * 1-7 are ISO order, not `Date.getDay()` order.
 */
const DAY_ORDER = [0, 1, 2, 3, 4, 5, 6, 7];

/** Windows for one day, earliest first. */
function windowsForDay(hours: ProductAvailabilityHour[], day: number): ProductAvailabilityHour[] {
  return hours
    .filter((hour) => hour.dayOfWeek === day)
    .sort((left, right) => timeSortKey(left.startTime).localeCompare(timeSortKey(right.startTime)));
}

interface ProductAvailabilityDrawerProps {
  product: Product;
  onClose: () => void;
}

export default function ProductAvailabilityDrawer({
  product,
  onClose,
}: ProductAvailabilityDrawerProps) {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);

  const cinemaId = useAvailabilityStore((state) => state.cinemaId);
  const cinemaProduct = useAvailabilityStore((state) => state.cinemaProduct);
  const resolved = useAvailabilityStore((state) => state.resolved);
  const resolving = useAvailabilityStore((state) => state.resolving);
  const resolveError = useAvailabilityStore((state) => state.resolveError);
  const hours = useAvailabilityStore((state) => state.hours);
  const loadingHours = useAvailabilityStore((state) => state.loadingHours);
  const hoursError = useAvailabilityStore((state) => state.hoursError);
  const open = useAvailabilityStore((state) => state.open);
  const selectCinema = useAvailabilityStore((state) => state.selectCinema);
  const reload = useAvailabilityStore((state) => state.reload);
  const refreshHours = useAvailabilityStore((state) => state.refreshHours);
  const reset = useAvailabilityStore((state) => state.reset);

  const [formHour, setFormHour] = useState<ProductAvailabilityHour | undefined>();
  const [formDay, setFormDay] = useState<number | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  const canEdit = hasPermission(actor, 'Products', 'edit');
  const canDelete = hasPermission(actor, 'Products', 'delete');

  const productId = product.id;

  useEffect(() => {
    if (productId === undefined) return;

    open(productId);

    return reset;
  }, [open, reset, productId]);

  const openAdd = (day?: number) => {
    setFormHour(undefined);
    setFormDay(day);
    setFormOpen(true);
  };

  const openEdit = (hour: ProductAvailabilityHour) => {
    setFormHour(hour);
    setFormDay(undefined);
    setFormOpen(true);
  };

  const confirmDelete = (hour: ProductAvailabilityHour) => {
    if (hour.id === undefined) return;

    modal.confirm({
      title: 'Delete this availability window?',
      content:
        // dayOfWeekLabel rather than the map: an absent day must not read as
        // "Every day" in the one dialog that cannot be undone.
        `${dayOfWeekLabel(hour.dayOfWeek)} ${windowLabel(hour.startTime, hour.endTime)} ` +
        'will be removed. Availability windows are deleted outright rather than ' +
        'deactivated, so this cannot be undone.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await availabilityService.deleteAvailabilityHour(hour.id as number);
          message.success('Availability window deleted');
          void refreshHours();
        } catch (caught) {
          message.error(toApiError(caught).message);
          // Rethrown so antd keeps the dialog open on failure.
          throw caught;
        }
      },
    });
  };

  /**
   * Carrying the product at the chosen cinema.
   *
   * Deliberately an explicit action and not a side effect of picking a cinema:
   * the link is what pricing and ordering key off, so it is not something to
   * create on the user's behalf because they looked at a schedule.
   */
  const confirmAssign = () => {
    if (cinemaId === null || productId === undefined) return;

    modal.confirm({
      title: `Add ${product.name} to this cinema?`,
      content:
        'The cinema will carry this product, and availability windows can then be ' +
        'set for it here. Prices are configured separately under Pricing.',
      okText: 'Add product',
      onOk: async () => {
        setAssigning(true);

        try {
          await cinemaProductsService.createCinemaProduct({ cinemaId, productId });
          message.success(`${product.name} added to this cinema`);
          reload();
        } catch (caught) {
          message.error(toApiError(caught).message);
          throw caught;
        } finally {
          setAssigning(false);
        }
      },
    });
  };

  const schedule = (
    <List
      size="small"
      dataSource={DAY_ORDER}
      rowKey={(day) => String(day)}
      renderItem={(day) => {
        const windows = windowsForDay(hours, day);

        return (
          <List.Item>
            <Flex justify="space-between" align="flex-start" gap="middle" style={{ width: '100%' }}>
              <Text strong style={{ minWidth: 96 }}>
                {DAY_OF_WEEK_LABELS[day]}
              </Text>

              <Flex vertical align="flex-end" gap={4} style={{ flex: 1 }}>
                {windows.length === 0 ? (
                  <Text type="secondary">No availability</Text>
                ) : (
                  windows.map((hour) => (
                    <Space key={hour.id} size="small">
                      <Tag color="orange">{windowLabel(hour.startTime, hour.endTime)}</Tag>

                      {canEdit ? (
                        <Button size="small" type="link" onClick={() => openEdit(hour)}>
                          Edit
                        </Button>
                      ) : null}

                      {canDelete ? (
                        <Button size="small" type="link" danger onClick={() => confirmDelete(hour)}>
                          Delete
                        </Button>
                      ) : null}
                    </Space>
                  ))
                )}

                {canEdit ? (
                  <Button size="small" type="link" onClick={() => openAdd(day)}>
                    Add hours
                  </Button>
                ) : null}
              </Flex>
            </Flex>
          </List.Item>
        );
      }}
    />
  );

  // Not `let body` without one: the generated Product type makes `id` optional,
  // so a row without one never starts a load and every branch below would miss,
  // leaving a drawer that silently renders nothing at all.
  let body: React.ReactNode = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="Availability is unavailable for this product."
    />
  );

  if (cinemaId === null) {
    body = (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="Choose a cinema to see when this product is orderable there."
      />
    );
  } else if (resolving) {
    body = <Skeleton active paragraph={{ rows: 6 }} />;
  } else if (resolveError) {
    body = (
      <Alert
        type="error"
        showIcon
        message={resolveError}
        action={
          <Button size="small" onClick={reload}>
            Try again
          </Button>
        }
      />
    );
  } else if (resolved && !cinemaProduct) {
    body = (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Space orientation="vertical" size={4}>
            <Text>{product.name} is not carried at this cinema.</Text>
            <Text type="secondary">
              Availability is set per cinema, so the cinema has to carry the product before it can
              have opening hours for it.
            </Text>
          </Space>
        }
      >
        {canEdit ? (
          <Button type="primary" loading={assigning} onClick={confirmAssign}>
            Add to this cinema
          </Button>
        ) : null}
      </Empty>
    );
  } else if (cinemaProduct) {
    body = (
      <Space orientation="vertical" size="middle" className="stack">
        {cinemaProduct.isActive === false ? (
          <Alert
            type="warning"
            showIcon
            message="Withdrawn from this cinema"
            description={
              'The cinema no longer carries this product, so it is not orderable here ' +
              'whatever the hours below say. The windows are kept so the schedule ' +
              'survives being brought back.'
            }
          />
        ) : null}

        {hoursError ? (
          <Alert
            type="error"
            showIcon
            message={hoursError}
            action={
              <Button size="small" onClick={() => void refreshHours()}>
                Try again
              </Button>
            }
          />
        ) : null}

        {/* The schedule is withheld entirely when the load failed, not just
            emptied. Eight rows of "No availability" is what a product with no
            windows looks like, so drawing it from a failed request states the
            opposite of the truth - the windows may well exist and simply not
            have arrived. */}
        {loadingHours ? <Skeleton active paragraph={{ rows: 6 }} /> : null}

        {!loadingHours && !hoursError ? (
          <>
            {hours.length === 0 ? (
              <Alert
                type="info"
                showIcon
                message="No hours set"
                description={
                  'With no windows the product has no time-of-day restriction here - it ' +
                  'is orderable whenever the cinema is, subject to its date range. Add a ' +
                  'window to restrict it.'
                }
              />
            ) : null}

            {schedule}
          </>
        ) : null}
      </Space>
    );
  }

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      size={640}
      title="Availability"
      extra={
        canEdit && cinemaProduct ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openAdd()}>
            Add hours
          </Button>
        ) : null
      }
    >
      <Space orientation="vertical" size="middle" className="stack">
        <div>
          <Title level={5} style={{ marginBottom: 0 }}>
            {product.name}
          </Title>
          <Space size="small">
            {product.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
            {product.isAddon ? <Tag color="processing">Add-on</Tag> : null}
          </Space>
        </div>

        <div>
          <Text type="secondary">Cinema</Text>
          <CinemaSelect
            allowClear
            includeInactive
            value={cinemaId}
            onChange={selectCinema}
            // Owners see every chain's cinemas, and a cinema from another chain
            // could never carry this product, so the list is narrowed to the
            // product's own chain. Ignored by the backend for every other role,
            // which is already scoped to one.
            chainId={product.chainId}
            style={{ width: '100%', marginTop: 4 }}
          />
        </div>

        {body}
      </Space>

      {formOpen && cinemaProduct?.id !== undefined ? (
        <AvailabilityFormModal
          cinemaProductId={cinemaProduct.id}
          hour={formHour}
          defaultDayOfWeek={formDay}
          onClose={() => setFormOpen(false)}
          onSaved={() => void refreshHours()}
        />
      ) : null}
    </Drawer>
  );
}
