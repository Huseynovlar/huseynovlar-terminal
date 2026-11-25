from __future__ import annotations

from typing import Any

# Event key -> {"en", "ru", "az"} human-readable labels for dot-notation audit event keys.
AUDIT_EVENT_LABELS: dict[str, dict[str, str]] = {
    "account.api_key_rotated": {
        "en": "Trading account bridge key rotated",
        "ru": "Ключ моста торгового счёта перевыпущен",
        "az": "Ticarət hesabının körpü açarı yeniləndi",
    },
    "account.created": {
        "en": "Trading account created",
        "ru": "Торговый счёт создан",
        "az": "Ticarət hesabı yaradıldı",
    },
    "account.deleted": {"en": "Trading account deleted", "ru": "Торговый счёт удалён", "az": "Ticarət hesabı silindi"},
    "account.updated": {
        "en": "Trading account updated",
        "ru": "Торговый счёт обновлён",
        "az": "Ticarət hesabı yeniləndi",
    },
    "ai_briefing.deleted": {"en": "AI briefing deleted", "ru": "AI-брифинг удалён", "az": "AI brifinqi silindi"},
    "asset.created": {"en": "Asset hub created", "ru": "Хаб актива создан", "az": "Aktiv hubı yaradıldı"},
    "asset.deleted": {"en": "Asset hub deleted", "ru": "Хаб актива удалён", "az": "Aktiv hubı silindi"},
    "asset.updated": {"en": "Asset hub updated", "ru": "Хаб актива обновлён", "az": "Aktiv hubı yeniləndi"},
    "auth.bootstrap_owner": {
        "en": "Owner account bootstrapped",
        "ru": "Создан первичный аккаунт владельца",
        "az": "İlkin sahib hesabı yaradıldı",
    },
    "auth.login_passkey": {"en": "Signed in with passkey", "ru": "Вход по passkey", "az": "Passkey ilə giriş"},
    "auth.login_password": {"en": "Signed in with password", "ru": "Вход по паролю", "az": "Parol ilə giriş"},
    "auth.logout": {"en": "Signed out", "ru": "Выход из системы", "az": "Sistemdən çıxış"},
    "auth.passkey_deleted": {"en": "Passkey deleted", "ru": "Passkey удалён", "az": "Passkey silindi"},
    "auth.passkey_registered": {
        "en": "Passkey registered",
        "ru": "Passkey зарегистрирован",
        "az": "Passkey qeydə alındı",
    },
    "auth.password_changed": {"en": "Password changed", "ru": "Пароль изменён", "az": "Parol dəyişdirildi"},
    "auth.session_revoked": {"en": "Session revoked", "ru": "Сессия отозвана", "az": "Sessiya ləğv edildi"},
    "auth.sessions_revoked_others": {
        "en": "Other sessions revoked",
        "ru": "Остальные сессии отозваны",
        "az": "Digər sessiyalar ləğv edildi",
    },
    "auth.totp_disabled": {"en": "2FA (TOTP) disabled", "ru": "2FA (TOTP) отключена", "az": "2FA (TOTP) söndürüldü"},
    "auth.totp_enabled": {"en": "2FA (TOTP) enabled", "ru": "2FA (TOTP) включена", "az": "2FA (TOTP) aktivləşdirildi"},
    "container.deleted": {"en": "Container deleted", "ru": "Контейнер удалён", "az": "Konteyner silindi"},
    "container.registered": {
        "en": "Container registered",
        "ru": "Контейнер зарегистрирован",
        "az": "Konteyner qeydə alındı",
    },
    "container.updated": {"en": "Container updated", "ru": "Контейнер обновлён", "az": "Konteyner yeniləndi"},
    "exness_profile.created": {
        "en": "Exness profile created",
        "ru": "Профиль Exness создан",
        "az": "Exness profili yaradıldı",
    },
    "exness_profile.deleted": {
        "en": "Exness profile deleted",
        "ru": "Профиль Exness удалён",
        "az": "Exness profili silindi",
    },
    "exness_profile.updated": {
        "en": "Exness profile updated",
        "ru": "Профиль Exness обновлён",
        "az": "Exness profili yeniləndi",
    },
    "files.avatar_uploaded": {"en": "Avatar uploaded", "ru": "Аватар загружен", "az": "Avatar yükləndi"},
    "journal.deal_annotated": {
        "en": "Deal notes/tags edited",
        "ru": "Заметки/теги сделки изменены",
        "az": "Əməliyyat qeydləri/teqləri dəyişdirildi",
    },
    "news_source.created": {
        "en": "News source added",
        "ru": "Источник новостей добавлен",
        "az": "Xəbər mənbəyi əlavə edildi",
    },
    "news_source.deleted": {
        "en": "News source deleted",
        "ru": "Источник новостей удалён",
        "az": "Xəbər mənbəyi silindi",
    },
    "news_source.updated": {
        "en": "News source updated",
        "ru": "Источник новостей обновлён",
        "az": "Xəbər mənbəyi yeniləndi",
    },
    "ops.kill_switch_queued": {
        "en": "Kill-switch command queued",
        "ru": "Команда аварийного закрытия поставлена в очередь",
        "az": "Fövqəladə bağlama əmri növbəyə qoyuldu",
    },
    "profile.updated": {"en": "Profile updated", "ru": "Профиль обновлён", "az": "Profil yeniləndi"},
    "robot.created": {"en": "Robot created", "ru": "Робот создан", "az": "Robot yaradıldı"},
    "robot.deleted": {"en": "Robot deleted", "ru": "Робот удалён", "az": "Robot silindi"},
    "robot.updated": {"en": "Robot updated", "ru": "Робот обновлён", "az": "Robot yeniləndi"},
    "treasury.operation_created": {
        "en": "Treasury operation created",
        "ru": "Казначейская операция создана",
        "az": "Xəzinə əməliyyatı yaradıldı",
    },
    "treasury.operation_deleted": {
        "en": "Treasury operation deleted",
        "ru": "Казначейская операция удалена",
        "az": "Xəzinə əməliyyatı silindi",
    },
    "treasury.operation_updated": {
        "en": "Treasury operation updated",
        "ru": "Казначейская операция обновлена",
        "az": "Xəzinə əməliyyatı yeniləndi",
    },
    "users.created": {"en": "User created", "ru": "Пользователь создан", "az": "İstifadəçi yaradıldı"},
    "users.deleted": {"en": "User deleted", "ru": "Пользователь удалён", "az": "İstifadəçi silindi"},
    "users.updated": {"en": "User updated", "ru": "Пользователь обновлён", "az": "İstifadəçi yeniləndi"},
    "vault.secret_deleted": {"en": "Vault secret deleted", "ru": "Секрет хранилища удалён", "az": "Seyf sirri silindi"},
    "vault.secret_updated": {
        "en": "Vault secret updated",
        "ru": "Секрет хранилища обновлён",
        "az": "Seyf sirri yeniləndi",
    },
    "wiki.created": {"en": "Wiki page created", "ru": "Страница вики создана", "az": "Wiki səhifəsi yaradıldı"},
    "wiki.deleted": {"en": "Wiki page deleted", "ru": "Страница вики удалена", "az": "Wiki səhifəsi silindi"},
    "wiki.updated": {"en": "Wiki page updated", "ru": "Страница вики обновлена", "az": "Wiki səhifəsi yeniləndi"},
    "wiki_category.created": {
        "en": "Wiki category created",
        "ru": "Категория вики создана",
        "az": "Wiki kateqoriyası yaradıldı",
    },
    "wiki_category.deleted": {
        "en": "Wiki category deleted",
        "ru": "Категория вики удалена",
        "az": "Wiki kateqoriyası silindi",
    },
    "wiki_category.updated": {
        "en": "Wiki category updated",
        "ru": "Категория вики обновлена",
        "az": "Wiki kateqoriyası yeniləndi",
    },
}


def audit_event_label(action: str) -> dict[str, str]:
    """Return {"en","ru","az"} labels; unknown keys fall back to the raw key in all languages."""
    labels = AUDIT_EVENT_LABELS.get(action)
    if labels:
        return dict(labels)
    return {"en": action, "ru": action, "az": action}


def audit_event_catalog() -> list[dict[str, Any]]:
    return [{"key": k, **v} for k, v in sorted(AUDIT_EVENT_LABELS.items())]
