# RG Store with Supabase

This project now includes a static storefront and a static admin panel that can both use the same Supabase database.

Main files:

- [index.html](/C:/Users/goped/OneDrive/Documents/New%20project/index.html)
- [admin/index.html](/C:/Users/goped/OneDrive/Documents/New%20project/admin/index.html)
- [js/supabase-config.js](/C:/Users/goped/OneDrive/Documents/New%20project/js/supabase-config.js)
- [supabase/schema.sql](/C:/Users/goped/OneDrive/Documents/New%20project/supabase/schema.sql)
- [supabase/seed.sql](/C:/Users/goped/OneDrive/Documents/New%20project/supabase/seed.sql)

## What Works

- Store loads products, categories, and store settings from Supabase
- Admin login uses Supabase Auth email/password
- Admin edits sync products, categories, store info, coupons, customers, and orders back to Supabase
- Store orders are inserted into Supabase so they appear in admin

## Supabase Setup

1. Create a new Supabase project.
2. In Supabase SQL Editor, run [supabase/schema.sql](/C:/Users/goped/OneDrive/Documents/New%20project/supabase/schema.sql).
3. Then run [supabase/seed.sql](/C:/Users/goped/OneDrive/Documents/New%20project/supabase/seed.sql).
4. If you already ran the older schema before customer login was added, also run [supabase/customer-auth-upgrade.sql](/C:/Users/goped/OneDrive/Documents/New%20project/supabase/customer-auth-upgrade.sql).
5. In Supabase Auth, create an admin user with email and password.
6. In SQL Editor, insert that user into `public.admin_profiles`.

Example:

```sql
insert into public.admin_profiles (id, email, full_name)
values ('YOUR_AUTH_USER_ID', 'admin@example.com', 'RG Admin');
```

7. Open [js/supabase-config.js](/C:/Users/goped/OneDrive/Documents/New%20project/js/supabase-config.js) and replace:

- `https://YOUR-PROJECT.supabase.co`
- `YOUR-ANON-KEY`

Use the Project URL and anon public key from your Supabase project settings.

## Customer Login

- Store signup/login now uses Supabase Auth email and password.
- Store login/signup can now use email OTP through Supabase Auth.
- Google sign-in is wired in code, but you still need to enable the Google provider in Supabase and Google Cloud.
- If email confirmation is enabled in Supabase, customers may need to confirm their email before logging in.

## Enable Email OTP

1. In Supabase, go to `Authentication` -> `Providers` -> `Email`.
2. Keep Email enabled.
3. For OTP emails, update the Magic Link email template so it uses `{{ .Token }}` instead of `{{ .ConfirmationURL }}`.
4. Set your `Site URL` and allowed redirect URLs in `Authentication` -> `URL Configuration`.

Supabase docs:

- [Email OTP / passwordless docs](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [signInWithOtp JS reference](https://supabase.com/docs/reference/javascript/auth-signinwithotp)
- [verifyOtp JS reference](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [Redirect URLs docs](https://supabase.com/docs/guides/auth/redirect-urls)

## Enable Google Login

1. In Supabase, go to `Authentication` -> `Providers` -> `Google`.
2. In Google Cloud, create OAuth client credentials for a web app.
3. Copy the callback/redirect URI that Supabase shows and add it to Google Cloud as an authorized redirect URI.
4. Paste the Google client ID and client secret into the Supabase Google provider settings.
5. In Supabase `URL Configuration`, add your local and production site URLs.

Supabase docs:

- [Google login guide](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [OAuth JS reference](https://supabase.com/docs/reference/javascript/auth-signinwithoauth)

## Local Test

You can open the HTML files directly, but it is better to use a small static server so browser auth works consistently.

Simple option:

```bash
npx serve .
```

Then open:

- `http://localhost:3000/`
- `http://localhost:3000/admin/`

## Publish

Netlify:

1. Create a new site from this folder or from GitHub.
2. Publish directory: project root
3. No build command needed

Vercel:

1. Import the project
2. Framework preset: Other
3. No build command needed
4. Output directory: leave blank

## Important Notes

- The store is now designed as a simple guest checkout flow.
- Admin security depends on Supabase Auth and the `admin_profiles` table.
- Public order insert is open for checkout, so later you may want CAPTCHA or a serverless function to reduce spam.
- The old `src/` Node backend is still here, but it is no longer required for the Supabase version.
