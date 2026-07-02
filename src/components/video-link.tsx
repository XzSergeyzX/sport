import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { ConfirmDialog } from '@/components/confirm-dialog';

/** Открытие внешней ссылки-пруфа через подтверждение: показываем домен и полный URL,
 *  а не прыгаем мгновенно (по ссылкам с борда ходят чужие люди — фишинг-защита в UX,
 *  allowlist хостов — на подаче и в БД). */
export function useConfirmedVideoLink() {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);

  let host = '';
  try {
    host = url ? new URL(url).host : '';
  } catch {
    host = '';
  }

  const dialog = (
    <ConfirmDialog
      visible={!!url}
      title={`${t('leaderboard.openVideoTitle')} ${host}`}
      message={url ?? ''}
      confirmLabel={t('leaderboard.openVideoGo')}
      cancelLabel={t('common.cancel')}
      onConfirm={() => {
        if (url) Linking.openURL(url).catch(() => {});
        setUrl(null);
      }}
      onCancel={() => setUrl(null)}
    />
  );

  return { openVideo: setUrl, videoDialog: dialog };
}
