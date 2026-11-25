import type { ComponentProps, ReactNode } from "react";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/framework/i18n";

export interface AsyncButtonProps extends ComponentProps<typeof Button> {
  loading?: boolean;
  loadingText?: string;
  children: ReactNode;
}

/**
 * Institutional AsyncButton with spinner and localized loading label ("Идёт загрузка..." / "Сохранение...").
 */
export function AsyncButton({ loading = false, loadingText, disabled, children, ...props }: AsyncButtonProps) {
  const { t } = useI18n();
  const label = loadingText ?? t.common.loading;

  return (
    <Button disabled={disabled || loading} aria-busy={loading} {...props}>
      {loading ? (
        <>
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
          <span>{label}</span>
        </>
      ) : (
        children
      )}
    </Button>
  );
}
