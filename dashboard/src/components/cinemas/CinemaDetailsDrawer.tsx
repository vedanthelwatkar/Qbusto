/**
 * Read-only view of one cinema.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, App, Button, Descriptions, Drawer, Skeleton, Space, Tag, Typography } from 'antd';

import type { Cinema, PaymentGatewayConfig } from '@/api/generated/cinemaOrderingAPI.schemas';
import CinemaPaymentGatewayModal from '@/components/cinemas/CinemaPaymentGatewayModal';
import { toApiError } from '@/services/api';
import * as cinemasService from '@/services/cinemas.service';
import * as gatewayConfigService from '@/services/paymentGatewayConfig.service';
import { useAuthStore } from '@/stores/auth.store';
import { hasPermission } from '@/utils/permissions';

const { Text } = Typography;

interface CinemaDetailsDrawerProps {
  cinemaId: number;
  /** Chain names by id, resolved by the page for the rows it is showing. */
  chainNames?: Map<number, string>;
  onClose: () => void;
}

export default function CinemaDetailsDrawer({
  cinemaId,
  chainNames,
  onClose,
}: CinemaDetailsDrawerProps) {
  const { message, modal } = App.useApp();
  const actor = useAuthStore((state) => state.user);
  const canEditGateway = hasPermission(actor, 'Settings', 'edit');
  const canDeleteGateway = hasPermission(actor, 'Settings', 'delete');

  const [cinema, setCinema] = useState<Cinema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [gatewayConfig, setGatewayConfig] = useState<PaymentGatewayConfig | null>(null);
  const [gatewayLoading, setGatewayLoading] = useState(true);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [gatewayModalOpen, setGatewayModalOpen] = useState(false);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    cinemasService
      .getCinema(cinemaId)
      .then((loaded) => {
        if (!active) return;
        setCinema(loaded);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(toApiError(caught).message);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cinemaId]);

  /** Bumped to re-run the fetch effect below after a save or deactivate. */
  const [gatewayRefreshKey, setGatewayRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;

    gatewayConfigService
      .getActiveConfig({ cinemaId })
      .then((loaded) => {
        if (active) setGatewayConfig(loaded);
      })
      .catch((caught: unknown) => {
        if (active) setGatewayError(toApiError(caught).message);
      })
      .finally(() => {
        if (active) setGatewayLoading(false);
      });

    return () => {
      active = false;
    };
    // cinemaId never changes for a mounted drawer instance - gatewayRefreshKey
    // is the only thing that ever re-triggers this fetch, and fetchGatewayConfig
    // below already puts the "loading again" state where a re-trigger belongs:
    // the event handler that causes it, not this effect.
  }, [cinemaId, gatewayRefreshKey]);

  const fetchGatewayConfig = () => {
    setGatewayLoading(true);
    setGatewayError(null);
    setGatewayRefreshKey((n) => n + 1);
  };

  const confirmDeactivateGateway = () => {
    modal.confirm({
      title: 'Deactivate Cashfree credentials?',
      content:
        `Checkout at ${cinema?.name ?? 'this cinema'} will stop working until new credentials ` +
        'are saved, unless a global fallback is configured. The row is kept, not deleted.',
      okText: 'Deactivate',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await gatewayConfigService.deactivateConfig({ cinemaId });
          message.success('Cashfree credentials deactivated');
          fetchGatewayConfig();
        } catch (caught) {
          message.error(toApiError(caught).message);
          throw caught;
        }
      },
    });
  };

  const chainLabel =
    cinema?.chainId === undefined ? '-' : (chainNames?.get(cinema.chainId) ?? `#${cinema.chainId}`);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={480}
      title={cinema?.name ?? 'Cinema'}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}

      {cinema ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="ID">
            {cinema.id !== undefined ? <Text copyable>{String(cinema.id)}</Text> : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Name">{cinema.name}</Descriptions.Item>
          <Descriptions.Item label="Code">
            <Text copyable>{cinema.code}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            {cinema.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="Chain">{chainLabel}</Descriptions.Item>
          <Descriptions.Item label="Location">
            {cinema.location ?? <Text type="secondary">Not set</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="City">
            {cinema.city ?? <Text type="secondary">Not set</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="GST number">
            {cinema.gstNumber ?? <Text type="secondary">Not set</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="FSSAI number">
            {cinema.fssaiNumber ?? <Text type="secondary">Not set</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Active since">
            {cinema.activeSince ? (
              new Date(cinema.activeSince).toLocaleDateString()
            ) : (
              <Text type="secondary">Not set</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Notifications">
            <Tag color={cinema.smsEnabled ? 'success' : 'default'}>
              SMS {cinema.smsEnabled ? 'on' : 'off'}
            </Tag>
            <Tag color={cinema.whatsappEnabled ? 'success' : 'default'}>
              WhatsApp {cinema.whatsappEnabled ? 'on' : 'off'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            {cinema.createdAt ? new Date(cinema.createdAt).toLocaleString() : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Updated">
            {cinema.updatedAt ? new Date(cinema.updatedAt).toLocaleString() : '-'}
          </Descriptions.Item>
        </Descriptions>
      ) : null}

      {cinema ? (
        <>
          <Typography.Title level={5} style={{ marginTop: 24 }}>
            Payment gateway
          </Typography.Title>

          {gatewayError ? (
            <Alert type="error" showIcon message={gatewayError} className="form-alert" />
          ) : null}

          {gatewayLoading ? (
            <Skeleton active paragraph={{ rows: 2 }} />
          ) : (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Status">
                {gatewayConfig ? <Tag color="success">Configured</Tag> : <Tag>Not configured</Tag>}
              </Descriptions.Item>

              {gatewayConfig ? (
                <>
                  <Descriptions.Item label="APP ID">
                    <Text copyable>{gatewayConfig.gatewayId}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="Environment">
                    <Tag color={gatewayConfig.environment === 'production' ? 'red' : 'default'}>
                      {gatewayConfig.environment}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Secret key">
                    {gatewayConfig.hasSecret ? (
                      <Text type="secondary">On file (encrypted, never shown)</Text>
                    ) : (
                      <Text type="danger">Missing</Text>
                    )}
                  </Descriptions.Item>
                </>
              ) : (
                <Descriptions.Item label="Note">
                  <Text type="secondary">
                    Checkout for this cinema falls back to the deployment&apos;s global Cashfree
                    credentials, if any are configured.
                  </Text>
                </Descriptions.Item>
              )}
            </Descriptions>
          )}

          {canEditGateway || canDeleteGateway ? (
            <Space style={{ marginTop: 12 }}>
              {canEditGateway ? (
                <Button size="small" onClick={() => setGatewayModalOpen(true)}>
                  {gatewayConfig ? 'Replace credentials' : 'Set up credentials'}
                </Button>
              ) : null}

              {canDeleteGateway && gatewayConfig ? (
                <Button size="small" danger onClick={confirmDeactivateGateway}>
                  Deactivate
                </Button>
              ) : null}
            </Space>
          ) : null}
        </>
      ) : null}

      {gatewayModalOpen && cinema ? (
        <CinemaPaymentGatewayModal
          cinemaId={cinemaId}
          cinemaName={cinema.name ?? 'this cinema'}
          onClose={() => setGatewayModalOpen(false)}
          onSaved={fetchGatewayConfig}
        />
      ) : null}
    </Drawer>
  );
}
