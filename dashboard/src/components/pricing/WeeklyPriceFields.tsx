/**
 * The seven day prices, plus the "Every day" filler and a per-day discount.
 *
 * WHAT THE CHECKBOX IS, AND WHAT IT IS NOT
 *
 * It is a FILL TOOL, not a mode and not a stored value. Tick it, type one
 * price, and all seven days take that price; then change the days that differ.
 * That is the whole point - the common case is "the same price all week", and
 * it should take one number, not seven.
 *
 * It deliberately does NOT untick itself when the days stop matching. A cinema
 * charging 100 on weekdays and 150 at the weekend is the normal shape of this
 * form, and a checkbox that flickered off as soon as the user did the thing the
 * form is for would read as an error. Nothing is derived from it and nothing is
 * sent to the server for it.
 *
 * Unticking it never clears anything. There is no branch here that writes a
 * day price on untick, which is the only way to be sure.
 *
 * AN EMPTY DAY IS A REAL ANSWER
 *
 * Blank means "not sold that day" - the product simply does not appear in the
 * customer's menu. It does not mean free, and it is not the same as 0. Live
 * data uses this: one cinema sells a product on Friday, Saturday and Sunday
 * only.
 *
 * EACH DAY HAS ITS OWN DISCOUNT
 *
 * A discount belongs to ONE day, independently of the other six - a Wednesday
 * discount must never apply on Thursday (cinema 1's live "Wednesday only, flat
 * Rs 75 off" pricing is exactly this shape). Rather than 42 permanent inputs -
 * seven days times six discount fields - each day's price row carries a small
 * "%"/"flat" tag that opens a Popover with that ONE day's discount fields.
 * Nothing else on the form changes shape; a day with no discount just shows a
 * plain "No discount" tag.
 */

import { useState } from 'react';
import {
  Checkbox,
  Col,
  Form,
  InputNumber,
  Popover,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import type { FormInstance } from 'antd';
import { TagOutlined } from '@ant-design/icons';

import { WEEKDAY_PRICE_FIELDS, dayDiscountFields } from '@/components/pricing/days';

const { Text } = Typography;

/** The DECIMAL(10,2) column's ceiling, shared by every price and discount input. */
const MAX_PRICE = 99999999.99;

interface WeeklyPriceFieldsProps {
  form: FormInstance;
  disabled?: boolean;
}

/** One day's discount editor, opened from that day's price row. */
function DayDiscountPopover({
  day,
  disabled,
}: {
  day: (typeof WEEKDAY_PRICE_FIELDS)[number];
  disabled?: boolean;
}) {
  const fields = dayDiscountFields(day.field);
  // Re-render this one popover's tag when its own day's type changes -
  // Form.useWatch is scoped to this field only, not the whole form.
  const type = Form.useWatch(fields.type);
  const amountMax = type === 'P' ? 100 : MAX_PRICE;
  const amountSuffix = type === 'P' ? '%' : '';

  const content = (
    <div style={{ width: 280 }}>
      <Form.Item
        name={fields.type}
        label={`${day.label} discount type`}
        style={{ marginBottom: 8 }}
        extra="Applies on this day only."
      >
        <Select
          allowClear
          placeholder="No discount"
          options={[
            { value: 'P', label: 'Percentage' },
            { value: 'F', label: 'Flat amount' },
          ]}
        />
      </Form.Item>

      {type ? (
        <>
          <Form.Item name={fields.value} label="Default amount" style={{ marginBottom: 8 }}>
            <InputNumber
              min={0}
              max={amountMax}
              precision={2}
              suffix={amountSuffix}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4, fontSize: 12 }}>
            Per-channel overrides, where they differ from the default above:
          </Text>
          <Row gutter={8}>
            <Col span={12}>
              <Form.Item name={fields.onQr} label="QR" style={{ marginBottom: 8 }}>
                <InputNumber
                  min={0}
                  max={amountMax}
                  precision={2}
                  suffix={amountSuffix}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name={fields.onSeatQr} label="Seat QR" style={{ marginBottom: 8 }}>
                <InputNumber
                  min={0}
                  max={amountMax}
                  precision={2}
                  suffix={amountSuffix}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name={fields.onKiosk} label="Kiosk" style={{ marginBottom: 0 }}>
                <InputNumber
                  min={0}
                  max={amountMax}
                  precision={2}
                  suffix={amountSuffix}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name={fields.onCounter} label="Counter" style={{ marginBottom: 0 }}>
                <InputNumber
                  min={0}
                  max={amountMax}
                  precision={2}
                  suffix={amountSuffix}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
          </Row>
        </>
      ) : null}
    </div>
  );

  return (
    <Popover
      content={content}
      title={`${day.label}'s discount`}
      trigger={disabled ? [] : 'click'}
      placement="right"
    >
      <Tag
        icon={<TagOutlined />}
        color={type ? 'processing' : undefined}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        {type ? (type === 'P' ? '% off' : 'flat off') : 'No discount'}
      </Tag>
    </Popover>
  );
}

export default function WeeklyPriceFields({ form, disabled }: WeeklyPriceFieldsProps) {
  const [everyday, setEveryday] = useState(false);
  const [everydayValue, setEverydayValue] = useState<number | null>(null);

  /** Write one price into all seven days. Discounts are untouched. */
  const fillWeek = (value: number | null) => {
    setEverydayValue(value);

    form.setFieldsValue(
      Object.fromEntries(WEEKDAY_PRICE_FIELDS.map(({ field }) => [field, value]))
    );
  };

  return (
    <>
      <Form.Item label="Every day" style={{ marginBottom: 8 }}>
        <Row gutter={12} align="middle" wrap={false}>
          <Col flex="none">
            <Checkbox
              checked={everyday}
              disabled={disabled}
              onChange={(event) => setEveryday(event.target.checked)}
            >
              Same price all week
            </Checkbox>
          </Col>

          <Col flex="auto">
            <InputNumber
              min={0}
              max={MAX_PRICE}
              precision={2}
              prefix="₹"
              placeholder="Price for every day"
              style={{ width: '100%' }}
              disabled={disabled || !everyday}
              value={everydayValue}
              onChange={fillWeek}
            />
          </Col>
        </Row>
      </Form.Item>

      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Each day can be changed on its own. Leave a day empty to stop selling the product that day.
        A day runs 6:00 am to 6:00 am, so Sunday&apos;s price applies until Monday 6:00 am. Click a
        day&apos;s tag to set a discount for that day only.
      </Text>

      <Row gutter={[12, 4]}>
        {WEEKDAY_PRICE_FIELDS.map((day) => (
          <Col xs={24} sm={12} md={8} key={day.field}>
            <Form.Item name={day.field} label={day.label} style={{ marginBottom: 4 }}>
              <InputNumber
                min={0}
                max={MAX_PRICE}
                precision={2}
                prefix="₹"
                placeholder="Not sold"
                style={{ width: '100%' }}
                disabled={disabled}
              />
            </Form.Item>
            <Space size={4} style={{ marginBottom: 12 }}>
              <DayDiscountPopover day={day} disabled={disabled} />
            </Space>
          </Col>
        ))}
      </Row>
    </>
  );
}
