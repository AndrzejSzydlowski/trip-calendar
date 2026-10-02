# Настройка бэкенда (Supabase)

Один суперпользователь (с 2FA по коду на email), остальные участники с ролями
**редактор** (чтение + правка) и **читатель** (только чтение), плюс полная
история изменений поездок — всё живёт в Postgres/Supabase, фронтенд (GitHub
Pages) обращается к нему напрямую.

## 1. Создать проект

1. Зарегистрируйтесь / войдите на [supabase.com](https://supabase.com) и создайте новый проект.
2. В **Project Settings → API** скопируйте `Project URL` и `anon public` ключ —
   впишите их в [`config.js`](../config.js) в корне репозитория.

## 2. Применить схему базы данных

Через Supabase CLI (из корня `trip-calendar`):

```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

Это создаст таблицы `profiles`, `trips`, `trip_history`, `mfa_codes`,
`admin_mfa_sessions`, политики RLS, триггер аудита и триггер
`handle_new_user` (первый зарегистрированный пользователь автоматически
становится суперпользователем).

Либо просто выполните содержимое [`migrations/0001_init.sql`](migrations/0001_init.sql)
в **SQL Editor** панели Supabase.

## 3. Задеплоить Edge Functions

```bash
npx supabase functions deploy send-mfa-code
npx supabase functions deploy verify-mfa-code
npx supabase functions deploy invite-user
npx supabase functions deploy set-user-role
npx supabase functions deploy remove-user
```

## 4. Настроить отправку писем (коды 2FA)

Функции `send-mfa-code` отправляют письма через [Resend](https://resend.com)
(есть бесплатный тариф). Зарегистрируйтесь, получите API-ключ и задайте
секреты проекта:

```bash
npx supabase secrets set RESEND_API_KEY=re_xxxxxxxx
npx supabase secrets set MFA_FROM_EMAIL="Trip Calendar <onboarding@resend.dev>"
```

(`onboarding@resend.dev` подходит для теста без своего домена; для прод-домена
подтвердите его в Resend и укажите свой адрес.)

## 5. Создать суперпользователя

Публичной формы регистрации в приложении нет — доступ только по
приглашению. Первый аккаунт (суперпользователь) создаётся вручную:

**Authentication → Users → Add user** в панели Supabase — укажите email и
пароль, включите «Auto Confirm User». Благодаря триггеру `handle_new_user`
этот первый пользователь получит роль `admin`.

При входе суперпользователя приложение запросит код из письма (2FA) —
убедитесь, что шаг 4 выполнен.

## 6. Пригласить остальных участников

Суперпользователь входит в приложение → кнопка **«Пользователи»** →
подтверждает код из письма → вводит email и роль (**редактор** или
**читатель**) в форме приглашения. Приглашённому придёт стандартное письмо
Supabase со ссылкой — по ней он задаст пароль и попадёт в приложение.

Чтобы ссылка-приглашение вела на опубликованный сайт, укажите его адрес в
**Authentication → URL Configuration → Site URL** (и добавьте в Redirect
URLs), например `https://<username>.github.io/trip-calendar/`.

## Роли и права

| Роль | Чтение календаря | Добавление/правка/удаление поездок | Управление пользователями |
|---|---|---|---|
| **admin** (один, с 2FA) | ✅ | ✅ | ✅ (приглашать, менять роли, удалять) |
| **editor** | ✅ | ✅ | ❌ |
| **viewer** | ✅ | ❌ | ❌ |

Всё это закреплено политиками Row Level Security в базе — проверка роли не
зависит от фронтенда и не может быть обойдена из браузера.

## История изменений

Каждая вставка/изменение/удаление поездки пишется в `trip_history` триггером
на стороне базы (`trips_audit()`), а не из клиентского кода — историю нельзя
подделать или пропустить. В карточке поездки есть кнопка **«История»** со
списком изменений (кто, когда, что именно изменилось).
