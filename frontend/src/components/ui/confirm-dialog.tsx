import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AsyncButton } from "@/components/ui/async-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/framework/i18n";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Styled shadcn AlertDialog confirmation modal (F34).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = true,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useI18n();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel ?? t.common.cancel}</AlertDialogCancel>
          <AsyncButton
            variant={destructive ? "destructive" : "default"}
            loading={loading}
            loadingText={t.common.processing}
            onClick={() => void onConfirm()}
          >
            {confirmLabel ?? t.common.confirm}
          </AsyncButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  expectedValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
}

/**
 * Styled shadcn Dialog text-input prompt modal (F34).
 */
export function PromptDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  defaultValue = "",
  expectedValue,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
  onSubmit,
}: PromptDialogProps) {
  const { t } = useI18n();
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  const mismatch = expectedValue !== undefined && value.trim() !== expectedValue;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (mismatch) return;
            void onSubmit(value.trim());
          }}
        >
          <div className="space-y-1.5">
            {label ? <Label htmlFor="ht-prompt-input">{label}</Label> : null}
            <Input
              id="ht-prompt-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
              {cancelLabel ?? t.common.cancel}
            </Button>
            <AsyncButton
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={mismatch}
              loading={loading}
              loadingText={t.common.processing}
            >
              {confirmLabel ?? t.common.confirm}
            </AsyncButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
