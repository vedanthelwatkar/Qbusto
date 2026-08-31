/**
 * Read-only view of one session, as the source system supplies it.
 *
 * Mounted only while it is open, so opening it is a fresh mount: the initial
 * state is the loading state, and no effect has to reach back and set it.
 */

import { useEffect, useState } from 'react';
import { Alert, Descriptions, Drawer, Typography } from 'antd';

import DetailsSkeleton from '@/components/DetailsSkeleton';

import type { Session } from '@/api/generated/cinemaOrderingAPI.schemas';
import { toApiError } from '@/services/api';
import * as sessionsService from '@/services/sessions.service';
import { formatDateTime } from '@/utils/datetime';

const { Text } = Typography;

interface SessionDetailsDrawerProps {
  /** The source system's session id. */
  sessionId: number;
  onClose: () => void;
}

export default function SessionDetailsDrawer({ sessionId, onClose }: SessionDetailsDrawerProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Closes itself, then tells the parent, so the slide-out animation runs. */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let active = true;

    sessionsService
      .getSession(sessionId)
      .then((loaded) => {
        if (!active) return;
        setSession(loaded);
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
  }, [sessionId]);

  return (
    <Drawer
      open={visible}
      onClose={() => setVisible(false)}
      afterOpenChange={(open) => {
        if (!open) onClose();
      }}
      size={480}
      title={session?.filmTitle ?? 'Session'}
    >
      {error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null}

      {loading ? <DetailsSkeleton rows={5} /> : null}

      {session ? (
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="Film">
            {session.filmTitle ?? <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Film code">
            {session.filmCode ?? <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Session id">{session.sessionId}</Descriptions.Item>
          <Descriptions.Item label="Cinema">
            {session.cinemaName ?? session.cinemaCode ?? <Text type="secondary">-</Text>}
          </Descriptions.Item>
          {/* Named, not referenced: the schedule does not carry a screen id. */}
          <Descriptions.Item label="Screen">
            {session.screenName ?? <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Starts">
            {session.startsAt ? formatDateTime(session.startsAt) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="Ends">
            {session.endsAt ? formatDateTime(session.endsAt) : <Text type="secondary">-</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="Seats">
            {session.seatsTotal === null || session.seatsTotal === undefined ? (
              <Text type="secondary">-</Text>
            ) : (
              `${session.seatsAvailable ?? '?'} available of ${session.seatsTotal}`
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Status">
            {session.status ?? <Text type="secondary">-</Text>}
          </Descriptions.Item>
        </Descriptions>
      ) : null}
    </Drawer>
  );
}
