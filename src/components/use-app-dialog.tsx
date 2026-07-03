import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/confirm-dialog';

export type AppDialogOpts = {
  title: string;
  message?: string;
  confirmLabel?: string; // дефолт — common.ok
  cancelLabel?: string; // не задан → одна кнопка (алерт-режим)
  destructive?: boolean;
  onConfirm?: () => void;
};

/** Императивная замена нативного Alert.alert в стиле апки (белый системный квадрат — не наш).
 *  Паттерн как у useConfirmedVideoLink: вызывающий компонент рендерит {dialog} у себя. */
export function useAppDialog(): { showDialog: (opts: AppDialogOpts) => void; dialog: ReactNode } {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<AppDialogOpts | null>(null);
  const close = () => setOpts(null);

  const dialog = opts ? (
    <ConfirmDialog
      visible
      title={opts.title}
      message={opts.message}
      confirmLabel={opts.confirmLabel ?? t('common.ok')}
      cancelLabel={opts.cancelLabel}
      destructive={opts.destructive}
      onConfirm={() => {
        close();
        opts.onConfirm?.();
      }}
      onCancel={close}
    />
  ) : null;

  return { showDialog: setOpts, dialog };
}
