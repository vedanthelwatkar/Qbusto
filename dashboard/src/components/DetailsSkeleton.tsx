import { Descriptions, Skeleton } from 'antd';

/**
 * The loading state for a details drawer.
 *
 * Every drawer in this app shows the same thing once loaded: a bordered,
 * single-column `Descriptions` of label/value rows. The previous placeholder
 * was `<Skeleton active paragraph={{ rows: n }} />` — a title bar over a stack
 * of full-width text lines, which is not the shape of a bordered table at all,
 * so the drawer visibly re-laid-out the moment the request returned.
 *
 * This renders the REAL `Descriptions`, with a shimmer where each value will
 * be, so the chrome (borders, label column width, row height, size="small"
 * padding) is produced by antd itself and cannot drift from the loaded view.
 * Only the contents are pending, which is the truth of the situation.
 */
interface DetailsSkeletonProps {
  /** How many rows the drawer shows when loaded. */
  rows: number;
  /** Height of the media block some drawers show above the table, in px. */
  mediaHeight?: number;
  /** Matches the loaded table's own `column`, which is 2 on wider drawers. */
  column?: number;
}

export default function DetailsSkeleton({ rows, mediaHeight, column = 1 }: DetailsSkeletonProps) {
  return (
    <div aria-busy="true">
      {mediaHeight ? (
        <Skeleton.Image active style={{ width: '100%', height: mediaHeight, marginBottom: 16 }} />
      ) : null}

      <Descriptions column={column} size="small" bordered>
        {Array.from({ length: rows }).map((_, index) => (
          <Descriptions.Item
            key={index}
            label={<Skeleton.Input active size="small" style={{ width: 96, minWidth: 96 }} />}
          >
            {/* Alternating widths, so the column reads as varied content
                rather than as a block of identical bars. */}
            <Skeleton.Input
              active
              size="small"
              style={{ width: index % 3 === 1 ? 120 : 180, minWidth: 120 }}
            />
          </Descriptions.Item>
        ))}
      </Descriptions>
    </div>
  );
}
