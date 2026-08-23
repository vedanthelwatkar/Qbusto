import { useState } from 'react';
import { Alert, Button, Input, Progress, Radio, Space, Typography, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { DeleteOutlined, LinkOutlined, UploadOutlined } from '@ant-design/icons';

import { uploadImage, type UploadEntity } from '@/services/uploads.service';
import { isAllowedImageUrl, isLocalUpload, resolveImageUrl } from '@/utils/imageUrl';
import { toApiError } from '@/services/api';

const { Text } = Typography;

interface ImageFieldProps {
  /**
   * The stored value: an external URL, an `/uploads/...` path, or empty.
   *
   * Supplied by antd's Form.Item, which is why this component is a plain
   * controlled input rather than something that reads the form itself - the
   * surrounding modals keep their existing submit logic untouched.
   */
  value?: string | null;
  onChange?: (value: string | null) => void;
  /** Decides the upload folder and which permission the request needs. */
  entity: UploadEntity;
  disabled?: boolean;
}

type Mode = 'url' | 'upload';

/**
 * An image chosen either by URL or by uploading a file.
 *
 * Both modes write to the SAME field. An external URL is stored verbatim; an
 * upload stores the `/uploads/...` path the server returns. Nothing downstream
 * needs to know which was used, and switching between them is just a different
 * value in one column.
 */
export default function ImageField({ value, onChange, entity, disabled }: ImageFieldProps) {
  /**
   * Which tab is showing.
   *
   * Seeded from the value so opening a record that already has an uploaded
   * image lands on Upload, and one with an external URL lands on URL. Held in
   * state afterwards so switching tabs does not fight the user.
   */
  const [mode, setMode] = useState<Mode>(() => (isLocalUpload(value) ? 'upload' : 'url'));

  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  /**
   * A record loads after the first render, so the initial mode was guessed
   * from an empty value and has to be corrected once the real one arrives.
   *
   * Done while rendering rather than in an effect: an effect would paint the
   * wrong tab and then immediately render again. The correction is one-way -
   * an uploaded path selects the Upload tab, but nothing ever forces the user
   * back to URL - so choosing a tab by hand, or clearing the image, is not
   * undone on the next render.
   */
  const [seededFrom, setSeededFrom] = useState(value);

  if (value !== seededFrom) {
    setSeededFrom(value);
    setPreviewFailed(false);
    if (isLocalUpload(value)) setMode('upload');
  }

  const preview = resolveImageUrl(value);
  const urlLooksWrong = mode === 'url' && Boolean(value) && !isAllowedImageUrl(value ?? '');

  const clear = () => {
    setUploadError(null);
    setPreviewFailed(false);
    onChange?.(null);
  };

  /**
   * antd's Upload would normally POST the file itself. We take it over so the
   * request goes through the generated client, carries the session token, and
   * reports failures in the same shape as every other call.
   */
  const customRequest: UploadProps['customRequest'] = async (options) => {
    const file = options.file as File;

    setUploading(true);
    setUploadError(null);
    setPercent(10);

    try {
      // A single request, so there is no real byte-level progress to report.
      // The bar moves once to show the upload is live and completes on
      // success, rather than pretending to know how far along it is.
      setPercent(60);
      const uploaded = await uploadImage(entity, file);

      setPercent(100);
      setPreviewFailed(false);
      onChange?.(uploaded.path);
      options.onSuccess?.(uploaded);
    } catch (caught) {
      const message = toApiError(caught).message;
      setUploadError(message);
      options.onError?.(new Error(message));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Space orientation="vertical" size="small" className="stack">
      <Radio.Group
        value={mode}
        onChange={(event) => {
          setMode(event.target.value as Mode);
          setUploadError(null);
        }}
        optionType="button"
        buttonStyle="solid"
        size="small"
        disabled={disabled}
      >
        <Radio.Button value="url">
          <LinkOutlined /> Image URL
        </Radio.Button>
        <Radio.Button value="upload">
          <UploadOutlined /> Upload image
        </Radio.Button>
      </Radio.Group>

      {mode === 'url' ? (
        <Input
          placeholder="https://example.com/image.jpg"
          // A local path is shown read-only rather than hidden: switching to
          // the URL tab should not silently discard an uploaded image.
          value={value ?? ''}
          onChange={(event) => onChange?.(event.target.value || null)}
          maxLength={500}
          allowClear
          disabled={disabled}
        />
      ) : (
        <Upload
          accept="image/png,image/jpeg,image/gif,image/webp"
          showUploadList={false}
          maxCount={1}
          customRequest={customRequest}
          disabled={disabled || uploading}
        >
          <Button icon={<UploadOutlined />} loading={uploading} disabled={disabled}>
            {value && isLocalUpload(value) ? 'Replace image' : 'Choose image'}
          </Button>
        </Upload>
      )}

      {uploading ? <Progress percent={percent} size="small" status="active" /> : null}

      {uploadError ? (
        <Alert
          type="error"
          showIcon
          message={uploadError}
          closable
          onClose={() => setUploadError(null)}
        />
      ) : null}

      {urlLooksWrong ? (
        <Alert
          type="warning"
          showIcon
          message="This does not look like an http:// or https:// address"
        />
      ) : null}

      {value ? (
        <Space align="start" size="middle" wrap>
          {preview && !previewFailed ? (
            <img
              src={preview}
              alt=""
              className="image-field__preview"
              onError={() => setPreviewFailed(true)}
            />
          ) : (
            <span className="image-field__preview image-field__preview--empty">
              <Text type="secondary">No preview</Text>
            </span>
          )}

          <Space orientation="vertical" size={4}>
            <Text type="secondary" className="image-field__source">
              {isLocalUpload(value) ? 'Uploaded to this server' : 'External URL'}
            </Text>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={clear}
              disabled={disabled}
            >
              Remove
            </Button>
          </Space>
        </Space>
      ) : null}
    </Space>
  );
}
