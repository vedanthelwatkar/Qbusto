/**
 * Read-only view of one banner.
 *
 * The image is shown rather than only its URL - a banner is a picture, and a
 * 500-character URL says nothing about whether the right one was pasted in.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Image, Skeleton, Tag } from 'antd';

import type { Banner } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as bannersService from '@/services/banners.service';

interface BannerDetailsDrawerProps {
  bannerId: number;
  /** Cinema names by id, resolved by the page for the rows it is showing. */
  cinemaNames?: Map<number, string>;
  onClose: () => void;
}

export default function BannerDetailsDrawer({
  bannerId,
  cinemaNames,
  onClose,
}: BannerDetailsDrawerProps) {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    bannersService
      .getBanner(bannerId)
      .then((loaded) => {
        if (!active) return;
        setBanner(loaded);
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
  }, [bannerId]);

  const cinemaLabel =
    banner?.cinemaId === undefined
      ? '-'
      : (cinemaNames?.get(banner.cinemaId) ?? `#${banner.cinemaId}`);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={480}
      title="Banner"
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <Skeleton active paragraph={{ rows: 5 }} /> : null}

      {banner ? (
        <>
          {banner.imageUrl ? (
            <Image
              src={banner.imageUrl}
              alt=""
              width="100%"
              style={{ marginBottom: 16, borderRadius: 8 }}
              // A banner that will not load is worth seeing as a broken image
              // rather than as a blank space that looks like no banner at all.
              fallback="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            />
          ) : null}

          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Cinema">{cinemaLabel}</Descriptions.Item>
            <Descriptions.Item label="Placement">
              {banner.type === 'I' ? 'Inner' : 'Header'}
            </Descriptions.Item>
            <Descriptions.Item label="Sequence">{banner.sequence ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Starts">
              {banner.startDate ? new Date(banner.startDate).toLocaleString() : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Ends">
              {banner.endDate ? new Date(banner.endDate).toLocaleString() : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Status">
              {banner.isActive === false ? <Tag>Inactive</Tag> : <Tag color="success">Active</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Image URL">{banner.imageUrl ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Created">
              {banner.createdAt ? new Date(banner.createdAt).toLocaleString() : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Updated">
              {banner.updatedAt ? new Date(banner.updatedAt).toLocaleString() : '-'}
            </Descriptions.Item>
          </Descriptions>
        </>
      ) : null}
    </Drawer>
  );
}
