# Digital Kaizen v1.5.0

## What changed

Escalation and test emails can now be sent through the Resend API. Messages enter the existing queue first. With a Resend key configured it takes precedence; otherwise the existing SMTP configuration remains in use. No database migration is required.

## Update safely

1. Stop the app and copy the complete `data/` folder and `.env` somewhere safe.
2. Follow UPDATING.md section 2 to install this version and run `node scripts/upgrade.js --check` on a copy before restarting.
3. Follow README Step 9 to verify a sending subdomain with Resend, create a sending-only key and add `RESEND_API_KEY`, `DK_MAIL_FROM` and `DK_MAIL_FROM_NAME` to `.env`.
4. Restart the Windows scheduled task or Linux service as described in README Step 8. Open Settings > Email and send a test to your own address.
5. Confirm the dashboard, machines and escalation ladder. If there is no admin account, create the first admin as in README Step 6.

Two-step sign-in uses an authenticator app (TOTP); it needs no email and no email keys. Never run reset or seed against factory data.
