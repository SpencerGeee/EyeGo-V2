# 🚀 EyeGo — Production Budget &amp; Setup Cost Sheet

> **Prepared for client presentation — June 2026**
> All prices in USD unless noted. Ghana-specific services noted in GHS.

---

## 1. 📱 Mobile App Infrastructure

### 1.1 App Store Accounts (One-Time & Annual)

| Item | Cost | Type | Notes |
|------|------|------|-------|
| **Apple Developer Program** | **$99/yr** | Annual | Required for iOS app store submission + push notifications |
| **Google Play Developer** | **$25** | One-time | Required for Android app store submission |
| **Expo EAS Build (Starter)** | **$0** | Free tier | 500 free build credits/mo — enough for early development |
| **Expo EAS Build (Pro)** | **$19.90/mo** | Monthly | Upgrade needed for 5,000 build credits/mo — continuous deployment |
| **Expo EAS Submit** | **$0** | Included | Free with EAS Build — submit to both app stores from cloud |
| **App Icons & Store Assets** | **$500–$2,000** | One-time | Designer to create app icons, screenshots, store listing |

**Subtotal (Year 1):**  
- Bare minimum: **$124** ($99 Apple + $25 Google)  
- Recommended: **$362.80** ($99 Apple + $25 Google + $19.90/mo EAS Pro × 12)

---

## 2. 🗄️ Backend Hosting

### 2.1 Option A: Managed Cloud (Simplest — Recommended for Launch)

**Railway.app** (usage-based, pay-for-what-you-use)

| Service | Spec | Cost | Notes |
|---------|------|------|-------|
| Node.js API container | 1 vCPU, 512MB RAM | **~$10–$20/mo** | Scales with traffic; ~$0.00072/sec |
| PostgreSQL database | 1GB RAM, 10GB storage | **$12/mo** | Managed, automated backups |
| Redis cache | 256MB | **$5/mo** | For dispatch + socket.io + rate limiting |
| Network egress | First 1TB free | **$0** | After 1TB: $0.05/GB |
| **Total Railway** | | **~$27–$37/mo** | |

**Render.com** (fixed plans — predictable)

| Service | Spec | Cost | Notes |
|---------|------|------|-------|
| Node.js Web Service | Starter — 512MB RAM | **$7/mo** | Fixed price, always on |
| PostgreSQL | Starter — 1GB RAM, 10GB | **$14/mo** | Automated daily backups |
| Redis | 256MB | **$9/mo** | Managed Redis instance |
| **Total Render** | | **$30/mo** | |

### 2.2 Option B: Self-Hosted VPS (Cheapest — Requires DevOps)

**Hetzner Cloud** (best price-performance in Europe — accessible from Ghana)

| Service | Spec | Cost | Notes |
|---------|------|------|-------|
| CX22 VPS (Node.js + Redis) | 2 vCPU, 4GB RAM | **€4.49/mo (~$4.80)** | Run API, Socket.io, and Redis on same box |
| CX22 VPS (PostgreSQL) | 2 vCPU, 4GB RAM, 80GB SSD | **€4.49/mo (~$4.80)** | Dedicated DB server |
| Floating IP + DNS | | **€0.50/mo (~$0.55)** | Static IP for DNS records |
| **Total Hetzner** | | **~$10/mo** | Requires Docker + sysadmin skills |

**DigitalOcean Droplet** (Ghana-familiar — simpler than Hetzner)

| Service | Spec | Cost | Notes |
|---------|------|------|-------|
| Basic Droplet (all-in-one) | 2 vCPU, 2GB RAM, 60GB SSD | **$12/mo** | Run API + DB + Redis on one box |
| Managed PostgreSQL | 1GB RAM, 10GB storage | **$15/mo** | Optional — skip if self-managing |
| Managed Redis | 250MB | **$12/mo** | Optional — skip if self-managing |
| **Total DigitalOcean (all managed)** | | **$39/mo** | |
| **Total DigitalOcean (DIY DB + Redis)** | | **$12/mo** | Needs sysadmin effort |

### 2.3 Recommendation

| Phase | Platform | Monthly Cost | Rationale |
|-------|----------|-------------|-----------|
| **MVP / Beta (0–500 users)** | Hetzner VPS | **~$10/mo** | Cheapest, use Docker Compose for API + DB + Redis |
| **Launch (500–5,000 users)** | Railway or Render | **~$30–$37/mo** | Zero DevOps, automated scaling, backups managed |
| **Growth (5,000+ users)** | Railway + Supabase | **~$50–$80/mo** | Upgrade containers + DB size as needed |

---

## 3. 💾 Database & Caching

### 3.1 PostgreSQL

| Option | Cost | Storage | Notes |
|--------|------|---------|-------|
| Railway managed PG | **$12/mo** | 10GB | Included in Railway above |
| Render managed PG | **$14/mo** | 10GB | Included in Render above |
| Supabase Pro | **$25/mo** | 8GB DB + 100GB bandwidth | Includes auth, realtime, storage — great value |
| Self-hosted (Hetzner) | **$0/mo** | 80GB SSD | Included in VPS cost above |

**Recommended:** Supabase Pro ($25/mo) for production — gives managed backups, point-in-time recovery, auth alternative, and a nice dashboard.

### 3.2 Redis

| Option | Cost | Storage | Notes |
|--------|------|---------|-------|
| Railway managed Redis | **$5/mo** | 256MB | Included in Railway option |
| Upstash (serverless Redis) | **$10/mo** | 250MB | Pay-as-you-go, no server management |
| Self-hosted on VPS | **$0/mo** | Shared RAM | Included in VPS cost |
| Redis Cloud Essentials | **$15/mo** | 1GB | Enterprise-grade, but overkill for now |

**Recommended:** Upstash ($10/mo) — serverless, no management, pays only for commands executed.

---

## 4. 🔧 Third-Party API Services

### 4.1 Payments — Paystack

| Fee Type | Rate | Notes |
|----------|------|-------|
| **Local cards (Ghana)** | **1.95% + GHS 0** | Standard rate for Visa, Mastercard |
| **Mobile Money (MoMo)** | **1.95%** | MTN, Vodafone, AirtelTigo |
| **Bank transfers** | **1.95%** | Paystack's flat rate for Ghana |
| **Settlement** | T+1 or T+2 | Funds settle next business day |
| **Monthly minimum** | **$0** | No monthly fee — pure transactional |

**Estimated monthly cost at 1,000 transactions of GHS 25 average:**  
1,000 × GHS 25 × 1.95% = **GHS 487.50/mo (~$37/mo)**

### 4.2 SMS — Africa's Talking

| Service | Rate | Notes |
|---------|------|-------|
| **SMS (Ghana local)** | **GHS 0.05–0.08 per SMS** | Per-segment pricing |
| **OTP SMS** | **GHS 0.05 per SMS** | Low volume transactional |
| **Bulk promotional SMS** | **GHS 0.03–0.05 per SMS** | For high-volume campaigns |
| **Voice API** | **GHS 0.25/min** | For masked calling (future feature) |
| **Monthly minimum** | **$0** | No monthly fee — pure consumption |

**Estimated monthly cost at 5,000 SMS/mo:**  
5,000 × GHS 0.06 = **GHS 300/mo (~$23/mo)**

### 4.3 Maps

**Option A: Mapbox** (already integrated)

| Plan | Included | Overage | Monthly Cost |
|------|----------|---------|-------------|
| **Free Tier** | 50,000 map loads, 25,000 directions | Pay-as-you-go | **$0** |
| **Pay-as-you-go** | $0.50/1,000 map loads, $0.50/1,000 directions | — | **~$25–$50/mo** at 100K map loads |
| **Starter Bundle** | 100K map loads, 50K directions | Included | **$50/mo** |

**Option B: Google Maps Platform** (alternative — already used for driver app)

| API | Free Tier | Beyond Free | Monthly Cost |
|-----|-----------|-------------|-------------|
| Maps SDK (Android) | $200/mo credit | $7/1,000 requests | **$0–$30/mo** |
| Directions API | $200/mo credit | $5/1,000 requests | **$0–$15/mo** |
| Places API | $200/mo credit | $17/1,000 requests | **$0–$10/mo** |
| **Total** | **$200/mo credit covers light usage** | | **$0–$55/mo** |

**Recommended:** Use Mapbox for rider app (already integrated, cheaper for high volume), Google Maps via free $200 credit for driver app (already integrated). Combined: **~$30–$55/mo**.

### 4.4 Push Notifications — Firebase Cloud Messaging

| Tier | Cost | Limits |
|------|------|--------|
| **Firebase Cloud Messaging** | **$0 (FREE)** | Unlimited — forever free |
| **Firebase Phone Auth** | **$0.01/verification** | Very cheap; ~$10/1,000 verifications |

**Estimated monthly cost at 500 new users/mo:**  
500 × $0.01 + 500 OTPs = **~$5/mo**

### 4.5 File Storage — Cloudinary

| Plan | Features | Cost | Notes |
|------|----------|------|-------|
| **Free** | 25GB storage, 25GB bandwidth | **$0** | Good for development |
| **Plus** | 50GB storage, 50GB bandwidth, 50K transformations | **$89/mo** (annual) | Required for production — driver documents + profile photos |
| **Advanced** | 100GB storage, 200GB bandwidth | **$249/mo** | For scaling beyond 10K users |

**Recommended:** Plus plan **$89/mo** (annual billing) — needed for driver license photos, vehicle photos, profile pictures.

### 4.6 Email — Mailgun (for receipts, support)

| Tier | Emails/mo | Cost | Notes |
|------|-----------|------|-------|
| **Flex / Pay-as-you-go** | First 5,000 free | **$0.80/1,000 after** | **~$4/mo** for 10K emails |
| **Basic Plan** | 10,000/mo included | **$15/mo** | Includes validation, analytics |
| **Scale Plan** | 100,000/mo included | **$35/mo** | For growth phase |

**Recommended:** Flex plan **~$4/mo** at launch (only transactional emails — receipts, password resets).

### 4.7 Error Monitoring — Sentry

| Tier | Events/mo | Cost | Notes |
|------|-----------|------|-------|
| **Free** | 5,000 errors/mo | **$0** | Good for development |
| **Team** | 50,000 errors/mo | **$29/mo** (annual) | Required for production — includes performance monitoring |
| **Business** | 100,000+ errors/mo | **$49/mo** | For growth phase with SLAs |

**Recommended:** Team plan **$29/mo** — essential for catching production bugs before users do.

### 4.8 CDN & Security — Cloudflare

| Plan | Features | Cost | Notes |
|------|----------|------|-------|
| **Free** | DDoS protection, CDN, SSL certificate, 3 page rules | **$0** | Sufficient for launch |
| **Pro** | + WAF, bot management, image optimization | **$25/mo** | Recommended for production |
| **Business** | + OWASP rules, advanced bot, PCI compliance | **$200/mo** | Only needed for enterprise compliance |

**Recommended:** **Free plan** at launch, upgrade to **Pro ($25/mo)** once traffic exceeds 10K daily requests.

---

## 5. 🌍 Domain & Infrastructure

| Item | Cost | Type | Notes |
|------|------|------|-------|
| **Domain (eyego.com.gh or similar)** | **GHS 150–600/yr (~$12–$48)** | Annual | Through Ghana domain registrar |
| **Domain (.com — alternative)** | **$10–$15/yr** | Annual | Through Namecheap, Cloudflare Registrar |
| **SSL Certificate** | **$0** | Included | Free via Cloudflare or Let's Encrypt |
| **SMTP for development** | **$0** | Free | Use Mailtrap for dev email testing |
| **GitHub Team (private repo)** | **$4/mo** (per user) | Monthly | For CI/CD via GitHub Actions |

---

## 6. 📊 Monthly Cost Summary

### Development / Staging Environment

| Service | Plan | Cost |
|---------|------|------|
| Railway (or Render) | Dev containers (always-off) | **$5–$10/mo** |
| Supabase (or local PG) | Free tier | **$0** |
| Mapbox | Free tier (50K loads) | **$0** |
| Cloudinary | Free tier (25GB) | **$0** |
| Mailgun | Flex (5K free) | **$0** |
| Sentry | Free (5K events) | **$0** |
| **Dev Total** | | **~$5–$10/mo** |

### Production Environment — Launch Phase (0–1,000 users)

| Category | Service | Monthly Cost |
|----------|---------|-------------|
| **Hosting** | Railway (API + PG + Redis) | **$30** |
| **Maps** | Mapbox + Google Maps combined | **$30** |
| **SMS** | Africa's Talking (~3,000 SMS/mo) | **$14** |
| **Payments** | Paystack (~500 txn × GHS 25) | **~$19** |
| **Storage** | Cloudinary Plus | **$89** |
| **Push Notifications** | Firebase FCM | **$0** |
| **Phone Auth** | Firebase Auth | **$5** |
| **Monitoring** | Sentry Team | **$29** |
| **Email** | Mailgun Flex | **$4** |
| **CDN/Security** | Cloudflare Free | **$0** |
| **EAS Build** | Free tier | **$0** |
| **Domain** | .com.gh (amortized) | **~$3** |
| **App Store Accounts** | $99 + $25 (amortized) | **~$10** |
| | | |
| **Launch Total** | | **~$233/mo** |
| **Annual Total** | | **~$2,800/yr** |

### Production — Growth Phase (1,000–10,000 users)

| Category | Service | Monthly Cost |
|----------|---------|-------------|
| **Hosting** | Railway upgraded (2 vCPU, 2GB) | **$50** |
| **Database** | Supabase Pro (8GB PG) | **$25** |
| **Redis** | Upstash (250MB) | **$10** |
| **Maps** | Mapbox + Google Maps | **$55** |
| **SMS** | Africa's Talking (~10,000 SMS/mo) | **$46** |
| **Payments** | Paystack (~3,000 txn × GHS 30 avg) | **~$68** |
| **Storage** | Cloudinary Plus | **$89** |
| **Monitoring** | Sentry Team | **$29** |
| **Email** | Mailgun Basic (10K emails) | **$15** |
| **CDN/Security** | Cloudflare Pro | **$25** |
| **EAS Build** | EAS Pro | **$19.90** |
| **Domain + Stores** | Amortized | **~$13** |
| | | |
| **Growth Total** | | **~$445/mo** |
| **Annual Total** | | **~$5,340/yr** |

---

## 7. 💰 One-Time Setup Costs

| Item | Cost | Notes |
|------|------|-------|
| **Apple Developer Account** | $99/yr | Already included above |
| **Google Play Developer** | $25 | One-time fee |
| **Logo + Branding** | $500–$2,000 | Store icons, splash screen, marketing materials |
| **App screenshots (localized)** | $300–$800 | Required for app store listing |
| **Privacy Policy + Terms of Service** | $500–$1,500 | Legal fees for Ghana-specific T&C |
| **Accounting/registration** | $200–$500 | Business registration in Ghana |
| **Paystack onboarding** | $0 | Free to set up; takes 1–2 weeks approval |
| **Africa's Talking onboarding** | $0 | Free to set up |
| **Mapbox account setup** | $0 | Free |
| **Cloudinary account setup** | $0 | Free |
| **Domain registration** | $12–$48 | First year |
| ****Total One-Time** | **$1,636–$4,972** | |

---

## 8. 🚀 Full First-Year Budget

### Aggressive (Hetzner self-hosted, free tiers maxed)

| Category | Monthly | Annual |
|----------|---------|--------|
| Hosting (Hetzner VPS × 2) | $10 | $120 |
| Paystack fees (~500 txn/mo) | $19 | $228 |
| Africa's Talking SMS (~3K/mo) | $14 | $168 |
| Firebase Auth | $5 | $60 |
| Cloudinary Plus | $89 | $1,068 |
| Sentry (free tier) | $0 | $0 |
| Cloudflare (free tier) | $0 | $0 |
| Mailgun | $4 | $48 |
| Domain + Stores (amortized) | $13 | $156 |
| Developer tools misc | $5 | $60 |
| **Total** | **$159/mo** | **$1,908/yr** |

> ✔ **Recommended for client pitch: "Just $159/month to keep the app running."**

### Balanced (Railway hosted, managed everything)

| Category | Monthly | Annual |
|----------|---------|--------|
| Hosting (Railway: API + PG + Redis) | $30 | $360 |
| Supabase Pro (DB) | $25 | $300 |
| Upstash (Redis) | $10 | $120 |
| Mapbox + Google Maps | $30 | $360 |
| Paystack fees (~500 txn/mo) | $19 | $228 |
| Africa's Talking SMS (~3K/mo) | $14 | $168 |
| Firebase Auth | $5 | $60 |
| Cloudinary Plus | $89 | $1,068 |
| Sentry Team | $29 | $348 |
| Cloudflare Pro | $25 | $300 |
| EAS Build Pro | $19.90 | $238.80 |
| Mailgun | $4 | $48 |
| Domain + Stores (amortized) | $13 | $156 |
| **Total** | **~$313/mo** | **~$3,755/yr** |

> ✔ **Recommended for client pitch: "~$313/month fully managed with monitoring and enterprise support."**

---

## 9. 📋 Full Service Inventory (for client reference)

| # | Service | Purpose | Cost | Criticality |
|---|---------|---------|------|-------------|
| 1 | **Railway.app / Hetzner** | Node.js API + Socket.io hosting | $10–$30/mo | 🔴 Critical |
| 2 | **PostgreSQL (Supabase / self)** | All app data: users, trips, bookings | $0–$25/mo | 🔴 Critical |
| 3 | **Redis (Upstash / self)** | Dispatch matching, socket.io, rate limits | $0–$10/mo | 🔴 Critical |
| 4 | **Paystack** | Payment processing (MoMo + Card) | 1.95%/txn | 🔴 Critical |
| 5 | **Africa's Talking** | SMS (OTP, notifications, SOS) | GHS 0.05–0.08/SMS | 🔴 Critical |
| 6 | **Mapbox** | Rider app maps, trip tracking | $0–$50/mo | 🟡 High |
| 7 | **Google Maps** | Driver app maps, navigation | $0–$30/mo | 🟡 High |
| 8 | **Firebase Cloud Messaging** | Push notifications (free) | $0 | 🟡 High |
| 9 | **Firebase Phone Auth** | OTP verification | ~$5/mo | 🟡 High |
| 10 | **Cloudinary** | Driver document & photo storage | $0–$89/mo | 🟡 High |
| 11 | **Sentry** | Error monitoring & crash reporting | $0–$29/mo | 🟡 High |
| 12 | **Cloudflare** | CDN, DDoS, SSL, DNS | $0–$25/mo | 🟢 Medium |
| 13 | **Mailgun** | Transactional emails (receipts) | $0–$15/mo | 🟢 Medium |
| 14 | **Expo EAS** | Cloud builds for iOS + Android | $0–$19.90/mo | 🟢 Medium |
| 15 | **GitHub** | Source code, CI/CD, project management | $0–$4/mo | 🟢 Medium |
| 16 | **Sentry Performance** | APM traces | Included in Sentry | 🟢 Medium |
| 17 | **Paystack Transfers** | Driver payout disbursements | 1.95%/txn | 🟢 Medium (future) |
| 18 | **Twilio / AT Voice** | Masked calling (future feature) | $0.05–$0.25/min | ⚪ Future |

---

## 10. 💡 Cost Optimization Tips

1. **Cloudinary on Free = saves $89/mo.** Use the free tier until you exceed 25GB storage or bandwidth.
2. **Sentry Free = saves $29/mo.** 5,000 events/mo is enough for a Beta.
3. **Cloudflare Free = saves $25/mo.** Upgrade to Pro only when you need the WAF.
4. **EAS Build Free = saves $19.90/mo.** Build locally or use free credits during development.
5. **At 1,000 SMS/mo, Africa's Talking costs only $5/mo.** Keep SMS usage low by using in-app notifications (free) wherever possible.
6. **Self-host on Hetzner = saves $20–$30/mo** vs Railway/Render. Cost is your DevOps time.
7. **Supabase Free tier** (500MB DB, 2GB storage) is actually enough for the first 200–500 active users.
8. **Total minimum viable production cost: ~$100/mo** using Hetzner + Supabase Free + Mapbox free tier + Cloudinary free + free tiers of everything else.

---

## 11. ✅ Recommended Budget for Client Presentation

### "Launch-Ready" Package — **$233/month**

```
┌──────────────────────────────────────────────────────┐
│  EyeGo Monthly Production Costs                      │
├──────────────────────────────────────────────────────┤
│  Railway (API + DB + Redis)   $30                    │
│  Mapbox + Google Maps         $30                    │
│  Africa's Talking (SMS)       $14                    │
│  Paystack fees (est.)         $19                    │
│  Cloudinary Plus              $89  ← largest single  │
│  Firebase (FCM + Auth)        $5                     │
│  Sentry Team                  $29                    │
│  Mailgun                      $4                     │
│  Cloudflare Free              $0                     │
│  EAS Build Free               $0                     │
│  Domain (amortized)           $3                     │
│  App Stores (amortized)       $10                    │
├──────────────────────────────────────────────────────┤
│  TOTAL                        $233/month             │
│  YEAR 1                       ~$2,800                │
└──────────────────────────────────────────────────────┘

Plus one-time: ~$1,650 (branding, legal, domain, store reg)
Grand total Year 1: ~$4,450
```

---

## 12. ❗ Additional Costs a Client Should Know About

These aren't third-party API costs but are real expenses the client needs to budget for:

| Item | Est. Cost | Notes |
|------|-----------|-------|
| **Customer support tool** (Intercom, Crisp, Zendesk) | **$15–$79/mo** | Riders and drivers WILL contact support — you need a ticketing system |
| **Product analytics** (PostHog, Mixpanel, Amplitude) | **$0–$35/mo** | Understanding where users drop off in the booking flow is critical |
| **Promo/referral budget** (actual credit given to users) | **$0.50–$5 per user** | Not a vendor cost — real money spent on discounts and referral bonuses |
| **Driver payout cash float** (Paystack settlement gap) | **GHS 2,000–10,000 upfront** | Paystack settles T+1 or T+2. If you offer instant driver payouts, YOU need cash on hand to front the payment |
| **Ghana Data Protection registration** (legal) | **GHS 1,000–5,000/yr** | Mandatory for any app collecting user data in Ghana |
| **Bank account setup (business)** | **GHS 500–1,500** | Required for Paystack settlement — typically needs a Ghanaian business bank account |
| **Marketing budget (social, offline)** | **$500–$2,000/mo** | Ride-sharing is a two-sided marketplace — you need to acquire both riders AND drivers |
| **Developer salaries** (if hiring) | **$2,000–$5,000/mo per dev** | The single biggest line item in any real budget; not included in this infrastructure-only sheet |

> ⚠️ **Disclaimer to client:** This sheet covers only **third-party services and infrastructure costs**. It does NOT include salaries, marketing, office space, legal fees, or user acquisition costs which will be significantly higher than the infrastructure in any real-world budget.

## 13. 📦 Recommended Production Hosting Specs (Minimum Viable)

| Component | Spec | Purpose |
|-----------|------|---------|
| **Node.js API** | 1 vCPU, 512MB–1GB RAM | Express + Socket.io server |
| **PostgreSQL** | 1GB RAM, 10GB SSD | Prisma ORM — stores all app data |
| **Redis** | 256MB RAM | Socket.io adapter + dispatch queue + rate limiter |
| **CDN** | Cloudflare Free | Static assets, API caching, SSL termination |
| **File storage** | Cloudinary | Driver documents (license, photos, vehicle) |
| **Background worker** | Same as API (in-process) | Push notifications, SMS sending, receipt generation |
| **Monitoring** | Sentry + Winston | Error tracking + structured logging |
