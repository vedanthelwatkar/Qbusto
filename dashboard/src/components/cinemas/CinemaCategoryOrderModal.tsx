/**
 * Set one cinema's category display order.
 *
 * WHY THIS IS PER CINEMA
 *
 * Categories are chain-scoped, so the chain cannot hold this: one site wants
 * Desserts first, another in the same chain wants Appetizers. The order lives
 * on the `cinema_categories` link row that already joins the two, which is why
 * there is no new table and no new page - just this modal, opened from the
 * cinema it belongs to.
 *
 * WHAT "UNPLACED" MEANS ON SCREEN
 *
 * `sequence` 0 is the column's default, so every category starts unplaced.
 * Unplaced sorts AFTER everything placed, alphabetically - which is precisely
 * the alphabetical menu a cinema has always had. Moving one row is therefore
 * an opt-in that cannot reshuffle a cinema nobody has touched.
 *
 * The list saves as a POSITIONAL array: whatever order is on screen becomes
 * sequence 1..n. There is no sequence number to type, so two categories can
 * never be given the same one.
 *
 * Mounted only while open, matching every other modal in this app.
 */

import { useEffect, useState } from 'react';
import { Alert, App, Button, Empty, List, Modal, Space, Spin, Tag, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';

import type { CategoryOrderEntry } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as categoriesService from '@/services/categories.service';

const { Text } = Typography;

interface CinemaCategoryOrderModalProps {
  cinemaId: number;
  cinemaName: string;
  onClose: () => void;
}

/** Move one entry by one position, returning a new array. */
function move(entries: CategoryOrderEntry[], from: number, to: number): CategoryOrderEntry[] {
  if (to < 0 || to >= entries.length) return entries;

  const next = [...entries];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  return next;
}

export default function CinemaCategoryOrderModal({
  cinemaId,
  cinemaName,
  onClose,
}: CinemaCategoryOrderModalProps) {
  const { message } = App.useApp();

  const [entries, setEntries] = useState<CategoryOrderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Loaded once, on mount. `loading` starts true rather than being set here:
   * calling setState synchronously in an effect body causes a cascading render
   * (react-hooks/set-state-in-effect), and there is nothing to reset anyway -
   * the modal is mounted only while open, so cinemaId cannot change under it.
   */
  useEffect(() => {
    let live = true;

    categoriesService.listCategoryOrder(cinemaId).then(
      (loaded) => {
        if (!live) return;
        setEntries(loaded);
        setLoading(false);
      },
      (err) => {
        if (!live) return;
        setError(toApiError(err).message);
        setLoading(false);
      }
    );

    return () => {
      live = false;
    };
  }, [cinemaId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      // The array as it stands on screen IS the order.
      const saved = await categoriesService.setCategoryOrder(
        cinemaId,
        entries.map((entry) => entry.id).filter((id): id is number => typeof id === 'number')
      );

      setEntries(saved);
      message.success('Category order saved');
      onClose();
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Back to alphabetical. Sends an empty list, which resets every category to
   * unplaced rather than writing an explicit A-Z order - so a cinema that is
   * cleared behaves identically to one that was never ordered.
   */
  const handleReset = async () => {
    setSaving(true);
    setError(null);

    try {
      setEntries(await categoriesService.setCategoryOrder(cinemaId, []));
      message.success('Order cleared. Categories are alphabetical again.');
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={`Category order at ${cinemaName}`}
      onCancel={onClose}
      confirmLoading={saving}
      onOk={() => void handleSave()}
      okText="Save order"
      okButtonProps={{ disabled: loading || entries.length === 0 }}
      width={520}
    >
      <Space orientation="vertical" size="middle" style={{ display: 'flex' }}>
        <Text type="secondary">
          The order customers see in this cinema&apos;s menu. Other cinemas are unaffected.
        </Text>

        {error ? <Alert type="error" showIcon message={error} /> : null}

        {loading ? (
          <Spin />
        ) : entries.length === 0 ? (
          <Empty description="This chain has no active categories yet" />
        ) : (
          <>
            <List
              size="small"
              bordered
              dataSource={entries}
              renderItem={(entry, index) => (
                <List.Item
                  actions={[
                    <Button
                      key="up"
                      size="small"
                      type="text"
                      aria-label={`Move ${entry.name} up`}
                      icon={<ArrowUpOutlined />}
                      disabled={index === 0 || saving}
                      onClick={() => setEntries(move(entries, index, index - 1))}
                    />,
                    <Button
                      key="down"
                      size="small"
                      type="text"
                      aria-label={`Move ${entry.name} down`}
                      icon={<ArrowDownOutlined />}
                      disabled={index === entries.length - 1 || saving}
                      onClick={() => setEntries(move(entries, index, index + 1))}
                    />,
                  ]}
                >
                  <Space size="small">
                    <Tag>{index + 1}</Tag>
                    <span>{entry.name}</span>
                    {/* Honest about what has actually been saved, so the
                        numbers above are not mistaken for stored state. */}
                    {entry.sequence ? null : <Tag color="default">Not yet ordered</Tag>}
                  </Space>
                </List.Item>
              )}
            />

            <Button size="small" disabled={saving} onClick={() => void handleReset()}>
              Clear order (back to alphabetical)
            </Button>
          </>
        )}
      </Space>
    </Modal>
  );
}
