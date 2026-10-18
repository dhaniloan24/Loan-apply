# Dhani Finance — Blue Loan Enquiry Website

Includes:
- Usmani/royal-blue responsive public website
- Loan enquiry form with generated reference number
- EMI calculator (estimate only)
- Customer reference-number status lookup
- Admin dashboard at `/admin.html`
- Admin can update application status and a customer-visible note
- Admin can set the contact mobile number shown on the public website
- Email notifications to `dhanifinancelimitedloans24@gmail.com` and optional customer confirmation
- PostgreSQL persistence when `DATABASE_URL` is configured; local JSON fallback for development

## Deploy to Render

1. Upload the files/folders to your GitHub repository, preserving `public/index.html` and `public/admin.html`.
2. On Render, create a **Web Service** from that repository. Build command: `npm install`; Start command: `npm start`.
3. Recommended: create a Render PostgreSQL database and add its internal connection string as `DATABASE_URL` in the web service's Environment settings. Without a database, JSON storage is for testing only and may be lost on redeploy/restart.
4. Add these environment variables in Render (never put secrets in GitHub):
   - `RECEIVER_EMAIL` = `dhanifinancelimitedloans24@gmail.com`
   - `SMTP_HOST` = `smtp.gmail.com`
   - `SMTP_PORT` = `587`
   - `SMTP_SECURE` = `false`
   - `SMTP_USER` = `dhanifinancelimitedloans24@gmail.com`
   - `SMTP_PASS` = a Gmail App Password for that mailbox (not the normal Gmail password)
   - `ADMIN_PASSWORD` = a strong unique password of your choice
5. Deploy and open the public service URL. The enquiry page is `/`; admin page is `/admin.html`.
6. Test submission, email delivery, status lookup, admin status updates, and the contact number setting.

## Important
- The previous Gmail address is configured as the receiver, but email will not send until a valid SMTP App Password is entered in Render.
- Do not upload `.env`, SMTP credentials, or admin passwords to GitHub.
- For a production service, use PostgreSQL; the local JSON fallback is not durable on many hosting platforms.
- This is an enquiry tool, not a lender decision engine. Do not represent an enquiry as approved or guaranteed. Display only statuses supported by the actual review.
- Do not collect Aadhaar/PAN, OTPs, or bank passwords in this basic enquiry form.
