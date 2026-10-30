import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import crypto from 'crypto';
import { storage } from './server/storage.ts';
import { EnquiryType, EnquiryStatus } from './src/types/index.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Trust proxy for IP rate-limiting in hosted environments
app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser(process.env.SESSION_SECRET || 'agentic-ai-academy-secret-2026'));

// --- In-memory Session & Rate Limiting Storage ---

interface AdminSession {
  username: string;
  expiresAt: number;
}
const activeSessions = new Map<string, AdminSession>();

// Rate limiter helper
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const rateLimits = new Map<string, RateLimitBucket>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateLimits.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= maxRequests) {
    return false;
  }
  bucket.count++;
  return true;
}

// Clean up stale rate limits and sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimits.entries()) {
    if (bucket.resetAt < now) rateLimits.delete(key);
  }
  for (const [token, sess] of activeSessions.entries()) {
    if (sess.expiresAt < now) activeSessions.delete(token);
  }
}, 60000);

// --- Admin Authentication Middleware ---

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.admin_session;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Admin authentication required' });
    return;
  }
  const session = activeSessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) activeSessions.delete(token);
    res.clearCookie('admin_session');
    res.status(401).json({ error: 'Session expired. Please log in again.' });
    return;
  }
  // Slide session window (extend by 4 hours on active usage)
  session.expiresAt = Date.now() + 4 * 60 * 60 * 1000;
  (req as any).adminUser = session.username;
  next();
}

// --- CSV Formula Sanitizer ---
function sanitizeCsvCell(value: any): string {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  // Prevent formula injection in Excel/Sheets if begins with =, +, -, @, tab, or carriage return
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  str = str.replace(/"/g, '""');
  return `"${str}"`;
}

// --- Public Content APIs ---

app.get('/api/public/data', (_req: Request, res: Response) => {
  res.json({
    settings: storage.getSettings(),
    programmes: storage.getPublishedProgrammes(),
    workshops: storage.getPublishedWorkshops(),
    learningPaths: storage.getLearningPaths(),
    learningProjects: storage.getLearningProjects(),
    articles: storage.getPublishedArticles()
  });
});

app.get('/api/public/programmes', (_req: Request, res: Response) => {
  res.json(storage.getPublishedProgrammes());
});

app.get('/api/public/programmes/:slug', (req: Request, res: Response) => {
  const programme = storage.getProgrammeBySlug(req.params.slug);
  if (!programme || !programme.published) {
    res.status(404).json({ error: 'Programme not found' });
    return;
  }
  res.json(programme);
});

app.get('/api/public/workshops', (_req: Request, res: Response) => {
  res.json(storage.getPublishedWorkshops());
});

app.get('/api/public/workshops/:slug', (req: Request, res: Response) => {
  const workshop = storage.getWorkshopBySlug(req.params.slug);
  if (!workshop || !workshop.published) {
    res.status(404).json({ error: 'Workshop format not found' });
    return;
  }
  res.json(workshop);
});

app.get('/api/public/resources', (_req: Request, res: Response) => {
  res.json(storage.getPublishedArticles());
});

app.get('/api/public/resources/:slug', (req: Request, res: Response) => {
  const article = storage.getArticleBySlug(req.params.slug);
  if (!article || !article.published) {
    res.status(404).json({ error: 'Resource article not found' });
    return;
  }
  res.json(article);
});

// --- Enquiry Submissions ---

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/enquiries', async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  
  // Rate limiting: max 10 enquiries per 15 minutes per IP
  if (!checkRateLimit(`enq_${ip}`, 10, 15 * 60 * 1000)) {
    res.status(429).json({ 
      error: 'Too many submissions. Please wait a few minutes before submitting another enquiry.' 
    });
    return;
  }

  const {
    type,
    fullName,
    email,
    phone,
    organisation,
    role,
    teamSize,
    institutionName,
    department,
    programmeSlug,
    programmeTitle,
    workshopSlug,
    workshopTitle,
    currentSkillLevel,
    preferredDeliveryMode,
    preferredTimeframe,
    location,
    goalsAndRequirements,
    budgetRange,
    marketingConsent,
    website_url_check // Honeypot field: must be empty
  } = req.body;

  // Honeypot check
  if (website_url_check && String(website_url_check).trim() !== '') {
    // Silently drop bot submissions while returning fake success to fool scrapers
    res.status(200).json({ 
      success: true, 
      referenceNumber: 'ENQ-' + new Date().getFullYear() + '-BOT',
      message: 'Enquiry received.' 
    });
    return;
  }

  // Server-side validations
  if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 120) {
    res.status(400).json({ error: 'A valid full name (2–120 characters) is required.' });
    return;
  }

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim()) || email.length > 150) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }

  if (goalsAndRequirements && typeof goalsAndRequirements === 'string' && goalsAndRequirements.length > 3000) {
    res.status(400).json({ error: 'Requirements description exceeds 3000 characters limit.' });
    return;
  }

  const validTypes: EnquiryType[] = ['general', 'corporate', 'college', 'programme', 'workshop_registration'];
  const resolvedType: EnquiryType = validTypes.includes(type) ? type : 'general';

  try {
    const savedRecord = await storage.saveEnquiry({
      type: resolvedType,
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? String(phone).trim().slice(0, 40) : undefined,
      organisation: organisation ? String(organisation).trim().slice(0, 150) : undefined,
      role: role ? String(role).trim().slice(0, 100) : undefined,
      teamSize: teamSize ? String(teamSize).trim().slice(0, 50) : undefined,
      institutionName: institutionName ? String(institutionName).trim().slice(0, 150) : undefined,
      department: department ? String(department).trim().slice(0, 100) : undefined,
      programmeSlug: programmeSlug ? String(programmeSlug).trim() : undefined,
      programmeTitle: programmeTitle ? String(programmeTitle).trim() : undefined,
      workshopSlug: workshopSlug ? String(workshopSlug).trim() : undefined,
      workshopTitle: workshopTitle ? String(workshopTitle).trim() : undefined,
      currentSkillLevel: currentSkillLevel ? String(currentSkillLevel).trim() : undefined,
      preferredDeliveryMode: preferredDeliveryMode,
      preferredTimeframe: preferredTimeframe ? String(preferredTimeframe).trim().slice(0, 100) : undefined,
      location: location ? String(location).trim().slice(0, 150) : undefined,
      goalsAndRequirements: goalsAndRequirements ? String(goalsAndRequirements).trim() : 'General enquiry submitted via website.',
      budgetRange: budgetRange ? String(budgetRange).trim().slice(0, 50) : undefined,
      consentTimestamp: new Date().toISOString(),
      marketingConsent: Boolean(marketingConsent)
    });

    res.status(201).json({
      success: true,
      referenceNumber: savedRecord.referenceNumber,
      notificationStatus: savedRecord.notificationStatus,
      message: 'Your enquiry has been received and logged securely with reference ' + savedRecord.referenceNumber + '.'
    });
  } catch (err: any) {
    console.error('Error saving enquiry to store:', err);
    res.status(500).json({ error: 'Failed to process enquiry. Please try again later.' });
  }
});

// --- Admin Authentication Endpoints ---

app.post('/api/admin/login', (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  // Rate limiting on login: max 5 attempts per 10 minutes per IP
  if (!checkRateLimit(`login_${ip}`, 5, 10 * 60 * 1000)) {
    res.status(429).json({ 
      error: 'Too many login attempts. Please wait 10 minutes before retrying.' 
    });
    return;
  }

  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const verified = storage.verifyAdminCredentials(username, password);
  if (!verified) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  // Create cryptographic session token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
  activeSessions.set(token, { username: verified.username, expiresAt });

  res.cookie('admin_session', token, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  });

  res.json({
    success: true,
    user: {
      id: verified.id,
      username: verified.username
    }
  });
});

app.post('/api/admin/logout', (req: Request, res: Response) => {
  const token = req.cookies?.admin_session;
  if (token) {
    activeSessions.delete(token);
  }
  res.clearCookie('admin_session');
  res.json({ success: true, message: 'Logged out successfully' });
});

app.get('/api/admin/me', requireAdmin, (req: Request, res: Response) => {
  res.json({
    authenticated: true,
    user: {
      username: (req as any).adminUser
    }
  });
});

// --- Admin Enquiry Management ---

app.get('/api/admin/enquiries', requireAdmin, (req: Request, res: Response) => {
  const { type, status, search } = req.query;
  const list = storage.getEnquiries({
    type: type ? String(type) : undefined,
    status: status ? String(status) : undefined,
    search: search ? String(search) : undefined
  });
  res.json(list);
});

app.patch('/api/admin/enquiries/:id/status', requireAdmin, async (req: Request, res: Response) => {
  const { status, note } = req.body;
  const validStatuses: EnquiryStatus[] = ['New', 'Contacted', 'Proposal Sent', 'Closed'];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid enquiry status' });
    return;
  }

  const author = (req as any).adminUser || 'Admin';
  const updated = await storage.updateEnquiryStatus(req.params.id, status, note, author);
  if (!updated) {
    res.status(404).json({ error: 'Enquiry not found' });
    return;
  }
  res.json(updated);
});

app.post('/api/admin/enquiries/:id/notes', requireAdmin, async (req: Request, res: Response) => {
  const { note } = req.body;
  if (!note || typeof note !== 'string' || !note.trim()) {
    res.status(400).json({ error: 'Note text is required' });
    return;
  }

  const author = (req as any).adminUser || 'Admin';
  const updated = await storage.addEnquiryNote(req.params.id, note, author);
  if (!updated) {
    res.status(404).json({ error: 'Enquiry not found' });
    return;
  }
  res.json(updated);
});

// --- Admin CSV Export with Formula Escaping ---

app.get('/api/admin/export-csv', requireAdmin, (req: Request, res: Response) => {
  const { type, status } = req.query;
  const list = storage.getEnquiries({
    type: type ? String(type) : undefined,
    status: status ? String(status) : undefined
  });

  const headers = [
    'Reference ID',
    'Type',
    'Full Name',
    'Email',
    'Phone',
    'Organisation / College',
    'Role / Department',
    'Team Size',
    'Programme / Workshop',
    'Preferred Mode',
    'Preferred Timeframe',
    'Status',
    'Submitted At',
    'Requirements / Goals',
    'Notes Count'
  ];

  const rows = list.map(e => [
    sanitizeCsvCell(e.referenceNumber),
    sanitizeCsvCell(e.type),
    sanitizeCsvCell(e.fullName),
    sanitizeCsvCell(e.email),
    sanitizeCsvCell(e.phone || ''),
    sanitizeCsvCell(e.organisation || e.institutionName || ''),
    sanitizeCsvCell(e.role || e.department || ''),
    sanitizeCsvCell(e.teamSize || ''),
    sanitizeCsvCell(e.programmeTitle || e.workshopTitle || ''),
    sanitizeCsvCell(e.preferredDeliveryMode || ''),
    sanitizeCsvCell(e.preferredTimeframe || ''),
    sanitizeCsvCell(e.status),
    sanitizeCsvCell(e.createdAt),
    sanitizeCsvCell(e.goalsAndRequirements),
    sanitizeCsvCell(e.notes.length)
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const filename = `mindwash-academy-enquiries-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(200).send(csvContent);
});

// --- Admin Content Updates ---

app.get('/api/admin/programmes', requireAdmin, (_req: Request, res: Response) => {
  res.json(storage.getAllProgrammes());
});

app.put('/api/admin/programmes/:id', requireAdmin, async (req: Request, res: Response) => {
  const updated = await storage.updateProgramme(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: 'Programme not found' });
    return;
  }
  res.json(updated);
});

app.get('/api/admin/workshops', requireAdmin, (_req: Request, res: Response) => {
  res.json(storage.getAllWorkshops());
});

app.put('/api/admin/workshops/:id', requireAdmin, async (req: Request, res: Response) => {
  const updated = await storage.updateWorkshop(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: 'Workshop not found' });
    return;
  }
  res.json(updated);
});

app.get('/api/admin/resources', requireAdmin, (_req: Request, res: Response) => {
  res.json(storage.getAllArticles());
});

app.put('/api/admin/resources/:id', requireAdmin, async (req: Request, res: Response) => {
  const updated = await storage.updateArticle(req.params.id, req.body);
  if (!updated) {
    res.status(404).json({ error: 'Article not found' });
    return;
  }
  res.json(updated);
});

app.get('/api/admin/settings', requireAdmin, (_req: Request, res: Response) => {
  res.json(storage.getSettings());
});

app.put('/api/admin/settings', requireAdmin, async (req: Request, res: Response) => {
  const updated = await storage.updateSettings(req.body);
  res.json(updated);
});

// --- SEO: Sitemap.xml & Robots.txt ---

app.get('/sitemap.xml', (_req: Request, res: Response) => {
  const origin = 'https://mindwash.ai';
  const programmes = storage.getPublishedProgrammes();
  const workshops = storage.getPublishedWorkshops();
  const articles = storage.getPublishedArticles();

  const staticRoutes = [
    { loc: '', changefreq: 'weekly', priority: '1.0' },
    { loc: '/about', changefreq: 'monthly', priority: '0.8' },
    { loc: '/programmes', changefreq: 'daily', priority: '0.9' },
    { loc: '/corporate-training', changefreq: 'weekly', priority: '0.9' },
    { loc: '/college-training', changefreq: 'weekly', priority: '0.9' },
    { loc: '/workshops', changefreq: 'daily', priority: '0.9' },
    { loc: '/learning-paths', changefreq: 'monthly', priority: '0.8' },
    { loc: '/projects', changefreq: 'monthly', priority: '0.8' },
    { loc: '/resources', changefreq: 'weekly', priority: '0.8' },
    { loc: '/contact', changefreq: 'monthly', priority: '0.7' },
    { loc: '/privacy', changefreq: 'yearly', priority: '0.3' },
    { loc: '/terms', changefreq: 'yearly', priority: '0.3' }
  ];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  for (const route of staticRoutes) {
    xml += `  <url>\n    <loc>${origin}${route.loc}</loc>\n    <changefreq>${route.changefreq}</changefreq>\n    <priority>${route.priority}</priority>\n  </url>\n`;
  }

  for (const prog of programmes) {
    xml += `  <url>\n    <loc>${origin}/programmes/${prog.slug}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  }

  for (const ws of workshops) {
    xml += `  <url>\n    <loc>${origin}/workshops/${ws.slug}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  }

  for (const art of articles) {
    xml += `  <url>\n    <loc>${origin}/resources/${art.slug}</loc>\n    <lastmod>${art.publishedDate}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
  }

  xml += `</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.status(200).send(xml);
});

app.get('/robots.txt', (_req: Request, res: Response) => {
  const robots = `# https://mindwash.ai robots.txt
User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/
Disallow: /api/

Sitemap: https://mindwash.ai/sitemap.xml
`;
  res.setHeader('Content-Type', 'text/plain');
  res.status(200).send(robots);
});

// --- Server Lifecycle & Vite Middleware Mounting ---

async function startServer() {
  if (!IS_PROD) {
    // Dynamic import of Vite createServer in development
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Production static serving
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Agentic AI Academy Server] Running at http://0.0.0.0:${PORT} (Mode: ${IS_PROD ? 'production' : 'development'})`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
