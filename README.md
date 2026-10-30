# Agentic AI Academy

> **Practical AI Training for Teams, Colleges, and Future Professionals.**  
> *Learn AI. Build Skills. Create Impact.*

Production Origin: [https://mindwash.ai](https://mindwash.ai)  
Parent Company: [Agentic AI](https://agenticai.com)  
Founder: **Abhishek Sharma** (MSc in Artificial Intelligence & Machine Learning) — AI Engineer, Educator & Consultant

---

## 1. Overview & Architecture

Agentic AI Academy is the training and education division of Agentic AI. The application is built as a production-grade, full-stack TypeScript platform designed for deployment to any Node.js-compatible environment (including Replit, Cloud Run, VPS, or Railway).

### Technical Stack
- **Frontend**: React 19 SPA with Tailwind CSS v4 and Plus Jakarta Sans / DM Sans typography.
- **Backend**: Node.js & Express server (`server.ts`) hosting REST APIs, CSRF validation, rate limiting, and honeypot spam protection.
- **Vite Integration**: In development, `vite.middlewares` runs directly inside Express on port 3000. In production, Vite compiles client assets to `dist/`, which Express serves alongside static routes.
- **Persistence**: Atomic file-backed repository (`./data/academy-store.json`) with transactional temporary writes and crash-resilient schema initialization.
- **Authentication**: Bcrypt-hashed credentials with secure HTTP-only session cookies and login brute-force throttling.
- **SEO & Compliance**: Dynamic canonical tags, OpenGraph metadata, JSON-LD structured schemas (`EducationalOrganization`, `Course`, `Article`), dynamic XML sitemap (`/sitemap.xml`), and robots exclusion (`/robots.txt`).
- **Data Protection**: Spreadsheet formula injection mitigation in CSV export (sanitizing `=`, `+`, `-`, `@`, `\t`, `\r`).

---

## 2. Quickstart & Commands

```bash
# 1. Install dependencies
npm install

# 2. Run full-stack development server (Express + Vite on port 3000)
npm run dev

# 3. Type-check application
npm run lint

# 4. Compile production frontend bundle
npm run build

# 5. Start production Node server
npm run start
```

---

## 3. Initial Admin Provisioning

The Academy includes a protected administration area located at `/admin` (and login at `/admin/login`).

### Default Bootstrap Credentials
- **Username**: `admin@mindwash.ai`
- **Initial Password**: Configured via the `ADMIN_INITIAL_PASSWORD` environment variable (defaults to `MindWash2026!Academy` on initial database seed).

### Changing Admin Password in Production
1. In your deployment environment variables, define:
   ```env
   ADMIN_INITIAL_PASSWORD="YourStrongCustomPasswordHere!"
   ```
2. Or update the hashed credential in `./data/academy-store.json`.

---

## 4. Enquiry Management & Form Workflow

The platform handles five distinct enquiry channels:
1. **Corporate Training Proposals** (`/corporate-training`)
2. **College Workshop Enquiries** (`/college-training`)
3. **Specific Course Enquiries** (`/programmes/[slug]`)
4. **Workshop Interest Registrations** (`/workshops/[slug]`)
5. **General Admissions Inquiries** (`/contact`)

### Email Notifications & Missing Config Transparency
- When `SMTP_HOST`, `SMTP_USER`, and `SMTP_PASS` are configured in `.env`, notifications are dispatched to admissions.
- If SMTP credentials are not yet configured:
  - Enquiries are **always persisted securely** in the registry before reporting success.
  - Submissions receive a real reference code (e.g., `ENQ-2026-X839` or `WS-REG-2026-A1B2`).
  - The record is transparently marked with `notificationStatus: "stored_pending_smtp_config"`.
  - The website never falsely claims an email was dispatched when credentials are not configured.

---

## 5. Backup & Database Restoration

All curriculum data, workshop configurations, articles, site settings, and enquiry records reside in:
```
data/academy-store.json
```

### Creating a Backup
```bash
cp data/academy-store.json data/backup-$(date +%F).json
```

### Restoring from Backup
```bash
cp data/backup-YYYY-MM-DD.json data/academy-store.json
```

---

## 6. Custom Domain & DNS Setup (`mindwash.ai`)

When deploying to Replit or a Node host:

1. **Custom Domain**: Bind `mindwash.ai` and `www.mindwash.ai` in your hosting dashboard.
2. **DNS Records**:
   - **Apex domain (`@`)**: Add an `A` record pointing to your platform's load balancer IP.
   - **Subdomain (`www`)**: Add a `CNAME` record pointing to the target hostname provided by your host.
3. **Primary Domain & Redirects**: Configure the hosting platform to redirect `http://` to `https://`, and redirect `www.mindwash.ai` to the canonical origin `https://mindwash.ai`.
4. **Sitemap Submission**: Submit `https://mindwash.ai/sitemap.xml` directly to Google Search Console.

---

## 7. Replacing Visual Assets

All visual assets and photos are indexed in `/src/assets/images.ts`:
- **Hero Image**: `/src/assets/images/hero_academic_learning_*.jpg`
- **Corporate Workshop**: `/src/assets/images/corporate_workshop_session_*.jpg`
- **College Lab**: `/src/assets/images/college_technical_lab_*.jpg`
- **System Architecture**: `/src/assets/images/sample_project_architecture_*.jpg`

To replace with real photography:
1. Drop your verified photography into `/src/assets/images/`.
2. Update the import paths in `/src/assets/images.ts`.

---

## 8. Launch Pre-Flight Checklist

- [x] Run production build (`npm run build`) and verify 0 compiler errors.
- [x] Type check codebase (`npm run lint`).
- [x] Verify responsive layout at 360px, 768px, and 1440px desktop baselines.
- [x] Test end-to-end form submission across corporate, college, programme, and workshop registration.
- [x] Verify saved submissions appear in `/admin` with unique reference codes.
- [x] Test CSV export and confirm formula injection escaping (`'` prefix on `=,+,-,@`).
- [x] Verify unauthenticated requests to `/api/admin/*` are blocked with 401 Unauthorized.
- [x] Confirm sitemap (`/sitemap.xml`) lists all 12 programmes, 6 workshops, and 4 articles.
- [x] Confirm `/robots.txt` disallows `/admin` and `/api/`.
