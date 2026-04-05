-- ═══════════════════════════════════════════════════════════════════════════
-- SEED DATA: The Social Seen
-- Run after all 13 migrations have been applied.
-- Creates demo data: 7 members, 11 events, bookings, reviews, photos.
--
-- Demo login credentials (all accounts): Password123!
--   Admin:   mitesh50@hotmail.com
--   Members: charlotte.davis@gmail.com, james.hartley@outlook.com,
--            priya.sharma@gmail.com, oliver.bennett@me.com,
--            sophie.williams@gmail.com, marcus.chen@gmail.com
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Step 1: Auth Users ───────────────────────────────────────────────────────
-- The handle_new_user trigger fires on each INSERT and creates a matching
-- public.profiles row. We UPDATE profiles in Step 2 to add the full detail.

INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  is_sso_user,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change,
  email_change_token_new
) VALUES
  -- 01 Admin: Mitesh Bhimjiyani
  (
    'a0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'mitesh50@hotmail.com',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Mitesh Bhimjiyani"}',
    false, false,
    now() - interval '6 months', now() - interval '6 months',
    '', '', '', ''
  ),
  -- 02 Charlotte Davis
  (
    'a0000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'charlotte.davis@gmail.com',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Charlotte Davis"}',
    false, false,
    now() - interval '4 months', now() - interval '4 months',
    '', '', '', ''
  ),
  -- 03 James Hartley
  (
    'a0000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'james.hartley@outlook.com',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"James Hartley"}',
    false, false,
    now() - interval '3 months', now() - interval '3 months',
    '', '', '', ''
  ),
  -- 04 Priya Sharma
  (
    'a0000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'priya.sharma@gmail.com',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Priya Sharma"}',
    false, false,
    now() - interval '3 months', now() - interval '3 months',
    '', '', '', ''
  ),
  -- 05 Oliver Bennett
  (
    'a0000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'oliver.bennett@me.com',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Oliver Bennett"}',
    false, false,
    now() - interval '2 months', now() - interval '2 months',
    '', '', '', ''
  ),
  -- 06 Sophie Williams
  (
    'a0000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'sophie.williams@gmail.com',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Sophie Williams"}',
    false, false,
    now() - interval '2 months', now() - interval '2 months',
    '', '', '', ''
  ),
  -- 07 Marcus Chen
  (
    'a0000000-0000-0000-0000-000000000007',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'marcus.chen@gmail.com',
    crypt('Password123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Marcus Chen"}',
    false, false,
    now() - interval '5 weeks', now() - interval '5 weeks',
    '', '', '', ''
  );

-- ── Step 2: Enrich profiles ──────────────────────────────────────────────────
-- The trigger created bare profiles; fill in the rest.

-- Admin: Mitesh Bhimjiyani
UPDATE public.profiles SET
  role                = 'admin',
  job_title           = 'Co-Founder',
  company             = 'The Social Seen',
  industry            = 'Events & Entertainment',
  bio                 = 'Passionate about bringing London professionals together through unforgettable shared experiences. Building The Social Seen one evening at a time.',
  avatar_url          = 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&q=80&fit=crop&crop=face',
  linkedin_url        = 'https://linkedin.com/in/mitesh-bhimjiyani',
  onboarding_complete = true,
  referral_source     = 'Founder'
WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- Charlotte Davis
UPDATE public.profiles SET
  job_title           = 'Head of Marketing',
  company             = 'Monzo',
  industry            = 'Fintech',
  bio                 = 'Marketing leader at one of London''s favourite fintechs. Obsessive about good food, natural wine, and finding gallery openings that serve both.',
  avatar_url          = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&q=80&fit=crop&crop=face',
  linkedin_url        = 'https://linkedin.com/in/charlottedavis',
  onboarding_complete = true,
  referral_source     = 'WhatsApp community'
WHERE id = 'a0000000-0000-0000-0000-000000000002';

-- James Hartley
UPDATE public.profiles SET
  job_title           = 'Investment Manager',
  company             = 'Goldman Sachs',
  industry            = 'Finance',
  bio                 = 'Investment manager by day, amateur sommelier by weekend. Firm believer that the best deals are closed over a good bottle of Burgundy.',
  avatar_url          = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80&fit=crop&crop=face',
  linkedin_url        = 'https://linkedin.com/in/james-hartley-gs',
  onboarding_complete = true,
  referral_source     = 'LinkedIn'
WHERE id = 'a0000000-0000-0000-0000-000000000003';

-- Priya Sharma
UPDATE public.profiles SET
  job_title           = 'Senior UX Designer',
  company             = 'Deliveroo',
  industry            = 'Technology',
  bio                 = 'Designing experiences at Deliveroo and photographing everything in between. Always looking for the intersection of great design and great food.',
  avatar_url          = 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&q=80&fit=crop&crop=face',
  linkedin_url        = 'https://linkedin.com/in/priya-sharma-ux',
  onboarding_complete = true,
  referral_source     = 'Friend referral'
WHERE id = 'a0000000-0000-0000-0000-000000000004';

-- Oliver Bennett
UPDATE public.profiles SET
  job_title           = 'Founder & CEO',
  company             = 'Birchwood Studio',
  industry            = 'D2C / E-commerce',
  bio                 = 'Building a sustainable homeware brand from East London. Previously VP Product at Bulb. Love running at stupid o''clock and talking shop with other founders.',
  avatar_url          = 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80&fit=crop&crop=face',
  linkedin_url        = 'https://linkedin.com/in/oliverbennett',
  onboarding_complete = true,
  referral_source     = 'Friend referral'
WHERE id = 'a0000000-0000-0000-0000-000000000005';

-- Sophie Williams
UPDATE public.profiles SET
  job_title           = 'Senior Associate',
  company             = 'Clifford Chance',
  industry            = 'Legal',
  bio                 = 'M&A lawyer who spends her evenings hunting down the best supper clubs in London. If you know of a restaurant with fewer than ten covers, please send it my way.',
  avatar_url          = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&q=80&fit=crop&crop=face',
  linkedin_url        = 'https://linkedin.com/in/sophie-williams-law',
  onboarding_complete = true,
  referral_source     = 'WhatsApp community'
WHERE id = 'a0000000-0000-0000-0000-000000000006';

-- Marcus Chen
UPDATE public.profiles SET
  job_title           = 'Senior Product Manager',
  company             = 'Google',
  industry            = 'Technology',
  bio                 = 'Product manager working on Google Maps in London. Passionate about cities, jazz, and finding the kind of bars that don''t show up on Google Maps.',
  avatar_url          = 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&q=80&fit=crop&crop=face',
  linkedin_url        = 'https://linkedin.com/in/marcuschen-pm',
  onboarding_complete = true,
  referral_source     = 'Instagram'
WHERE id = 'a0000000-0000-0000-0000-000000000007';

-- ── Step 3: User Interests ───────────────────────────────────────────────────

INSERT INTO public.user_interests (user_id, interest) VALUES
  -- Mitesh
  ('a0000000-0000-0000-0000-000000000001', 'Entrepreneurship'),
  ('a0000000-0000-0000-0000-000000000001', 'Networking'),
  ('a0000000-0000-0000-0000-000000000001', 'Wine & Cocktails'),
  ('a0000000-0000-0000-0000-000000000001', 'Technology'),
  -- Charlotte
  ('a0000000-0000-0000-0000-000000000002', 'Wine & Cocktails'),
  ('a0000000-0000-0000-0000-000000000002', 'Fine Dining'),
  ('a0000000-0000-0000-0000-000000000002', 'Art & Culture'),
  ('a0000000-0000-0000-0000-000000000002', 'Networking'),
  -- James
  ('a0000000-0000-0000-0000-000000000003', 'Fine Dining'),
  ('a0000000-0000-0000-0000-000000000003', 'Wine & Cocktails'),
  ('a0000000-0000-0000-0000-000000000003', 'Running & Sport'),
  ('a0000000-0000-0000-0000-000000000003', 'Networking'),
  -- Priya
  ('a0000000-0000-0000-0000-000000000004', 'Art & Culture'),
  ('a0000000-0000-0000-0000-000000000004', 'Yoga & Wellness'),
  ('a0000000-0000-0000-0000-000000000004', 'Technology'),
  ('a0000000-0000-0000-0000-000000000004', 'Photography'),
  -- Oliver
  ('a0000000-0000-0000-0000-000000000005', 'Entrepreneurship'),
  ('a0000000-0000-0000-0000-000000000005', 'Technology'),
  ('a0000000-0000-0000-0000-000000000005', 'Running & Sport'),
  ('a0000000-0000-0000-0000-000000000005', 'Wine & Cocktails'),
  -- Sophie
  ('a0000000-0000-0000-0000-000000000006', 'Fine Dining'),
  ('a0000000-0000-0000-0000-000000000006', 'Yoga & Wellness'),
  ('a0000000-0000-0000-0000-000000000006', 'Art & Culture'),
  ('a0000000-0000-0000-0000-000000000006', 'Books & Literature'),
  -- Marcus
  ('a0000000-0000-0000-0000-000000000007', 'Technology'),
  ('a0000000-0000-0000-0000-000000000007', 'Jazz & Music'),
  ('a0000000-0000-0000-0000-000000000007', 'Wine & Cocktails'),
  ('a0000000-0000-0000-0000-000000000007', 'Running & Sport');

-- ── Step 4: Events ───────────────────────────────────────────────────────────

-- Clear all event-dependent data first (FK order)
DELETE FROM public.event_photos;
DELETE FROM public.event_reviews;
DELETE FROM public.bookings;
DELETE FROM public.event_inclusions;
DELETE FROM public.event_hosts;
DELETE FROM public.events;

INSERT INTO public.events (
  id, slug, title, description, short_description,
  date_time, end_time, venue_name, venue_address,
  category, price, capacity, image_url, dress_code,
  is_published, is_cancelled
) VALUES

-- ── Past Events (1–30) ───────────────────────────────────────────────────────

-- Event 01: Fairgame and Pizza, Canary Wharf — Jan 2024
(
  'e1000000-0000-0000-0000-000000000001',
  'fairgame-pizza-canary-wharf-jan-2024',
  'Fairgame and Pizza, Canary Wharf',
  'Fairgame sits beneath the glass and steel of Canary Wharf like a deliberate act of subversion — a warehouse full of reimagined fairground games, neon lights, and cocktail servers weaving between skeeball and ring toss. It''s the kind of place that breaks down the professional formality London so readily hands you on a Monday morning.

Twenty members gathered for what became an unexpectedly competitive evening. The hook-a-duck station drew particular intensity. The pinball machines held their own small crowds. By the time the group migrated for pizza, people who''d arrived as strangers were negotiating rematches.

This was the first Social Seen gathering of 2024 — small enough to feel like a dinner party, noisy enough to make introductions easy. If you''ve ever wanted to meet interesting people without the awkwardness of a structured networking event, this was the template for everything that followed.',
  'An evening of competitive nostalgia at Fairgame''s immersive gaming bar, followed by pizza in the shadow of the towers. Twenty people, no pretension, good conversation.',
  '2024-01-19 18:30:00+00',
  '2024-01-19 22:00:00+00',
  'Fairgame',
  '14 Water Street, Canary Wharf, London E14 5GX',
  'drinks',
  0,
  20,
  'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&q=80',
  NULL,
  true, false
),

-- Event 02: Cocktails and Pizza at London Cocktail Club, Covent Garden — Feb 2024
(
  'e1000000-0000-0000-0000-000000000002',
  'cocktails-pizza-london-cocktail-club-feb-2024',
  'Cocktails and Pizza at London Cocktail Club, Covent Garden',
  'London Cocktail Club has built its reputation on bartenders who treat their craft with the seriousness of a sommelier and the showmanship of a magician. The Covent Garden branch — steps from the Piazza, with its low ceilings and deliberately maximalist interior — is the right setting for an evening that wants to be remembered.

Thirty-five members arrived across a Friday evening, the group evolving organically as cocktails arrived in smoke-filled domes and vessels that seemed borrowed from a chemistry lab. The pizza, when it came, was straightforward and good — the kind of food that holds a long evening together without demanding attention.

The backdrop helped. Covent Garden in the evening has a specific energy: tourists have mostly retreated, the theatres are filling, and the streets carry that particular London Friday feeling of a city deciding what it wants to be tonight. The Social Seen answered that question for thirty-five of them.',
  'London Cocktail Club''s Covent Garden outpost — serious drinks, theatrical presentation, and thirty-five people who''d never met before sharing a table like old friends.',
  '2024-02-09 18:30:00+00',
  '2024-02-09 22:30:00+00',
  'London Cocktail Club',
  '4 Upper St Martin''s Lane, London WC2H 9NY',
  'drinks',
  0,
  35,
  'https://images.unsplash.com/photo-1527661591475-527312dd65f5?w=800&q=80',
  NULL,
  true, false
),

-- Event 03: Axe Throwing and Drinks, Soho — Mar 2024
(
  'e1000000-0000-0000-0000-000000000003',
  'axe-throwing-drinks-soho-mar-2024',
  'Axe Throwing and Drinks, Soho',
  'There''s something clarifying about throwing an axe. The Soho venue — one of several that have colonised converted basements and railway arches across London — provides instructors patient enough to make everyone feel capable within twenty minutes, and targets forgiving enough to reward modest technique. Forty-five members arrived, many expecting to be terrible, and most of them were correct.

What axe throwing does particularly well — better than most social activities — is manufacture shared experience rapidly. The combination of mild danger, visible skill gaps, and the genuine satisfaction of a clean hit creates conversation that doesn''t require effort. By the end of the session, people had formed into loose teams, grudge matches had been settled, and at least one person had developed opinions about throwing technique that they were confident sharing.

The group moved to a pub in the surrounding streets afterwards, the kind of Soho institution that''s been there long enough to feel inevitable. The evening finished late. The following morning several people messaged the group to ask when the next one was.',
  'Forty-five people, weighted axes, and a Soho side street you''d walk past without a second glance. Competitive instincts surfaced promptly. The pub drinks afterwards were well-earned.',
  '2024-03-08 18:00:00+00',
  '2024-03-08 21:30:00+00',
  'Whistle Punks Urban Axe Throwing',
  '28 Arundel Street, London WC2R 3DQ',
  'sport',
  2500,
  45,
  'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80',
  NULL,
  true, false
),

-- Event 04: Drinks at Stereo Bar, Covent Garden — Apr 2024
(
  'e1000000-0000-0000-0000-000000000004',
  'drinks-stereo-bar-covent-garden-apr-2024',
  'Drinks at Stereo Bar, Covent Garden',
  'Stereo Bar occupies the kind of Covent Garden space that works in every season but particularly in spring, when the area shakes off its January utility and reminds everyone why they moved to London in the first place. The bar''s layout — multiple levels, distinct corners, a sound system that adds presence without preventing conversation — suited an evening at scale.

Seventy members across an April Friday: the largest Social Seen gathering to that point. Events at this scale carry a specific challenge — the risk of feeling like a corporate mixer, of standing with a drink not quite knowing where to position yourself. The solution is always time and music. Within an hour the crowd had found its natural clusters, conversations had developed the unhurried quality that marks a good evening, and the bar staff were managing a steady stream of orders with impressive composure.

This was as much a milestone as a party — proof that the group had grown to the point where a large-format evening could work, and work well. Regulars brought friends. Several of the evening''s introductions led to people attending subsequent events together.',
  'Stereo Bar, Covent Garden — spring drinks with seventy people. Large enough to find your crowd, intimate enough to actually find it.',
  '2024-04-12 18:30:00+00',
  '2024-04-12 23:00:00+00',
  'Stereo',
  '14 King Street, Covent Garden, London WC2E 8JD',
  'drinks',
  0,
  70,
  'https://images.unsplash.com/photo-1570051008600-b34baa49e751?w=800&q=80',
  NULL,
  true, false
),

-- Event 05: LSQ Rooftop Bar, Leicester Square — May 2024
(
  'e1000000-0000-0000-0000-000000000005',
  'lsq-rooftop-bar-leicester-square-may-2024',
  'LSQ Rooftop Bar, Leicester Square',
  'LSQ sits above Leicester Square with the particular confidence of a venue that knows its view will do the work. The terrace looks out over the square itself and, on a clear evening, extends to the kind of London skyline panorama that never quite loses its effect on people who live here. May light in London — low, golden, arriving later each evening — transforms a rooftop bar from a daytime proposition into something considerably more atmospheric.

Thirty-two members gathered as the city slid from late afternoon into early evening. The bar''s cocktail list is thorough without being overwhelming. The service has the attentiveness that comes from knowing the view keeps people longer than they plan to stay. Conversations about where to get a table for dinner afterwards became, for many, redundant — nobody wanted to leave.

For first-time attendees, rooftop events have a particular advantage: the view provides instant common ground, removes the need for an opening line, and means that the city itself becomes part of the conversation. London is considerably easier to love from fifteen floors up.',
  'London from above, Leicester Square below, thirty-two people with good views and better company. The kind of May evening that makes everything feel briefly possible.',
  '2024-05-17 18:00:00+00',
  '2024-05-17 21:30:00+00',
  'LSQ London',
  '1 Leicester Square, London WC2H 7NA',
  'drinks',
  0,
  32,
  'https://images.unsplash.com/photo-1516912481808-3406841bd33c?w=800&q=80',
  NULL,
  true, false
),

-- Event 06: Drinks at Luna Gin Bar — Aug 2024
(
  'e1000000-0000-0000-0000-000000000006',
  'drinks-luna-gin-bar-aug-2024',
  'Drinks at Luna Gin Bar',
  'Luna Gin Bar takes its subject matter seriously — the back bar contains varieties that reward reading and a staff willing to explain the differences with genuine enthusiasm rather than rehearsed patter. This is the kind of drinks venue that nudges a casual evening toward something more considered, without ever making it feel like an education.

Seventy-five members across a Thursday in August: London in the last weeks before the city remembers it''s supposed to rain. The summer gatherings carry a slightly different energy from the rest of the year — lighter clothes, open windows, the city''s professional population slightly more willing to linger. The bar held the crowd well, the gin and tonics arrived properly constructed, and the evening stretched to the kind of length that only happens when nobody has a particular reason to leave.

For those who''d been with The Social Seen from the early months, this felt like a different proposition — a community rather than a series of events, with faces becoming familiar and new arrivals being absorbed warmly rather than standing at the edges.',
  'Seventy-five members, summer in full effect, and a gin bar serious about its botanicals. The August gathering that reminded everyone what this city does well in the heat.',
  '2024-08-08 18:30:00+00',
  '2024-08-08 23:00:00+00',
  'Luna Gin Bar',
  '33 Wellington Street, Covent Garden, London WC2E 7BN',
  'drinks',
  0,
  75,
  'https://images.unsplash.com/photo-1542206395-9feb3edaa68d?w=800&q=80',
  NULL,
  true, false
),

-- Event 07: Flight Club and Drinks at The Little Scarlett Door — Sep 2024
(
  'e1000000-0000-0000-0000-000000000007',
  'flight-club-little-scarlett-door-sep-2024',
  'Flight Club and Drinks at The Little Scarlett Door',
  'Flight Club in Soho has refined the art of social darts into something that works at precisely this group size — teams of six around a dartboard with stadium scoring, cocktails engineered for longevity, and a system that somehow makes everyone feel competitive regardless of ability. The venue''s noise level is pitched precisely at the level where conversations between throws become necessary rather than optional.

Thirty-two members split into teams across a September Friday. Rivalries emerged within the first round. At least two people who professed to have never played darts before finished with surprisingly respectable averages. The scoring system, which rewards consistency over glory, kept every team viable until the final boards.

The group moved to The Little Scarlett Door afterwards — a members'' bar on a Soho side street with a cocktail menu worth attention and the pleasing quality of feeling discovered. The contrast between Flight Club''s deliberate theatricality and the bar''s measured intimacy made the evening feel like two events in one, both working well.',
  'Social darts at Flight Club followed by cocktails at one of Soho''s better-kept secrets. Thirty-two people who discovered they care a great deal about darts when money isn''t involved.',
  '2024-09-13 18:30:00+00',
  '2024-09-13 23:00:00+00',
  'Flight Club Soho',
  '2 Bedford Avenue, London WC1B 3RA',
  'sport',
  2000,
  32,
  'https://images.unsplash.com/photo-1553361371-9b22f78e8b1d?w=800&q=80',
  NULL,
  true, false
),

-- Event 08: Weekend in the Cotswolds — Oct 2024
(
  'e1000000-0000-0000-0000-000000000008',
  'weekend-cotswolds-oct-2024',
  'Weekend in the Cotswolds',
  'The Cotswolds in October is one of the more reliable pleasures available to people who live in London and occasionally remember that it is not, in fact, the entire country. The house — stone built, the kind of place with enough rooms that people have corners to retreat to but enough communal space that the group naturally converges — held twenty members across a weekend that moved at deliberately unhurried pace.

Days involved walking lanes where the leaves had turned properly amber and the light arrived at an angle that rewards a camera. The villages provided lunch and the particular satisfaction of a pub that has been serving the same menu since before any of us were born. Evenings were for the table — long dinners that began with wine and ended with the kind of conversation that benefits from having nowhere else to be.

Twenty is the right number for a weekend away: large enough to ensure you''ll find people you want to talk to, small enough that the house doesn''t feel like a conference. Several of those twenty are now among the group''s most regular faces. There''s a version of The Social Seen that only makes sense once you''ve seen what happens to a group of strangers over forty-eight hours and a shared kitchen.',
  'Twenty people, a country house, the Cotswolds in October. Stone walls, long walks, open fires, and the kind of weekend that requires no further justification.',
  '2024-10-04 16:00:00+00',
  '2024-10-06 18:00:00+00',
  'Cotswolds Country House',
  'Great Rissington Farm, Great Rissington, Cheltenham GL54 2LL',
  'cultural',
  25000,
  20,
  'https://images.unsplash.com/photo-1533929736458-ca588d08c8be?w=800&q=80',
  NULL,
  true, false
),

-- Event 09: Drinks at Amiga Bar and Archers Street, Clapham — Oct 2024
(
  'e1000000-0000-0000-0000-000000000009',
  'drinks-amiga-archers-clapham-oct-2024',
  'Drinks at Amiga Bar and Archers Street, Clapham',
  'Clapham''s bar scene has a particular quality that distinguishes it from the equivalent across the river: it takes its nights seriously without taking itself seriously. Amiga Bar and Archers Street, both within comfortable walking distance of the Common, represent the better end of this — venues with considered drinks menus and the kind of floor plan that keeps conversation circulating rather than settling.

Forty-two members across an October Friday, spread between the two venues in a format that meant the evening had natural movement built into it. The crowd at this point in the year had developed the particular density of regulars and new faces that marks a community finding its size — people who''d attended three or four events recognising each other and making introductions without prompting.

South London members had been asking for an event closer to home since the spring. This delivered on that, and the attendance confirmed that a significant portion of the group lives south of the river and had been commuting north for events. Noted.',
  'Forty-two people across two of Clapham''s better bars. South London doing what it does — unpretentious rooms, honest drinks, and a crowd that knows how to use a Friday evening.',
  '2024-10-18 18:30:00+00',
  '2024-10-18 23:00:00+00',
  'Amiga Bar',
  '19 Old Town, Clapham, London SW4 0JT',
  'drinks',
  0,
  42,
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80',
  NULL,
  true, false
),

-- Event 10: Hiking in Snowdonia — Oct 2024
(
  'e1000000-0000-0000-0000-000000000010',
  'hiking-snowdonia-oct-2024',
  'Hiking in Snowdonia',
  'Snowdonia in late October operates on a different timescale from the rest of the year: the summer walkers have gone, the paths are quieter, the light is extraordinary when it decides to appear, and the mountain has the quality of a place that takes the visit seriously. Twenty members made the journey from London across a long weekend that offered both the Watkin Path to the summit and the less-walked ridges that reward the extra effort.

The first day established the group''s pace and appetite — some keen to push hard, others content with the panoramic rewards of the lower routes. The youth hostel accommodation, deliberately communal, compressed the getting-to-know-you process that usually takes several events into a single evening around a shared meal. By day two, hiking partners had been established and the group had developed the easy shorthand of people who''ve been cold and uphill together.

Returning to London on the Monday felt, for many, like a small readjustment. The mountains have that effect. The group photograph taken at the summit cairn is, by some margin, the most-liked image in the entire Social Seen archive.',
  'Three days, Snowdon''s ridgelines, twenty people in the last good weather before November. Wales at its most persuasive — dramatic, quiet, and entirely unlike London.',
  '2024-10-25 09:00:00+00',
  '2024-10-27 18:00:00+00',
  'Snowdonia National Park',
  'Pen-y-Pass YHA, Nant Gwynant, Caernarfon LL55 4NY',
  'sport',
  15000,
  20,
  'https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&q=80',
  NULL,
  true, false
),

-- Event 11: Black Tie Evening, Pall Mall — Nov 2024
(
  'e1000000-0000-0000-0000-000000000011',
  'black-tie-pall-mall-nov-2024',
  'Black Tie Evening, Pall Mall',
  'Pall Mall''s gentlemen''s clubs and private venues occupy a very specific register — rooms where the architecture itself demands a standard of dress and occasion that the rest of London''s social calendar rarely requires. Whatever the venue for this evening, it delivered: the kind of space with portraits on the walls and ceilings high enough to make conversation feel like it carries slightly more weight.

The black tie instruction was taken seriously. The arrival of a formally dressed group into a room designed precisely for formally dressed groups produced the effect that formal occasions exist to create — a sense that the evening is distinct from the ordinary, that it merits the effort, that there is something worth arriving for.

The Social Seen doesn''t often do formal, which is precisely why it works when it does. The contrast with Fairgame in January — twenty people in streetwear playing skeeball — illustrated the range deliberately. London''s professionals contain multitudes. This was the evening for one of them.',
  'Black tie, Pall Mall, the kind of room that requires the formality. An evening that reminded everyone they own evening wear for good reason.',
  '2024-11-08 18:30:00+00',
  '2024-11-08 23:30:00+00',
  'The Reform Club',
  '104 Pall Mall, London SW1Y 5EW',
  'dining',
  12500,
  40,
  'https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?w=800&q=80',
  'Black tie',
  true, false
),

-- Event 12: Fireworks Night, Totteridge Cricket Club — Nov 2024
(
  'e1000000-0000-0000-0000-000000000012',
  'fireworks-night-totteridge-cricket-club-nov-2024',
  'Fireworks Night, Totteridge Cricket Club',
  'Totteridge Cricket Club sits in one of those north London pockets that feels like it belongs to an earlier, quieter version of the city — green, unhurried, and possessed of the particular quiet authority of a club that''s been there long enough not to need to announce itself. On bonfire night, with a proper fire and fireworks, it becomes the kind of setting that makes you feel briefly nostalgic for something you may not have personally experienced.

The gathering carried the easy warmth of an outdoor occasion with an indoor fallback — mulled wine circulating, the woodsmoke making everyone''s coat smell like November for days afterwards, conversations interrupted pleasantly by particularly good bursts overhead. Children from member families ran in the direction of the fire with the confidence of people whose parents were nearby.

Bonfire night in London is generally a loud, crowded, municipal affair. This was a reminder that the right venue and the right crowd converts it into something considerably more pleasant — a proper occasion rather than a queue.',
  'Bonfire night at Totteridge Cricket Club — mulled wine, woodsmoke, fireworks over north London, and the kind of communal occasion that the city still does well when it remembers to.',
  '2024-11-05 18:00:00+00',
  '2024-11-05 22:00:00+00',
  'Totteridge Cricket Club',
  '145 Totteridge Lane, London N20 8LY',
  'cultural',
  1000,
  80,
  'https://images.unsplash.com/photo-1467810563316-b1af168c36a5?w=800&q=80',
  NULL,
  true, false
),

-- Event 13: Comedy and Dinner in Angel — Nov 2024
(
  'e1000000-0000-0000-0000-000000000013',
  'comedy-dinner-angel-nov-2024',
  'Comedy and Dinner in Angel',
  'Angel''s comedy circuit occupies a tier below the O2 and above the open mic — working comedians on the way up, performing for rooms small enough that eye contact is not only possible but occasionally unavoidable. This is a feature rather than a drawback: the intimacy makes the evening feel live in a way that seated theatre rarely does.

Ten members — a deliberately small group for a Sunday — arrived for a show that ran approximately eighty minutes and featured three acts of varying style, all competent, one genuinely excellent. The dinner that followed, at one of the Islington roads that has accumulated enough good restaurants per yard to make the choice difficult, continued the evening in a register that the comedy had helpfully warmed up.

Small events within The Social Seen serve a distinct function from the large ones — they''re where friendships rather than acquaintances form, where the conversation doesn''t reset when the next person arrives, where you leave knowing that a specific group of people had a specific evening together. This was one of those.',
  'Ten people, a comedy show in Angel, dinner afterwards. Intimate enough that everyone knows everyone''s name by the end. The kind of Sunday evening that earns its keep.',
  '2024-11-17 18:30:00+00',
  '2024-11-17 22:30:00+00',
  'The Bill Murray',
  '39 Queen''s Head Street, London N1 8NQ',
  'cultural',
  2000,
  10,
  'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&q=80',
  NULL,
  true, false
),

-- Event 14: Tate Late — Nov 2024
(
  'e1000000-0000-0000-0000-000000000014',
  'tate-late-nov-2024',
  'Tate Late',
  'Tate Modern''s Late openings transform a daytime institution into something with a different temperature: the crowds thin to a density where the art can be approached rather than observed from a distance, the Turbine Hall acquires a cathedral quality in its emptiness, and the top-floor bar has the river view that London holds in reserve for evenings that deserve it.

Thirty members arrived across a November Friday, spreading across the floors with the mix of intention and drift that a gallery at this scale rewards. Some came to see specific exhibitions; others used the building as the venue and the art as a backdrop. Both are valid. The permanent collection — Rothko in the dim Seagram Murals room, the Surrealist galleries, whatever commission occupied the Turbine Hall that season — held the group''s attention differently.

The drinks at the top were, as always, the reward for the climb: the Thames in both directions, the lights of the Shard and the City competing for attention, and thirty people comparing what they''d seen with the unhurried thoroughness that only emerges after the obligation of getting to the gallery has been satisfied.',
  'Tate Modern after hours — thirty members, the Turbine Hall at night, temporary exhibitions, and the bar on the top floor with the view that earns every word written about it.',
  '2024-11-22 18:00:00+00',
  '2024-11-22 22:00:00+00',
  'Tate Modern',
  'Bankside, London SE1 9TG',
  'cultural',
  0,
  30,
  'https://images.unsplash.com/photo-1526040652367-ac003a0475fe?w=800&q=80',
  NULL,
  true, false
),

-- Event 15: Christmas Party at Tonteria, Sloane Square — Dec 2024
(
  'e1000000-0000-0000-0000-000000000015',
  'christmas-party-tonteria-sloane-square-dec-2024',
  'Christmas Party at Tonteria, Sloane Square',
  'Tonteria occupies a basement off Sloane Square with the conviction of a venue that knows exactly what it is: a Mexican-themed bar and club with serious tequila, better-than-expected cocktails, and a sound system that begins the evening at social volume and ends it at something considerably more committed. King''s Road Christmas is a specific phenomenon — the area leans into the season with a thoroughness that manages to feel festive rather than commercial.

One hundred members across a December Thursday: the Social Seen Christmas party as a statement of scale. The group had grown over the year from twenty people in Canary Wharf to this — a crowd large enough to feel like a proper party, with the recognition factor of a community that had attended events together through spring, summer, and autumn.

The evening moved through the gears it was designed for: cocktails and introductions, dinner at the long tables, and the gradual transition to the dancefloor that Tonteria handles with practiced ease. By midnight the room had reached that specific pitch where conversations become impossible and unnecessary in equal measure. This was the year''s punctuation mark — everything that had been built over twelve months, in one room, on one evening.',
  'One hundred members, Tonteria''s basement, December in full swing. The Social Seen''s biggest night yet — tequila, dancing, and a room that got progressively louder in the best possible way.',
  '2024-12-12 18:30:00+00',
  '2024-12-13 01:00:00+00',
  'Tonteria',
  '7-12 Sloane Square, London SW1W 8EE',
  'drinks',
  3500,
  100,
  'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&q=80',
  'Smart casual',
  true, false
),

-- Event 16: Christmas Eve Volunteering with Crisis — Dec 2024
(
  'e1000000-0000-0000-0000-000000000016',
  'christmas-volunteering-crisis-dec-2024',
  'Christmas Eve Volunteering with Crisis',
  'Crisis runs its Christmas operations across multiple venues in London, converting large spaces into warm, staffed centres for people experiencing homelessness over the holiday period. The organisation is extremely good at what it does, which means volunteers are deployed with purpose rather than goodwill alone — there are things to do, roles to fill, and the work is consequential in the immediate way that voluntary work at its best can be.

Social Seen members arrived on Christmas Eve in a group small enough to deploy effectively and large enough to make a visible difference across a shift. The work involved serving meals, keeping company, and making the kind of conversation that the occasion demands — present, genuine, without the performance that charity work sometimes produces in those volunteering rather than those receiving.

What remains from this event is harder to articulate than a rooftop view or a good cocktail. Several members mentioned that it changed the texture of their Christmas Day. Some have returned to Crisis volunteering independently since. This was on the calendar because it ought to be — and it delivered something that the rest of the year''s events, excellent as they were, couldn''t.',
  'Christmas Eve at a Crisis centre — serving meals, talking, making an afternoon useful in the way that no party quite replicates. The most quietly memorable event of the year.',
  '2024-12-24 10:00:00+00',
  '2024-12-24 17:00:00+00',
  'Crisis Christmas Centre',
  '66 Commercial Street, London E1 6LT',
  'cultural',
  0,
  20,
  'https://images.unsplash.com/photo-1593113630400-ea4288922702?w=800&q=80',
  NULL,
  true, false
),

-- Event 17: Dim Sum for Chinese New Year at Leong's Legends, Chinatown — Jan 2025
(
  'e1000000-0000-0000-0000-000000000017',
  'dim-sum-chinese-new-year-leongs-legends-jan-2025',
  'Dim Sum for Chinese New Year at Leong''s Legends, Chinatown',
  'Leong''s Legends on Wardour Street occupies a position in London''s Chinatown that regulars know and visitors discover with relief — a restaurant serious enough about its dim sum to have earned a devoted clientele, but unpretentious enough that a group of fifty can arrive and be absorbed rather than managed. The har gow and siu mai are the standards against which the rest should be measured. The char siu bao is made with conviction.

Chinese New Year in Chinatown is one of London''s better public celebrations — the streets fill with the specific energy of a community marking something real, the dragon dancers work through the narrow lanes between the restaurants, and the season gives even a Tuesday evening the quality of an occasion. Fifty members descended across what became a rolling table of trolleys, chopstick negotiations, and the kind of communal meal where dishes are shared before anyone has read the menu.

New Year''s gatherings carry particular weight at The Social Seen: the transition from one year''s community to the next, the mixture of familiar faces and people attending their first event, the sense that the year ahead is being opened rather than merely beginning. This one was loud, warm, and ate well.',
  'Chinese New Year at Leong''s Legends — fifty members, Chinatown at its most celebratory, dim sum from the trolleys, and the kind of communal table noise that makes everything feel festive.',
  '2025-01-29 18:30:00+00',
  '2025-01-29 22:00:00+00',
  'Leong''s Legends',
  '4 Macclesfield Street, London W1D 6AX',
  'dining',
  2500,
  50,
  'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800&q=80',
  NULL,
  true, false
),

-- Event 18: Valentine's Singles Evening — Feb 2025
(
  'e1000000-0000-0000-0000-000000000018',
  'valentines-singles-evening-feb-2025',
  'Valentine''s Singles Evening',
  'The Social Seen''s Valentine''s event was built on a premise worth defending: that 14th February is an evening that single people in their thirties and forties are perfectly entitled to enjoy, without it needing to feel like a corrective measure or an event designed to solve something. Thirty members arrived with that understanding and the evening delivered accordingly.

The format was social rather than structured — no rounds, no scoreboards, no enforced mingling with a timer. The assumption was that people who had already self-selected into a community of curious, professionally active Londoners would not require architectural nudging to find interesting people to talk to. The assumption proved correct.

What distinguishes this evening in retrospect is its lightness. It did not take itself seriously in the way that Valentine''s events often do. Several attendees mentioned that they''d attended other singles events that left them feeling worse, not better, about the evening''s premise. This one did the opposite. Some people exchanged numbers. Most left with new friends. All of them, by the group''s account, ate and drank well.',
  'Valentine''s Day without the obligation — thirty single members, a proper venue, and an evening designed to be enjoyed regardless of outcome. No roses. No speed dating. Just good company.',
  '2025-02-14 19:00:00+00',
  '2025-02-14 23:00:00+00',
  'Mr Fogg''s Residence',
  '15 Bruton Lane, Mayfair, London W1J 6JD',
  'drinks',
  0,
  30,
  'https://images.unsplash.com/photo-1516450137517-162bfbeb8dba?w=800&q=80',
  NULL,
  true, false
),

-- Event 19: Meet Over Pizza at Breadstall — Feb 2025
(
  'e1000000-0000-0000-0000-000000000019',
  'meet-over-pizza-breadstall-feb-2025',
  'Meet Over Pizza at Breadstall',
  'Breadstall makes Roman-style pizza: thin, crisp, sold by the rectangular slice or the full tray, with a rotating menu that rewards repeat visits. It is a focused operation — the kitchen has a point of view and executes it with consistency. For an evening with forty people who mostly don''t know each other, a focused pizza operation with a convivial floor plan is close to ideal.

February has a specific social texture in London — the January resolve has softened, the city has readmitted fun to the schedule, and a pizza-and-wine evening in a warm room requires no further argument. Forty members across what became a long, unhurried meal: the kind where the empty plates stay on the table because nobody wants to signal that the evening is over.

Breadstall has since become one of several venues the Social Seen returns to — places that feel right for the group, that the staff recognise us in, that have become part of the community''s geography as much as any member''s flat. This was the first visit that established that relationship.',
  'Breadstall''s Roman-style pizza — forty people, a relaxed February evening, the kind of place that converts first-timers into regulars on a single visit.',
  '2025-02-27 18:30:00+00',
  '2025-02-27 22:00:00+00',
  'Breadstall',
  '30 Great Windmill Street, Soho, London W1D 7LR',
  'dining',
  2000,
  40,
  'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80',
  NULL,
  true, false
),

-- Event 20: Skiing in St Moritz at ClubMed — Feb 2025
(
  'e1000000-0000-0000-0000-000000000020',
  'skiing-st-moritz-clubmed-feb-2025',
  'Skiing in St Moritz at ClubMed',
  'ClubMed''s St Moritz operation runs with the Swiss efficiency you''d expect applied to the French all-inclusive concept — ski passes, instruction, accommodation, meals, and evening entertainment folded into a single proposition that removes the logistical overhead that makes ski trips complicated. The resort itself needs no particular introduction: Engadine valley, 1,800 metres, the kind of snow reliability that justifies the fare.

Fifteen members across a week represents the Social Seen at its most extended — a group small enough to become genuinely close over shared runs and shared dinners, large enough that ability levels spread across the slopes naturally. The mornings belonged to the mountain; the afternoons to the pool and the apres; the evenings to long tables and the specific quality of conversation that arrives when tired skiers have access to good wine and no obligation to be anywhere else.

By Thursday, the group had developed the particular intimacy of people who have seen each other fall down and get up again, sometimes literally. The return flight carried twelve people who had left London as acquaintances and landed as friends. Three of them have booked a repeat together independently. That seems like the right metric.',
  'St Moritz, ClubMed, fifteen people, a week. The Swiss Alps in February. Some skied well. Others improved significantly. All of them would go again.',
  '2025-02-08 08:00:00+00',
  '2025-02-15 20:00:00+00',
  'ClubMed St Moritz',
  'Via San Gian 6, 7500 St Moritz, Switzerland',
  'sport',
  150000,
  15,
  'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=800&q=80',
  NULL,
  true, false
),

-- Event 21: Oliver Heldens at O2 Brixton Academy — Mar 2025
(
  'e1000000-0000-0000-0000-000000000021',
  'oliver-heldens-o2-brixton-academy-mar-2025',
  'Oliver Heldens at O2 Brixton Academy',
  'The O2 Academy Brixton is one of those venues that has accumulated enough history and enough nights to have a specific feeling the moment you walk in — the rake of the floor, the low ceiling that traps the bass, the bar that runs along one side, and the stage relationship with the crowd that a purpose-built club never quite achieves. Dutch house music in a room like this is a different proposition from a polished Mayfair venue.

Oliver Heldens plays the kind of set that moves between peak-time pressure and melodic release with the confidence of someone who''s been doing this for long enough to know which way the room is leaning. The Social Seen group arrived together, found the floor together, and dispersed and reconverged in the natural pattern of a good night at a proper venue.

Some members had never heard of Oliver Heldens before the invite landed. Several are now converted. This is one of the ways The Social Seen works: the group''s shared trust transfers to individual recommendations, expanding everyone''s cultural map in the process.',
  'Oliver Heldens at Brixton Academy — proper dance music in a venue that knows how to hold it. The evening that confirmed some Social Seen members should be seen more often on a dancefloor.',
  '2025-03-14 21:00:00+00',
  '2025-03-15 02:00:00+00',
  'O2 Academy Brixton',
  '211 Stockwell Road, London SW9 9SL',
  'music',
  3000,
  30,
  'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=800&q=80',
  NULL,
  true, false
),

-- Event 22: Mini Golf and Drinks in the City — Apr 2025
(
  'e1000000-0000-0000-0000-000000000022',
  'mini-golf-drinks-city-apr-2025',
  'Mini Golf and Drinks in the City',
  'The indoor mini golf venues that have proliferated across London''s financial district occupy a specific niche: venues designed for the after-work crowd, positioned to catch the City''s professionals before they make for Liverpool Street. The courses tend toward the elaborately themed; the cocktails tend toward the reliably serviceable; the atmosphere tends toward the unexpectedly competitive.

The Social Seen offered three options at £15, £15, or £30 for the combined package — golf and a welcome drink, clearly priced for people who wanted flexibility. The group gathered from 6:30pm as the office buildings around them began emptying, the April light still reasonable enough to make the walk feel like a choice rather than a concession.

Mini golf serves the same social function as axe throwing — it creates stakes without consequence, shared experience without shared history, and the kind of banter that strangers can engage in without vulnerability. By the time the drinks were flowing and the final holes disputed, the group had done what it reliably does: converted a themed activity into a proper evening.',
  'Mini golf amid the office towers, followed by drinks. The City on a spring evening, briefly reclaimed.',
  '2025-04-11 18:30:00+00',
  '2025-04-11 22:00:00+00',
  'Swingers Wild Golf',
  '8 Bishopsgate, London EC2M 4QJ',
  'sport',
  1500,
  30,
  'https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=800&q=80',
  NULL,
  true, false
),

-- Event 23: Queen of Wands Recital at Union Theatre — May 2025
(
  'e1000000-0000-0000-0000-000000000023',
  'queen-of-wands-union-theatre-may-2025',
  'Queen of Wands Recital at Union Theatre',
  'The Union Theatre sits beneath a railway arch on the South Bank, operating at the scale where theatre stops being a cultural obligation and becomes a conversation between the stage and an audience close enough to be implicated. At this size, performers cannot rely on spectacle; the writing and performance carry everything. The Queen of Wands recital — combining live music and theatrical performance — worked in precisely this register.

The audience for this event was smaller than most Social Seen gatherings, which suited the venue: an intimate performance in a room designed for intimacy, attended by a group of twenty who arrived as the audience and stayed for drinks and discussion in the arch''s small bar afterwards. The conversation that follows good theatre has a particular quality — people disagreeing productively about what they''ve seen, offering different readings, discovering each other''s minds as much as their company.

Twenty pounds is a notable price point — within reach, but enough to suggest that something real is on offer. At the Union Theatre, it consistently is.',
  'The Union Theatre on the South Bank — intimate, serious, and the kind of production that stays with you. Twenty pounds and a Tuesday evening well spent.',
  '2025-05-06 19:30:00+00',
  '2025-05-06 22:30:00+00',
  'Union Theatre',
  '229 Union Street, Southwark, London SE1 0LR',
  'cultural',
  2000,
  20,
  'https://images.unsplash.com/photo-1507676184212-d03ab07a01bf?w=800&q=80',
  NULL,
  true, false
),

-- Event 24: Hiking in the Lake District — May 2025
(
  'e1000000-0000-0000-0000-000000000024',
  'hiking-lake-district-may-2025',
  'Hiking in the Lake District',
  'The Lake District in mid-May operates in a productive ambiguity — the crowds haven''t arrived in earnest, the ground is recoverable from winter, and the peaks reward the effort with the specific quality of English hill walking: not the altitude of the Alps, but a relationship between land and sky and water that feels made rather than imposed. Helvellyn via Striding Edge is the kind of walk that people plan for years and remember for longer.

The group followed the pattern established in Snowdonia: walking in smaller natural clusters during the day, converging for meals and evenings at the accommodation, the intimacy of shared physical effort doing its usual work of compressing social distance. By the second morning, the group had the easiness of people who have eaten breakfast together twice and know what to expect from the day.

Grasmere village provided lunch and the gravitational pull of good cake in a tearoom that has been feeding walkers for the better part of a century. The drive back south on the Sunday afternoon — tired legs, full phones, the motorway feeling like a readjustment — was conducted mostly in contented quiet. Some experiences need no narration while they''re happening.',
  'Three days in the Lake District — Helvellyn, Grasmere, and the kind of northern English weather that is either character-forming or genuinely beautiful depending on the day.',
  '2025-05-23 09:00:00+00',
  '2025-05-25 18:00:00+00',
  'Lake District National Park',
  'Glenridding Car Park, Glenridding, Penrith CA11 0PB',
  'sport',
  20000,
  20,
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80',
  NULL,
  true, false
),

-- Event 25: Polo in the Park — Jun 2025
(
  'e1000000-0000-0000-0000-000000000025',
  'polo-in-the-park-jun-2025',
  'Polo in the Park',
  'Polo has the quality of a sport that makes no concessions to the uninitiated and is considerably more compelling for it. At Hurlingham or the Guards Polo Club — the established London-adjacent venues for the summer season — the ground-level experience is one of proximity to horses, the particular sound of a mallet connecting cleanly, and the compressed theatre of chukkas that require no context to appreciate.

The Social Seen''s group arrived with varied degrees of prior knowledge and departed mostly converted. The half-time divot-treading ritual — traditionally an invitation for spectators to walk the pitch and press back the turf — is, it turns out, an unexpectedly charming piece of crowd participation that has the side effect of getting everyone moving, mingling, and talking to people they hadn''t yet met.

A summer social event at a polo ground exists on the spectrum between sport and occasion — the match provides structure, the summer afternoon provides atmosphere, and the picnic blankets and Pimm''s provide the necessary English insistence that this is all perfectly normal and entirely worth the train fare out of Waterloo.',
  'A summer afternoon watching polo — all the pageantry, the grass, the divot-treading at half-time, and the particular pleasure of watching a sport that rewards patient attention.',
  '2025-06-07 14:00:00+00',
  '2025-06-07 18:30:00+00',
  'Guards Polo Club',
  'Smith''s Lawn, Windsor Great Park, Windsor SL4 2HT',
  'sport',
  5500,
  30,
  'https://images.unsplash.com/photo-1536064479547-7ee40b74b807?w=800&q=80',
  'Smart casual',
  true, false
),

-- Event 26: Picnic in Regent's Park — Jun 2025
(
  'e1000000-0000-0000-0000-000000000026',
  'picnic-regents-park-jun-2025',
  'Picnic in Regent''s Park',
  'Regent''s Park in June, when the weather obliges, is one of London''s outright gifts — the roses in the Queen Mary''s Garden, the long south-facing lawns where groups colonise space with the comfortable assertion of people who''ve earned a warm afternoon, and the particular quality of London summer light that arrives late and stays long. The Social Seen''s largest single gathering produced something that felt, by multiple accounts, like the event of the year.

Eighty members is a crowd that a park absorbs rather than contains — the group spread across blankets and carried its own natural sub-groupings, with people moving between clusters, meeting in the process of fetching more wine, finding conversations they hadn''t planned. The instruction to bring something to share produced the communal table effect without the restaurant setting: dishes from a dozen cuisines, contributions from the careful and the improvised, and the social ease that comes from food prepared with intent.

The afternoon stretched until the light changed and the park''s closing announcement cut through the conversations. Several members stayed in the park until the final warning. This is, in the end, what community looks like from above: a collection of people who chose to spend a Saturday afternoon in each other''s company when there were a hundred other options.',
  'Eighty members, a June Saturday, the best of Regent''s Park. Bring something to share, find a blanket, and discover what London looks like when the sun is out and there''s nowhere to be.',
  '2025-06-21 13:00:00+00',
  '2025-06-21 18:30:00+00',
  'Regent''s Park',
  'Chester Road, London NW1 4NR',
  'cultural',
  0,
  80,
  'https://images.unsplash.com/photo-1488841714725-bb4c32d1ac94?w=800&q=80',
  NULL,
  true, false
),

-- Event 27: End of Summer Party at Paloma, South Kensington — Sep 2025
(
  'e1000000-0000-0000-0000-000000000027',
  'end-of-summer-party-paloma-south-kensington-sep-2025',
  'End of Summer Party at Paloma, South Kensington',
  'Paloma sits in South Kensington''s quiet confidence — a neighbourhood that doesn''t need to announce itself, populated by residents who''ve made a considered choice and venues that understand their clientele. The bar is everything the postcode suggests: well-executed, unhurried, with a cocktail list that shows its working in the quality of ingredients rather than the length of the description.

September''s end-of-summer parties carry a distinct charge. The season is officially over; the evenings have shortened; the prospect of autumn has become undeniable. This generates, in people who''ve spent summer attending events and building something, a specific generosity — the sense that the good months should be marked before they''re stored. The crowd reflected this: familiar faces in a concentrated form, the year''s community at its most present.

Paloma held the evening well. The cocktails were specific and properly made. The bar''s scale meant conversations developed and stayed rather than scattering in the way large venues can produce. This was the Social Seen in South Kensington — which is to say, exactly at home.',
  'Paloma in South Kensington — the season''s last warm evening, cocktails that earned the bar''s reputation, and the specific energy of a crowd that knows September is the right time to hold nothing back.',
  '2025-09-19 19:00:00+00',
  '2025-09-19 23:00:00+00',
  'Paloma',
  '46 Thurloe Place, South Kensington, London SW7 2HP',
  'drinks',
  0,
  50,
  'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800&q=80',
  'Smart casual',
  true, false
),

-- Event 28: Halloween at Cubanista VIP Lounge — Oct 2025
(
  'e1000000-0000-0000-0000-000000000028',
  'halloween-cubanista-vip-lounge-oct-2025',
  'Halloween at Cubanista VIP Lounge',
  'Cubanista''s VIP Lounge at Kensington High Street operates at the better end of the London nightclub spectrum — a venue with actual production values, a sound system worth the volume, and a dress code enforced with the consistency that tells you the management takes the room''s quality seriously. On Halloween, with a playlist moving through house to hip hop to R&B, it becomes something the city does well precisely once a year.

The dress code instructions were specific: ladies smart/chic, gents trousers or dark jeans with a collared shirt or blazer, shoes or smart sneakers only — no trainers. This is a venue where these instructions exist for a reason, and the Social Seen group, predictably, interpreted them with the range of literalism and creativity that Halloween always produces. The results were photographed extensively.

The music did what good DJs do at this kind of event: started at a tempo that let people arrive and find their bearings, then moved through the gears over the course of the evening in a way that made leaving before midnight feel genuinely difficult. Several members did not leave before midnight.',
  'Halloween at Cubanista, Kensington High Street — house, hip hop, R&B, and a dress code that means it. VIP lounge, gallery nightclub, costumes encouraged and taken seriously.',
  '2025-10-31 21:00:00+00',
  '2025-11-01 02:00:00+00',
  'Cubanista',
  '2a Kensington High Street, London W8 4PT',
  'music',
  2500,
  60,
  'https://images.unsplash.com/photo-1508361727343-ca787442dcd7?w=800&q=80',
  'Ladies: smart/chic. Gents: dark trousers or jeans, collared shirt or blazer. Smart shoes only — no trainers.',
  true, false
),

-- Event 29: Charity Fundraiser for Mental Health, 80s/90s Night — Nov 2025
(
  'e1000000-0000-0000-0000-000000000029',
  'charity-fundraiser-mental-health-80s-90s-nov-2025',
  'Charity Fundraiser for Mental Health, 80s/90s Night',
  'The 80s/90s music format has a specific social function that newer music cannot replicate at an event like this: familiarity. When everyone in the room knows the words, knows the chorus, remembers where they were, the floor opens up in a way that takes most evenings considerably longer to achieve. The Social Seen''s charity night leveraged this deliberately — the cause gives the evening meaning, the music gives it momentum.

The mental health focus was chosen with the community in mind. These are professionals in their thirties and forties who navigate the particular pressures of that demographic — career peaks, relocation, relationship transitions, the ambient noise of a high-functioning life. Raising money for organisations that help people navigate this with better support felt, by the group''s account, like the right use of an evening.

The dancing was vigorous. The donations were generous. Several attendees mentioned afterwards that they''d expected to stay for an hour and left at closing. The 80s and 90s, it turns out, are a reliable technology for extending any evening that isn''t already working. This one was.',
  'An evening of 80s and 90s music with intent — raising money for mental health, dancing to songs everyone knows, and proving that a fundraiser can be the best party of the month.',
  '2025-11-07 20:00:00+00',
  '2025-11-08 00:00:00+00',
  'XOYO',
  '32-37 Cowper Street, London EC2A 4AP',
  'music',
  2500,
  80,
  'https://images.unsplash.com/photo-1501386761578-eee929a30db4?w=800&q=80',
  NULL,
  true, false
),

-- Event 30: Winter Wonderland Group Outing — Nov 2025
(
  'e1000000-0000-0000-0000-000000000030',
  'winter-wonderland-group-outing-nov-2025',
  'Winter Wonderland Group Outing',
  'Hyde Park Winter Wonderland exists at the intersection of kitsch and genuine pleasure, and the most interesting question it poses is not whether it''s any good — it is — but whether you allow yourself to enjoy it without qualification. The Social Seen''s group outing proceeded on the assumption that the qualification is the obstacle: the market, the ice rink, the bratwurst, the mulled wine that costs exactly what you expect and tastes exactly as good as the cold air demands, all deserve their moment.

The group spread across the site in the natural way of any occasion that contains multiple points of interest simultaneously — the ice rink spectators, the Bavarian bar occupants, the carousel riders, the people who''d got into the queue for the big wheel and were now committed — reconverging periodically and comparing notes on what they''d found.

Sunday evening in November has a specific London texture: the city quiet enough to give an event space to breathe, the darkness arrived early enough to make the lights dramatic rather than supplementary. Winter Wonderland on a Sunday evening, with people you know, hot drink in hand, is a version of London''s seasonal pleasures that requires no apology and no ironic distance. It''s very good. Go every year.',
  'Hyde Park''s Winter Wonderland — the Social Seen''s annual concession to the city''s most beloved seasonal spectacle. Mulled wine, excessive lights, and the quiet pleasure of doing tourist things properly.',
  '2025-11-23 16:00:00+00',
  '2025-11-23 21:00:00+00',
  'Hyde Park Winter Wonderland',
  'Hyde Park, London W2 2UH',
  'cultural',
  0,
  50,
  'https://images.unsplash.com/photo-1545239351-ef35f43d514b?w=800&q=80',
  NULL,
  true, false
),

-- ── Future Events (31–33) ────────────────────────────────────────────────────

-- Event 31: Spring Social at Gambit Bar — Apr 2026 (FUTURE)
(
  'e1000000-0000-0000-0000-000000000031',
  'spring-social-gambit-bar-mar-2026',
  'Spring Social at Gambit Bar',
  'Gambit Bar takes its chess theme with the right amount of commitment — enough to give the space a distinctive identity without allowing the concept to overwhelm the drinks or the atmosphere. The interiors are warm and considered: board game references woven into the decor at a frequency that rewards attention without demanding it. The cocktail menu, appropriately, rewards patience and deliberate choices over impulse.

March in London is the month that changes everything — the first evenings where remaining outdoors after 6pm becomes genuinely appealing, the first suggestion that the year is moving in the right direction. The Social Seen''s spring opener catches that energy deliberately: a gathering of old members returning after a quieter winter and new faces finding their first event.

The bar suits The Social Seen''s register well — smart but not formal, interesting but not performative, the kind of venue that inspires the conversations it deserves. This is the right place to begin the year''s second half.',
  'Gambit Bar for the first social of spring. Chess-themed interiors, considered cocktails, and the particular pleasure of a spring evening that suggests summer is a serious possibility.',
  '2026-04-18 18:30:00+00',
  '2026-04-18 22:30:00+00',
  'Gambit Bar',
  '21 Bateman Street, Soho, London W1D 3AL',
  'drinks',
  0,
  40,
  'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=800&q=80',
  NULL,
  true, false
),

-- Event 32: An Evening at The Knox, Sloane Square — May 2026 (FUTURE)
(
  'e1000000-0000-0000-0000-000000000032',
  'evening-knox-sloane-square-apr-2026',
  'An Evening at The Knox, Sloane Square',
  'The Knox on Sloane Square operates in the register that London''s better late-night venues have refined: a space that begins as a restaurant or bar and transitions, over the course of an evening, into something with a dancefloor and intent. The transition is the point — it allows an evening to move through gears rather than committing to a single mode, which suits a group that wants both conversation and movement.

The format is designed for introductions: tables arranged for meeting people, the early part of the evening structured loosely enough that conversation circulates. DJ Swerve takes over as the evening progresses, and the floor that emerged from a dinner table is already warmed up in a way that a standing club never quite achieves from a cold start.

Sloane Square in April — the neighbourhood at its most confident, the King''s Road crowd in their considered spring wardrobes — provides the backdrop. The Knox provides the room. The Social Seen provides the people. These three elements, aligned on an April Friday, should produce an excellent evening.',
  'Meet new people at The Knox''s tables, then let DJ Swerve take the evening somewhere else. Sloane Square at its most relaxed — dinner-into-dancing done properly.',
  '2026-05-02 19:00:00+00',
  '2026-05-02 23:30:00+00',
  'The Knox',
  '25 Sloane Square, London SW1W 8AX',
  'dining',
  0,
  50,
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
  'Smart casual',
  true, false
),

-- Event 33: Summer Party, Upstairs at Langan's — Jun 2026 (FUTURE)
(
  'e1000000-0000-0000-0000-000000000033',
  'summer-party-upstairs-langans-jun-2026',
  'Summer Party, Upstairs at Langan''s',
  'Langan''s Brasserie is a name that carries weight in Mayfair''s dining landscape — a restaurant with a history that runs through decades of London''s cultural and social life, a room that has seen enough to carry the authority of accumulated occasion. Upstairs has a distinct character from the main floor: intimate in the way that a room above a famous restaurant should be, with the view of the street below and the feeling that you are in a place with stories rather than a place designed to generate them.

The Social Seen''s summer party here marks a moment of ambition matched to occasion. June in Mayfair — the year''s social calendar at its peak, the evenings longest, the city at its best-dressed — provides the context; Langan''s provides the room; the group provides the reason.

Expect the kitchen to deliver what the address has always promised. Expect the bar to take the evening seriously. Expect, above all, a room full of people who have spent a year or more building something worth celebrating — the kind of crowd that knows what it wants from an evening in London and has, through The Social Seen, found consistently good answers to that question.',
  'Upstairs at Langan''s, Mayfair — the Social Seen''s summer party in one of London''s great rooms. June in W1, properly dressed, properly fed, properly celebrated.',
  '2026-06-20 18:30:00+00',
  '2026-06-20 23:30:00+00',
  'Upstairs at Langan''s',
  '1 Stratton Street, Mayfair, London W1J 8LB',
  'dining',
  8500,
  60,
  'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800&q=80',
  'Smart casual',
  true, false
);

-- ── Step 5: Bookings ─────────────────────────────────────────────────────────
-- Confirmed bookings for past events (1–30) only.
-- No bookings for future events (31–33).
-- booked_at timestamps are set days/weeks before each event's date_time.
-- Price snapshots match the event price at time of booking.

INSERT INTO public.bookings (user_id, event_id, status, waitlist_position, price_at_booking, booked_at) VALUES

  -- ── Event 01: Fairgame and Pizza, Canary Wharf — 2024-01-19 ──────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'confirmed', NULL, 0, '2024-01-05 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'confirmed', NULL, 0, '2024-01-06 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'confirmed', NULL, 0, '2024-01-08 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'confirmed', NULL, 0, '2024-01-10 14:00:00+00'),

  -- ── Event 02: Cocktails and Pizza, London Cocktail Club — 2024-02-09 ──────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'confirmed', NULL, 0, '2024-01-25 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'confirmed', NULL, 0, '2024-01-28 11:30:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 'confirmed', NULL, 0, '2024-01-30 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000002', 'confirmed', NULL, 0, '2024-02-01 13:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000002', 'confirmed', NULL, 0, '2024-02-03 15:00:00+00'),

  -- ── Event 03: Axe Throwing and Drinks, Soho — 2024-03-08 ─────────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003', 'confirmed', NULL, 2500, '2024-02-20 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 'confirmed', NULL, 2500, '2024-02-22 12:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000003', 'confirmed', NULL, 2500, '2024-02-24 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000003', 'confirmed', NULL, 2500, '2024-02-26 14:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000003', 'confirmed', NULL, 2500, '2024-02-28 16:00:00+00'),

  -- ── Event 04: Drinks at Stereo Bar, Covent Garden — 2024-04-12 ───────────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000004', 'confirmed', NULL, 0, '2024-03-25 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000004', 'confirmed', NULL, 0, '2024-03-26 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000004', 'confirmed', NULL, 0, '2024-03-28 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004', 'confirmed', NULL, 0, '2024-03-29 13:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000004', 'confirmed', NULL, 0, '2024-04-01 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000004', 'confirmed', NULL, 0, '2024-04-02 14:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000004', 'confirmed', NULL, 0, '2024-04-03 11:30:00+00'),

  -- ── Event 05: LSQ Rooftop Bar, Leicester Square — 2024-05-17 ─────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000005', 'confirmed', NULL, 0, '2024-05-01 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000005', 'confirmed', NULL, 0, '2024-05-03 12:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000005', 'confirmed', NULL, 0, '2024-05-05 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000005', 'confirmed', NULL, 0, '2024-05-08 13:00:00+00'),

  -- ── Event 06: Drinks at Luna Gin Bar — 2024-08-08 ─────────────────────────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000006', 'confirmed', NULL, 0, '2024-07-20 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000006', 'confirmed', NULL, 0, '2024-07-22 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000006', 'confirmed', NULL, 0, '2024-07-24 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000006', 'confirmed', NULL, 0, '2024-07-25 14:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000006', 'confirmed', NULL, 0, '2024-07-28 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000006', 'confirmed', NULL, 0, '2024-07-30 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000006', 'confirmed', NULL, 0, '2024-08-01 12:00:00+00'),

  -- ── Event 07: Flight Club and Little Scarlett Door — 2024-09-13 ──────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000007', 'confirmed', NULL, 2000, '2024-08-28 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000007', 'confirmed', NULL, 2000, '2024-08-30 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000007', 'confirmed', NULL, 2000, '2024-09-01 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000007', 'confirmed', NULL, 2000, '2024-09-03 14:00:00+00'),

  -- ── Event 08: Weekend in the Cotswolds — 2024-10-04 ──────────────────────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000008', 'confirmed', NULL, 25000, '2024-09-15 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000008', 'confirmed', NULL, 25000, '2024-09-17 10:30:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000008', 'confirmed', NULL, 25000, '2024-09-19 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000008', 'confirmed', NULL, 25000, '2024-09-21 14:00:00+00'),

  -- ── Event 09: Drinks at Amiga Bar and Archers Street, Clapham — 2024-10-18
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000009', 'confirmed', NULL, 0, '2024-10-02 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000009', 'confirmed', NULL, 0, '2024-10-04 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000009', 'confirmed', NULL, 0, '2024-10-06 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000009', 'confirmed', NULL, 0, '2024-10-08 13:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000009', 'confirmed', NULL, 0, '2024-10-10 15:00:00+00'),

  -- ── Event 10: Hiking in Snowdonia — 2024-10-25 ───────────────────────────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000010', 'confirmed', NULL, 15000, '2024-10-05 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000010', 'confirmed', NULL, 15000, '2024-10-07 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000010', 'confirmed', NULL, 15000, '2024-10-09 11:30:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000010', 'confirmed', NULL, 15000, '2024-10-12 14:00:00+00'),

  -- ── Event 11: Black Tie Evening, Pall Mall — 2024-11-08 ──────────────────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000011', 'confirmed', NULL, 12500, '2024-10-20 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000011', 'confirmed', NULL, 12500, '2024-10-22 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000011', 'confirmed', NULL, 12500, '2024-10-24 11:30:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000011', 'confirmed', NULL, 12500, '2024-10-26 14:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000011', 'confirmed', NULL, 12500, '2024-10-28 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000011', 'confirmed', NULL, 12500, '2024-10-30 13:00:00+00'),

  -- ── Event 12: Fireworks Night, Totteridge Cricket Club — 2024-11-05 ───────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000012', 'confirmed', NULL, 1000, '2024-10-18 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000012', 'confirmed', NULL, 1000, '2024-10-20 10:30:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000012', 'confirmed', NULL, 1000, '2024-10-22 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000012', 'confirmed', NULL, 1000, '2024-10-24 14:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000012', 'confirmed', NULL, 1000, '2024-10-26 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000012', 'confirmed', NULL, 1000, '2024-10-28 12:00:00+00'),

  -- ── Event 13: Comedy and Dinner in Angel — 2024-11-17 ────────────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000013', 'confirmed', NULL, 2000, '2024-11-01 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000013', 'confirmed', NULL, 2000, '2024-11-03 11:30:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000013', 'confirmed', NULL, 2000, '2024-11-05 09:00:00+00'),

  -- ── Event 14: Tate Late — 2024-11-22 ─────────────────────────────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000014', 'confirmed', NULL, 0, '2024-11-05 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000014', 'confirmed', NULL, 0, '2024-11-07 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000014', 'confirmed', NULL, 0, '2024-11-09 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000014', 'confirmed', NULL, 0, '2024-11-11 13:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000014', 'confirmed', NULL, 0, '2024-11-13 15:00:00+00'),

  -- ── Event 15: Christmas Party at Tonteria, Sloane Square — 2024-12-12 ─────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000015', 'confirmed', NULL, 3500, '2024-11-20 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000015', 'confirmed', NULL, 3500, '2024-11-22 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000015', 'confirmed', NULL, 3500, '2024-11-24 11:30:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000015', 'confirmed', NULL, 3500, '2024-11-26 14:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000015', 'confirmed', NULL, 3500, '2024-11-28 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000015', 'confirmed', NULL, 3500, '2024-11-30 13:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000015', 'confirmed', NULL, 3500, '2024-12-02 11:00:00+00'),

  -- ── Event 16: Christmas Eve Volunteering with Crisis — 2024-12-24 ─────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000016', 'confirmed', NULL, 0, '2024-12-01 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000016', 'confirmed', NULL, 0, '2024-12-03 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000016', 'confirmed', NULL, 0, '2024-12-05 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000016', 'confirmed', NULL, 0, '2024-12-08 13:00:00+00'),

  -- ── Event 17: Dim Sum for Chinese New Year, Leong's Legends — 2025-01-29 ──
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000017', 'confirmed', NULL, 2500, '2025-01-10 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000017', 'confirmed', NULL, 2500, '2025-01-12 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000017', 'confirmed', NULL, 2500, '2025-01-14 11:30:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000017', 'confirmed', NULL, 2500, '2025-01-16 14:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000017', 'confirmed', NULL, 2500, '2025-01-18 09:30:00+00'),

  -- ── Event 18: Valentine's Singles Evening — 2025-02-14 ────────────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000018', 'confirmed', NULL, 0, '2025-01-28 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000018', 'confirmed', NULL, 0, '2025-01-30 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000018', 'confirmed', NULL, 0, '2025-02-01 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000018', 'confirmed', NULL, 0, '2025-02-03 13:00:00+00'),

  -- ── Event 19: Meet Over Pizza at Breadstall — 2025-02-27 ──────────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000019', 'confirmed', NULL, 2000, '2025-02-10 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000019', 'confirmed', NULL, 2000, '2025-02-12 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000019', 'confirmed', NULL, 2000, '2025-02-14 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000019', 'confirmed', NULL, 2000, '2025-02-16 13:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000019', 'confirmed', NULL, 2000, '2025-02-18 15:00:00+00'),

  -- ── Event 20: Skiing in St Moritz at ClubMed — 2025-02-08 ────────────────
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000020', 'confirmed', NULL, 150000, '2025-01-05 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000020', 'confirmed', NULL, 150000, '2025-01-08 10:30:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000020', 'confirmed', NULL, 150000, '2025-01-10 11:00:00+00'),

  -- ── Event 21: Oliver Heldens at O2 Brixton Academy — 2025-03-14 ──────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000021', 'confirmed', NULL, 3000, '2025-02-25 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000021', 'confirmed', NULL, 3000, '2025-02-27 11:30:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000021', 'confirmed', NULL, 3000, '2025-03-01 09:00:00+00'),

  -- ── Event 22: Mini Golf and Drinks in the City — 2025-04-11 ──────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000022', 'confirmed', NULL, 1500, '2025-03-26 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000022', 'confirmed', NULL, 1500, '2025-03-28 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000022', 'confirmed', NULL, 1500, '2025-03-30 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000022', 'confirmed', NULL, 1500, '2025-04-01 13:00:00+00'),

  -- ── Event 23: Queen of Wands Recital at Union Theatre — 2025-05-06 ────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000023', 'confirmed', NULL, 2000, '2025-04-18 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000023', 'confirmed', NULL, 2000, '2025-04-21 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000023', 'confirmed', NULL, 2000, '2025-04-24 09:30:00+00'),

  -- ── Event 24: Hiking in the Lake District — 2025-05-23 ────────────────────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000024', 'confirmed', NULL, 20000, '2025-05-01 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000024', 'confirmed', NULL, 20000, '2025-05-04 10:30:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000024', 'confirmed', NULL, 20000, '2025-05-07 11:00:00+00'),

  -- ── Event 25: Polo in the Park — 2025-06-07 ──────────────────────────────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000025', 'confirmed', NULL, 5500, '2025-05-18 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000025', 'confirmed', NULL, 5500, '2025-05-20 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000025', 'confirmed', NULL, 5500, '2025-05-22 11:30:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000025', 'confirmed', NULL, 5500, '2025-05-24 14:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000025', 'confirmed', NULL, 5500, '2025-05-26 09:30:00+00'),

  -- ── Event 26: Picnic in Regent's Park — 2025-06-21 ───────────────────────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000026', 'confirmed', NULL, 0, '2025-06-01 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000026', 'confirmed', NULL, 0, '2025-06-03 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000026', 'confirmed', NULL, 0, '2025-06-05 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000026', 'confirmed', NULL, 0, '2025-06-07 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000026', 'confirmed', NULL, 0, '2025-06-09 13:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000026', 'confirmed', NULL, 0, '2025-06-11 10:30:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000026', 'confirmed', NULL, 0, '2025-06-13 12:00:00+00'),

  -- ── Event 27: End of Summer Party at Paloma, South Kensington — 2025-09-19
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000027', 'confirmed', NULL, 0, '2025-09-02 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000027', 'confirmed', NULL, 0, '2025-09-04 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000027', 'confirmed', NULL, 0, '2025-09-06 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000027', 'confirmed', NULL, 0, '2025-09-08 13:00:00+00'),

  -- ── Event 28: Halloween at Cubanista VIP Lounge — 2025-10-31 ─────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000028', 'confirmed', NULL, 2500, '2025-10-10 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000028', 'confirmed', NULL, 2500, '2025-10-13 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000028', 'confirmed', NULL, 2500, '2025-10-15 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000028', 'confirmed', NULL, 2500, '2025-10-17 13:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000028', 'confirmed', NULL, 2500, '2025-10-19 15:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000028', 'confirmed', NULL, 2500, '2025-10-21 11:00:00+00'),

  -- ── Event 29: Charity Fundraiser, 80s/90s Night — 2025-11-07 ─────────────
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000029', 'confirmed', NULL, 2500, '2025-10-18 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000029', 'confirmed', NULL, 2500, '2025-10-20 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000029', 'confirmed', NULL, 2500, '2025-10-22 11:30:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000029', 'confirmed', NULL, 2500, '2025-10-24 14:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000029', 'confirmed', NULL, 2500, '2025-10-26 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000029', 'confirmed', NULL, 2500, '2025-10-28 13:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000029', 'confirmed', NULL, 2500, '2025-10-30 11:00:00+00'),

  -- ── Event 30: Winter Wonderland Group Outing — 2025-11-23 ────────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000030', 'confirmed', NULL, 0, '2025-11-05 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000030', 'confirmed', NULL, 0, '2025-11-07 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000030', 'confirmed', NULL, 0, '2025-11-09 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000030', 'confirmed', NULL, 0, '2025-11-11 13:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000030', 'confirmed', NULL, 0, '2025-11-13 15:00:00+00');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 7: Event Reviews
-- Only includes reviewers who have a confirmed booking for that event (Step 5).
-- Exact review text and star ratings from prompts/seed-content-events-reviews-photos.md PART 2.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.event_reviews (user_id, event_id, rating, review_text, is_visible, created_at) VALUES

  -- Event 1 (Fairgame, Jan 2024): Charlotte✓ James✓ Priya✓
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 5, 'Such a fun first event — the gaming bar format broke the ice immediately. Was talking to strangers within ten minutes of arriving, which never happens. Left with three new contacts and sore arms from the skeeball.', true, '2024-01-21 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 4, 'Good start to the year. Fairgame is a bit louder than I''d usually choose but it forces conversation rather than allowing people to stand politely and say nothing. The pizza afterwards was exactly what the evening needed.', true, '2024-01-21 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 5, 'Didn''t know what to expect from my first Social Seen event. Left thinking I should have joined months earlier. The group size was perfect — small enough to actually meet everyone.', true, '2024-01-22 09:00:00+00'),

  -- Event 2 (London Cocktail Club, Feb 2024): Sophie✓ Marcus✓ — Oliver NOT booked → skip
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000002', 5, 'The smoke-dome cocktails were genuinely impressive. Good mix of people — a few familiar faces from the WhatsApp group, lots of new ones. The pizza at the end was the right call: keeps everyone together a bit longer.', true, '2024-02-11 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000002', 4, 'Solid evening in Covent Garden. The venue did the heavy lifting atmospherically. Would have liked slightly more structure for introductions but the crowd was warm and easy to talk to.', true, '2024-02-11 11:30:00+00'),

  -- Event 3 (Axe Throwing, Mar 2024): Charlotte✓ James✓ — Mitesh NOT booked → skip
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000003', 4, 'More competitive than I expected, in the best possible way. The group was 45 which felt a bit big for the space, but the activity kept it manageable. The Soho pub afterwards made the evening.', true, '2024-03-10 09:30:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 5, 'This is the format that works — activity followed by drinks. The activity gives you something to talk about immediately, removes the awkward standing-around phase, and then the pub feels earned. Would do this again.', true, '2024-03-10 11:00:00+00'),

  -- Event 4 (Stereo Bar, Apr 2024): Priya✓ Oliver✓ Sophie✓
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000004', 4, 'Stereo Bar was a great choice for the bigger crowd. Multiple levels meant you could find your group or circulate as preferred. 70 people could have felt overwhelming but it didn''t — the space held it well.', true, '2024-04-21 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000004', 5, 'Best turnout yet. Ran into someone I''d met at the Covent Garden cocktails event back in February and we spent the evening catching up. That''s what I keep coming back for — the continuity between events.', true, '2024-04-21 10:30:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000004', 4, 'Larger event but it retained the Social Seen quality. The bar''s sound levels were pitched right for conversation. Will say that arrival times varied quite a lot — those who came early had a different experience from those who came at 9pm.', true, '2024-04-22 08:00:00+00'),

  -- Event 5 (Rooftop Drinks, May 2024): Charlotte✓ — Marcus NOT booked, Mitesh NOT booked → skip
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000005', 4, 'LSQ is the kind of venue that makes London feel like the city you moved here for. Drinks were well-made and the crowd had good energy. Slightly pricey but worth it for the setting.', true, '2024-05-12 10:00:00+00'),

  -- Event 6 (Summer Drinks, Aug 2024): James✓ Priya✓ Oliver✓
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000006', 5, 'Luna Gin Bar took its subject seriously and the crowd matched it. 75 people across a summer Thursday — the bar handled the volume without feeling rushed. The botanical gins were genuinely interesting if you leaned into the conversation with the bar staff.', true, '2024-08-10 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000006', 4, 'Perfect summer evening. The crowd felt settled and warm in a way that the earlier events hadn''t quite — more familiar faces, more ease. The gin selections were excellent.', true, '2024-08-10 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000006', 4, 'The format of the bar suited a large, loose gathering. Good to see so many regulars as well as people I hadn''t met before. The August timing was well judged — city still full, everyone in a better mood.', true, '2024-08-11 09:30:00+00'),

  -- Event 7 (Flight Club, Sep 2024): Charlotte✓ — Sophie NOT booked, Marcus NOT booked → skip
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000007', 5, 'Had never been to Flight Club before. The scoring system meant no individual could carry the team which kept it genuinely social. The Scarlett Door drinks were outstanding — that cocktail list deserves more attention.', true, '2024-09-29 10:00:00+00'),

  -- Event 8 (Cotswolds Weekend, Oct 2024): Mitesh✓ James✓ — Priya NOT booked → skip
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000008', 5, 'The Cotswolds weekend was a completely different proposition from the London events. 20 people in a country house over two days — by Sunday morning everyone felt like old friends. This is what the community can become at its best.', true, '2024-10-15 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000008', 5, 'The walks were excellent, the house was beautiful, and the dinners were long in exactly the right way. I arrived knowing three people and left with a dozen proper friendships. Would do a repeat in a different season.', true, '2024-10-15 12:00:00+00'),

  -- Event 9 (Clapham Crawl, Oct 2024): Sophie✓ Marcus✓ — Oliver NOT booked → skip
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000009', 3, 'The evening was fun but the two-venue split meant the group fractured a bit — some people stayed at Amiga, others moved to Archers Street, and it felt like two separate events by the end. Would prefer a single venue next time.', true, '2024-10-27 09:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000009', 4, 'Clapham does unpretentious very well and both bars delivered that. Good crowd, easy atmosphere. The south London contingent seemed particularly happy to have the community come to them.', true, '2024-10-27 10:30:00+00'),

  -- Event 10 (Snowdonia Hike, Oct 2024): James✓ — Charlotte NOT booked, Priya NOT booked → skip
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000010', 5, 'Hiking trips are the best format the group does. You can''t be polished on a mountain in October. By the second day everyone was completely themselves and the conversations reflected that. The summit photograph is still on my phone.', true, '2024-10-22 14:00:00+00'),

  -- Event 11 (Black Tie Gala, Dec 2024): Mitesh✓ Oliver✓ Sophie✓
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000011', 5, 'The black tie evening in Pall Mall was everything the format promises. The room earned the dress code — you arrive and immediately understand why the invitation required it. The contrast with the year''s other events was the point.', true, '2024-12-08 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000011', 5, 'This is the Social Seen''s range on display: from axe throwing in Soho to black tie on Pall Mall. Both excellent for entirely different reasons. The evening itself was beautifully managed and the group rose to the occasion.', true, '2024-12-08 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000011', 4, 'Gorgeous venue and the group looked wonderful. The evening had a slightly formal tone initially — getting 40-odd people into a room like that takes a moment to loosen — but by the second hour it was fully the community we know.', true, '2024-12-09 09:00:00+00'),

  -- Event 12 (Bonfire Night, Nov 2024): Marcus✓ Charlotte✓ — James NOT booked → skip
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000012', 5, 'Totteridge Cricket Club is a genuinely special setting for bonfire night. The fire was proper, the fireworks well-timed, and the mulled wine arrived at exactly the right temperature. A proper communal occasion.', true, '2024-11-07 20:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000012', 4, 'A lovely alternative to the big municipal fireworks events. Felt like a village bonfire night rather than a city event, which was exactly the right call. The setting — cricket club, north London fields — was unexpectedly perfect.', true, '2024-11-08 09:00:00+00'),

  -- Event 13 (Comedy Night, Nov 2024): Priya✓ — Oliver NOT booked, Sophie NOT booked → skip
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000013', 5, 'Ten people, a good comedy show, and a long dinner afterwards. This is the Social Seen format that produces actual friendships rather than acquaintances. I know everyone who was at that table. I don''t know everyone who was at the 70-person Covent Garden drinks.', true, '2024-11-19 10:00:00+00'),

  -- Event 14 (Tate Late, Jan 2025): Marcus✓ Charlotte✓ — Mitesh NOT booked → skip
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000014', 5, 'Tate Late is the format that deserves more evenings. The gallery at night is a completely different experience from the daytime crowds. The Turbine Hall installation that month was extraordinary. The top floor bar made the whole thing feel like the right way to spend a Friday.', true, '2025-01-12 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000014', 5, 'Tate Modern at night with good company is a perfect evening. The Seagram Murals room in that light is something I''ll think about for a long time. The bar afterwards helped the conversation continue what the art had started.', true, '2025-01-12 11:30:00+00'),

  -- Event 15 (Christmas Party, Dec 2024): James✓ Priya✓ Oliver✓
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000015', 5, 'The Christmas party was everything it needed to be. 100 people in Tonteria''s basement — it should have felt overwhelming and instead felt like a celebration of everything the year had built. The tequila and dancing were excellent. The company was better.', true, '2024-12-22 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000015', 5, 'The year''s punctuation mark, as described. Seeing 100 people in that room who''d all met through this community over twelve months was genuinely moving. The Christmas party delivered on every level — atmosphere, music, crowd.', true, '2024-12-22 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000015', 4, 'Tonteria works for a big group. The transition from dinner to dancefloor is seamless and the crowd was brilliant. My only note is that the King''s Road location made getting home a slight adventure. Worth it.', true, '2024-12-23 09:00:00+00'),

  -- Event 16 (Crisis Volunteering, Dec 2024): Sophie✓ Marcus✓ Charlotte✓
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000016', 5, 'The volunteering with Crisis was the event I almost didn''t come to and ended up being the most meaningful one of the year. The work was purposeful, the organisation of it was excellent, and I came home feeling different from how I''d left.', true, '2024-12-26 15:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000016', 5, 'This is what the community can do beyond providing excellent evenings out. The Christmas Eve shift at Crisis was real work with real impact. I''ve gone back independently. Would encourage everyone to put this on their list.', true, '2024-12-26 16:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000016', 4, 'Different from every other Social Seen event in the best way. Less about who you meet and more about what you do together. The quieter moments of the shift — just talking to someone who needed it — stayed with me.', true, '2024-12-27 10:00:00+00'),

  -- Event 17 (Chinese New Year Dim Sum, Feb 2025): Mitesh✓ James✓ Priya✓
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000017', 5, 'Leong''s Legends is the right choice for this — proper dim sum, not the version for tourists, with trolleys and noise and the full Chinatown New Year atmosphere outside. 50 people at long tables with a rotating cast of dishes is exactly the right format.', true, '2025-02-03 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000017', 4, 'Chinese New Year at Leong''s was a brilliant event. The har gow alone was worth the journey. The street celebrations between the restaurant windows and the fireworks gave the evening a genuinely festive quality.', true, '2025-02-03 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000017', 5, 'The communal table format for dim sum is perfect for this group. Dishes arrive and get shared before anyone reads the menu, which forces the kind of interaction that a plated restaurant doesn''t. The New Year atmosphere in Chinatown added everything.', true, '2025-02-04 09:00:00+00'),

  -- Event 18 (Valentine's Social, Feb 2025): Sophie✓ Charlotte✓ — Oliver NOT booked → skip
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000018', 5, 'As someone who''s attended ''singles events'' that made me want to leave within twenty minutes, this was a genuine revelation. The Social Seen format — self-selecting community, no pressure, good venue — means the evening earns itself without machinery.', true, '2025-02-16 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000018', 4, 'Fun evening. The 30-person size was ideal for an event like this — large enough for real choice, small enough to meet most people. The venue was well-chosen. I left with new friends, which is ultimately the point.', true, '2025-02-16 11:30:00+00'),

  -- Event 19 (Pizza Social, Feb 2025): Marcus✓ James✓ — Mitesh NOT booked → skip
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000019', 5, 'Breadstall''s Roman-style pizza is excellent — the crust has the right texture, the toppings are restrained in the correct Italian way, and the combination of slices means you try everything without committing. The group was settled and easy, a proper February evening.', true, '2025-02-24 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000019', 5, 'The February pizza evening was warmer than it had any right to be, given the month. Breadstall is the kind of place you wish you''d known about for years. The group had a settled, comfortable quality by this point in the year — familiar faces making introductions without prompting.', true, '2025-02-24 11:30:00+00'),

  -- Event 20 (Ski Trip St Moritz, Mar 2025): Oliver✓ — Priya NOT booked, Charlotte NOT booked → skip
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000020', 4, 'Excellent week. The group''s ability levels spread nicely across the mountain, which meant mornings had natural flexibility. The evenings at dinner were long and warm. ClubMed as a format works very well for a group.', true, '2025-03-08 14:00:00+00'),

  -- Event 21 (Club Night Brixton, Mar 2025): Sophie✓ Marcus✓ — James NOT booked → skip
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000021', 5, 'Brixton Academy for Oliver Heldens was one of the best nights of the year. The venue has a quality that newer clubs can''t manufacture — the rake of the floor, the low ceiling, the way the bass sits in the room. The group all ended up on the floor together by the second hour.', true, '2025-03-16 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000021', 4, 'I''d never heard of Oliver Heldens before this event. I have since listened to most of his catalogue. The Social Seen as a music discovery mechanism is underrated. The Academy is one of London''s great venues.', true, '2025-03-16 12:00:00+00'),

  -- Event 22 (Mini Golf City, Apr 2025): Charlotte✓ — Mitesh NOT booked, Priya NOT booked → skip
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000022', 5, 'Brilliant midweek event. The £30 combined option was good value. The City setting — surrounded by emptying office buildings on a spring evening — had a pleasantly transgressive quality, like claiming those streets back.', true, '2025-04-10 10:00:00+00'),

  -- Event 23 (Theatre Night, Apr 2025): Sophie✓ — Oliver NOT booked, Marcus NOT booked → skip
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000023', 4, 'Queen of Wands was unexpectedly moving. The South Bank railway arch setting adds to the intimacy — you''re completely present in a way that seated theatres don''t always achieve. The group was small enough for a real conversation about what we''d seen afterwards.', true, '2025-04-22 10:00:00+00'),

  -- Event 24 (Lake District Hike, May 2025): James✓ — Charlotte NOT booked, Priya NOT booked → skip
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000024', 5, 'The Lake District exceeded expectations on every axis. Helvellyn via Striding Edge is as good as its reputation — the ridge walk is exhilarating even for those of us who''d describe ourselves as occasional hikers. The group''s second hiking trip and better in some ways than the first.', true, '2025-05-04 14:00:00+00'),

  -- Event 25 (Polo in the Park, Jun 2025): Mitesh✓ Oliver✓ Sophie✓
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000025', 5, 'Polo in the Park was the summer event I hadn''t known I needed. The sport is compelling once you''ve been told what to look for, and the half-time divot-treading was an inspired bit of crowd participation. Smart casual dress, sunshine, and a picnic — the right combination.', true, '2025-06-07 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000025', 4, 'A different kind of Social Seen afternoon — more spectator, more occasion, more summer-season. The polo itself was well-explained by the group''s more knowledgeable members and became genuinely tense in the final chukka. The social element was excellent.', true, '2025-06-07 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000025', 5, 'Polo in June is one of London''s underrated pleasures. The grounds are beautiful, the atmosphere is festive without being excessive, and the divot-treading at half-time is genuinely charming. The Social Seen group was excellent company for all of it.', true, '2025-06-08 09:00:00+00'),

  -- Event 26 (Regent's Park Picnic, Jun 2025): Marcus✓ Charlotte✓ James✓
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000026', 5, 'The Regent''s Park picnic was the event of the year. 80 people on a June Saturday with a bring-something-to-share instruction produced a communal spread I couldn''t have imagined. The afternoon stretched until the park closed. This is what this community is capable of.', true, '2025-06-22 18:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000026', 5, 'The biggest Social Seen event I''d attended and somehow one of the most intimate-feeling. The blankets-and-sharing format meant you naturally ended up in smaller conversations within the larger gathering. The June light in Regent''s Park was extraordinary.', true, '2025-06-22 19:00:00+00'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000026', 5, 'Everything about this worked. The scale, the park, the format, the crowd. Stayed until the last warning to leave. The Social Seen has produced a lot of excellent evenings but this was the event that made the whole community feel real.', true, '2025-06-23 09:00:00+00'),

  -- Event 27 (End of Summer, Sep 2025): Priya✓ Sophie✓ — Oliver NOT booked → skip
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000027', 5, 'Paloma is a beautiful bar and the end-of-summer framing was exactly right. September gatherings with this group have a particular warmth — familiar faces concentrated, everyone present, the year''s community at its most felt.', true, '2025-09-08 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000027', 5, 'The end-of-summer party delivered everything it promised. Paloma held the group well — intimate enough for conversation, lively enough for atmosphere. The cocktails were among the best I''ve had at any Social Seen event.', true, '2025-09-08 11:00:00+00'),

  -- Event 28 (Halloween Party, Oct 2025): Marcus✓ Charlotte✓ — Mitesh NOT booked → skip
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000028', 5, 'Cubanista''s Halloween night was one of the year''s best evenings. The dress code was enforced which meant the room looked great and people had made an effort. The music — house into hip hop into R&B — was excellently programmed.', true, '2025-10-26 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000028', 4, 'Great Halloween night. The music and the venue were both excellent. The dress code is the right call — it elevates the room. My only note is that the VIP lounge got very busy by midnight which affected the dancefloor quality slightly.', true, '2025-10-26 11:30:00+00'),

  -- Event 29 (Charity Fundraiser, Nov 2025): James✓ Priya✓ Sophie✓
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000029', 5, 'An 80s/90s charity night is a format that should exist more often. Everyone knows every word, the floor fills quickly, and the cause gives the evening meaning beyond the dancing. The fundraising for mental health felt genuinely right for this community.', true, '2025-11-09 10:00:00+00'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000029', 4, 'The music format was brilliantly effective — I didn''t need to think about whether to dance, the first bars of a familiar song made the decision for me. The mental health charity was a well-chosen cause and the fundraising was generously received.', true, '2025-11-09 11:00:00+00'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000029', 5, 'Started as a dancing evening and became something more. The combination of charity purpose and 90s nostalgia unlocked something in the room that straightforwardly fun events sometimes don''t reach. One of the more memorable evenings.', true, '2025-11-10 09:00:00+00'),

  -- Event 30 (Winter Wonderland, Nov 2025): Oliver✓ Marcus✓ Charlotte✓
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000030', 4, 'Winter Wonderland is better with a group who''ve agreed to enjoy it without qualification. The mulled wine was good, the lights were excessive in the correct way, and the ice rink spectating was unexpectedly entertaining. The Social Seen made it.', true, '2025-11-25 18:00:00+00'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000030', 4, 'Hyde Park in November with good company is a thoroughly pleasant way to spend a Sunday. The group''s enthusiasm for the bratwurst was noted and correct. The big wheel queue was judged worth it by those who risked it.', true, '2025-11-25 19:00:00+00'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000030', 5, 'I''ve done Winter Wonderland solo and it''s fine. I''ve done it with the Social Seen and it''s wonderful. The difference is entirely the people. The collective decision to enjoy the kitsch without apology made the whole evening.', true, '2025-11-26 10:00:00+00');

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 8: Event Photos
-- 3 photos per event for all 30 past events (events 1–30).
-- Captions are exact from prompts/seed-content-events-reviews-photos.md PART 3.
-- Unsplash URLs chosen to match each event's vibe.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.event_photos (event_id, image_url, caption, sort_order) VALUES

  -- Event 1: Fairgame gaming bar, Canary Wharf
  ('e1000000-0000-0000-0000-000000000001', 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800&h=600&fit=crop', 'The Fairgame skeeball lanes, well into the second round. The competitive instincts that London office jobs keep dormant.', 1),
  ('e1000000-0000-0000-0000-000000000001', 'https://images.unsplash.com/photo-1493711662-5e3fb2706e42?w=800&h=600&fit=crop', 'Post-gaming: twenty people, one table, pizza arriving in the shadow of Canary Wharf.', 2),
  ('e1000000-0000-0000-0000-000000000001', 'https://images.unsplash.com/photo-1579373903781-fd5c0d271a57?w=800&h=600&fit=crop', 'The Fairgame floor at capacity — neon, noise, and people who''d arrived as strangers deciding to stay another round.', 3),

  -- Event 2: London Cocktail Club, Covent Garden
  ('e1000000-0000-0000-0000-000000000002', 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800&h=600&fit=crop', 'London Cocktail Club''s signature presentation: a cocktail arriving under a dome of smoke in the Covent Garden basement.', 1),
  ('e1000000-0000-0000-0000-000000000002', 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&h=600&fit=crop', 'Thirty-five people finding their corners — the natural geometry of a first Friday in a new venue.', 2),
  ('e1000000-0000-0000-0000-000000000002', 'https://images.unsplash.com/photo-1555244162-803834f70033?w=800&h=600&fit=crop', 'Late in the evening: empty pizza plates, occupied glasses, and a room that had loosened completely.', 3),

  -- Event 3: Axe throwing, Soho
  ('e1000000-0000-0000-0000-000000000003', 'https://images.unsplash.com/photo-1569701813359-b1a17e4f09a7?w=800&h=600&fit=crop', 'First throw of the evening — technique debatable, enthusiasm unimpeachable.', 1),
  ('e1000000-0000-0000-0000-000000000003', 'https://images.unsplash.com/photo-1527529482837-4698179dc6ce?w=800&h=600&fit=crop', 'The scoreboard by hour two. Rivalries had developed. Rematches were being negotiated.', 2),
  ('e1000000-0000-0000-0000-000000000003', 'https://images.unsplash.com/photo-1551009175-8a68e0048c05?w=800&h=600&fit=crop', 'The group moves to the Soho pub: axes behind us, pints ahead, still talking about our best throws.', 3),

  -- Event 4: Stereo Bar, Covent Garden (large)
  ('e1000000-0000-0000-0000-000000000004', 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&h=600&fit=crop', 'Stereo Bar in full: seventy people across the levels, April Friday, Covent Garden below.', 1),
  ('e1000000-0000-0000-0000-000000000004', 'https://images.unsplash.com/photo-1543269824-56e32fe3e8bf?w=800&h=600&fit=crop', 'The upstairs section finding its natural clusters — the particular geometry of a large Social Seen gathering.', 2),
  ('e1000000-0000-0000-0000-000000000004', 'https://images.unsplash.com/photo-1470337458703-c5a4db6b9fd3?w=800&h=600&fit=crop', 'Late arrivals at 9pm meeting early arrivals who''d been there since 7. The introduction that started that evening''s best conversation.', 3),

  -- Event 5: LSQ rooftop, Leicester Square
  ('e1000000-0000-0000-0000-000000000005', 'https://images.unsplash.com/photo-1486325212027-8081e485255e?w=800&h=600&fit=crop', 'The LSQ terrace at golden hour — Leicester Square spread below, the Shard beyond, May light doing everything.', 1),
  ('e1000000-0000-0000-0000-000000000005', 'https://images.unsplash.com/photo-1513475382585-d06e6b793d5d?w=800&h=600&fit=crop', 'The group silhouetted against the skyline: that specific London rooftop moment.', 2),
  ('e1000000-0000-0000-0000-000000000005', 'https://images.unsplash.com/photo-1525268323-7f3e04d60e71?w=800&h=600&fit=crop', 'Cocktails and conversation, the terrace full, nobody checking their phone.', 3),

  -- Event 6: Luna Gin Bar, summer drinks
  ('e1000000-0000-0000-0000-000000000006', 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=800&h=600&fit=crop', 'The back bar at Luna: the gin selection that led to a forty-minute conversation with the bartender.', 1),
  ('e1000000-0000-0000-0000-000000000006', 'https://images.unsplash.com/photo-1519121785383-3229633bb75b?w=800&h=600&fit=crop', 'Seventy-five people in August heat — the summer gathering at its most natural.', 2),
  ('e1000000-0000-0000-0000-000000000006', 'https://images.unsplash.com/photo-1543245381-3c9a5ee69b48?w=800&h=600&fit=crop', 'Two regulars meeting a first-timer, the introduction that became the evening''s longest conversation.', 3),

  -- Event 7: Flight Club + Little Scarlett Door
  ('e1000000-0000-0000-0000-000000000007', 'https://images.unsplash.com/photo-1552508744-1696d9464346?w=800&h=600&fit=crop', 'Flight Club scoreboard at the end of round three: one team''s improbable comeback, well-documented.', 1),
  ('e1000000-0000-0000-0000-000000000007', 'https://images.unsplash.com/photo-1615066300776-f6040c0d1e85?w=800&h=600&fit=crop', 'The winning throw — a clean hit on the outer ring that settled a very serious argument.', 2),
  ('e1000000-0000-0000-0000-000000000007', 'https://images.unsplash.com/photo-1504196060547-9b793715da0b?w=800&h=600&fit=crop', 'The Little Scarlett Door: the group arrived from Flight Club and the cocktail bar absorbed them immediately.', 3),

  -- Event 8: Cotswolds weekend
  ('e1000000-0000-0000-0000-000000000008', 'https://images.unsplash.com/photo-1500534314209-a157d0e3f7c8?w=800&h=600&fit=crop', 'The Cotswolds house at dusk — stone walls, amber leaves, the kitchen window lit from inside.', 1),
  ('e1000000-0000-0000-0000-000000000008', 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&h=600&fit=crop', 'The walk: October lane, the group strung out ahead, the particular quality of English autumn light.', 2),
  ('e1000000-0000-0000-0000-000000000008', 'https://images.unsplash.com/photo-1467803738586-46b7eb7b16a1?w=800&h=600&fit=crop', 'Dinner on night one — long table, wine open, the conversation that would run until midnight.', 3),

  -- Event 9: Clapham bar crawl
  ('e1000000-0000-0000-0000-000000000009', 'https://images.unsplash.com/photo-1512053459-78f96ee0b891?w=800&h=600&fit=crop', 'Amiga Bar from the doorway: the group having claimed its corner of south London for the evening.', 1),
  ('e1000000-0000-0000-0000-000000000009', 'https://images.unsplash.com/photo-1516997121675-4c2d1696c77d?w=800&h=600&fit=crop', 'The walk between venues — Clapham on a Friday, the crowd finding its pace.', 2),
  ('e1000000-0000-0000-0000-000000000009', 'https://images.unsplash.com/photo-1550367083-9fa5411cb10b?w=800&h=600&fit=crop', 'Archers Street: the second half of the evening, the conversation by now well-established.', 3),

  -- Event 10: Snowdonia hike
  ('e1000000-0000-0000-0000-000000000010', 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop', 'The summit: twenty people, cairn, cloud, and a view that earned every step of the Watkin Path.', 1),
  ('e1000000-0000-0000-0000-000000000010', 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&h=600&fit=crop', 'Striding Edge in October: the ridge walk that made some people reconsider and others accelerate.', 2),
  ('e1000000-0000-0000-0000-000000000010', 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&h=600&fit=crop', 'The hostel table on night two — boots drying by the door, conversation continuing well past reasonable hours.', 3),

  -- Event 11: Black tie gala, Pall Mall
  ('e1000000-0000-0000-0000-000000000011', 'https://images.unsplash.com/photo-1519671282429-b44770196f4f?w=800&h=600&fit=crop', 'The room: Pall Mall in November, the portraits on the walls and the group dressed for the occasion.', 1),
  ('e1000000-0000-0000-0000-000000000011', 'https://images.unsplash.com/photo-1491438590914-bc09fcaaf77a?w=800&h=600&fit=crop', 'Arrival: the particular moment when black tie comes together — everyone looking slightly more themselves.', 2),
  ('e1000000-0000-0000-0000-000000000011', 'https://images.unsplash.com/photo-1533929736458-ca588d08c8be?w=800&h=600&fit=crop', 'After dinner: the room fully relaxed, the formality earned and then shed.', 3),

  -- Event 12: Bonfire night, Totteridge Cricket Club
  ('e1000000-0000-0000-0000-000000000012', 'https://images.unsplash.com/photo-1498931299472-f7a63a5a1cfa?w=800&h=600&fit=crop', 'The bonfire at Totteridge: proper flames, the cricket ground dark around it, the group arrayed in firelight.', 1),
  ('e1000000-0000-0000-0000-000000000012', 'https://images.unsplash.com/photo-1467623327431-4fc26a4a3ab7?w=800&h=600&fit=crop', 'Fireworks over north London from the club''s field — the sky doing the work.', 2),
  ('e1000000-0000-0000-0000-000000000012', 'https://images.unsplash.com/photo-1574757993050-bddc38e4fec0?w=800&h=600&fit=crop', 'Mulled wine at the edge of the light: November warmth, woodsmoke, good company.', 3),

  -- Event 13: Comedy night + dinner, Angel
  ('e1000000-0000-0000-0000-000000000013', 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=800&h=600&fit=crop', 'The Union Chapel comedy room: ten seats close to the stage, the intimacy that makes this format work.', 1),
  ('e1000000-0000-0000-0000-000000000013', 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=800&h=600&fit=crop', 'Post-show dinner on Upper Street: the table after the first course, the conversation well into its second chapter.', 2),
  ('e1000000-0000-0000-0000-000000000013', 'https://images.unsplash.com/photo-1544717297-fa95b6ee9643?w=800&h=600&fit=crop', 'The walk to the restaurant: Angel at night, a group of ten who''d arrived as acquaintances and left as friends.', 3),

  -- Event 14: Tate Late, Bankside
  ('e1000000-0000-0000-0000-000000000014', 'https://images.unsplash.com/photo-1578301978162-7a2ee59d7a87?w=800&h=600&fit=crop', 'The Turbine Hall at night: the installation casting light across the emptied floor, the group moving through it.', 1),
  ('e1000000-0000-0000-0000-000000000014', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&h=600&fit=crop', 'Top-floor bar, Tate Modern: the Thames in both directions, the City lit, the group occupying the view.', 2),
  ('e1000000-0000-0000-0000-000000000014', 'https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?w=800&h=600&fit=crop', 'The Seagram Murals room: two members in conversation, the Rothkos behind them doing their thing.', 3),

  -- Event 15: Christmas party, Tonteria
  ('e1000000-0000-0000-0000-000000000015', 'https://images.unsplash.com/photo-1514525253161-7a046d3edc37?w=800&h=600&fit=crop', 'Tonteria at capacity: one hundred Social Seen members, December, the year''s best evening.', 1),
  ('e1000000-0000-0000-0000-000000000015', 'https://images.unsplash.com/photo-1573878736492-a22bdacfe3d8?w=800&h=600&fit=crop', 'The long tables before the music started: cocktails, Christmas decorations, the room at its most photogenic.', 2),
  ('e1000000-0000-0000-0000-000000000015', 'https://images.unsplash.com/photo-1574957584832-e15c68d7aba9?w=800&h=600&fit=crop', 'The dancefloor by midnight: Tonteria''s basement, the Christmas party fully underway.', 3),

  -- Event 16: Crisis volunteering, Christmas Eve
  ('e1000000-0000-0000-0000-000000000016', 'https://images.unsplash.com/photo-1559027615-cd4628902d4a?w=800&h=600&fit=crop', 'The Crisis kitchen on Christmas Eve: members working the service, the purposeful quiet of a well-run operation.', 1),
  ('e1000000-0000-0000-0000-000000000016', 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?w=800&h=600&fit=crop', 'A moment between the work: two volunteers and the person they''d spent the afternoon with, at the table together.', 2),
  ('e1000000-0000-0000-0000-000000000016', 'https://images.unsplash.com/photo-1542601906-b3e4f3c91d52?w=800&h=600&fit=crop', 'Closing time at the centre: the cleared tables, the coats being collected, the particular silence of a useful afternoon.', 3),

  -- Event 17: Chinese New Year dim sum, Chinatown
  ('e1000000-0000-0000-0000-000000000017', 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800&h=600&fit=crop', 'The dim sum trolley arriving: Leong''s Legends in full Chinatown New Year form, the har gow about to be disputed.', 1),
  ('e1000000-0000-0000-0000-000000000017', 'https://images.unsplash.com/photo-1569050467447-ce54b3bbc37d?w=800&h=600&fit=crop', 'The long table: fifty members, the dishes circulating, the noise of a Chinese New Year dinner.', 2),
  ('e1000000-0000-0000-0000-000000000017', 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop', 'Chinatown from outside: the dragon dancers between the restaurant windows, the street full and bright.', 3),

  -- Event 18: Valentine's social
  ('e1000000-0000-0000-0000-000000000018', 'https://images.unsplash.com/photo-1518199266791-5375a83d677d?w=800&h=600&fit=crop', 'Valentine''s evening: the room settled, the conversations unhurried, nobody performing.', 1),
  ('e1000000-0000-0000-0000-000000000018', 'https://images.unsplash.com/photo-1511285560929-780ad36b1583?w=800&h=600&fit=crop', 'The bar: two people who''d arrived separately, now forty minutes into a conversation neither had planned.', 2),
  ('e1000000-0000-0000-0000-000000000018', 'https://images.unsplash.com/photo-1522072692836-ae7476db2440?w=800&h=600&fit=crop', 'End of evening: the table as it looked after three hours — glasses emptied and refilled, the group having found its rhythm.', 3),

  -- Event 19: Roman pizza, Breadstall
  ('e1000000-0000-0000-0000-000000000019', 'https://images.unsplash.com/photo-1565299624946-b28f40a04680?w=800&h=600&fit=crop', 'Breadstall''s counter: the Roman-style trays arriving, the selection creating immediate decisions.', 1),
  ('e1000000-0000-0000-0000-000000000019', 'https://images.unsplash.com/photo-1555396130-f8e833e2b2d8?w=800&h=600&fit=crop', 'The group over the second round of pizza: February, warm room, the conversation completely relaxed.', 2),
  ('e1000000-0000-0000-0000-000000000019', 'https://images.unsplash.com/photo-1571407970349-bc81e71e0ee9?w=800&h=600&fit=crop', 'Empty trays: the sign of an evening that went exactly as a pizza dinner should.', 3),

  -- Event 20: Ski trip, St Moritz
  ('e1000000-0000-0000-0000-000000000020', 'https://images.unsplash.com/photo-1551524559-8af4e6624178?w=800&h=600&fit=crop', 'The Engadine valley from the slopes: St Moritz below, the group at the top of the morning''s first run.', 1),
  ('e1000000-0000-0000-0000-000000000020', 'https://images.unsplash.com/photo-1457994069651-81d1de58ab82?w=800&h=600&fit=crop', 'Apres hour: fifteen people in ski boots around a table, the day''s descents being re-run in collective memory.', 2),
  ('e1000000-0000-0000-0000-000000000020', 'https://images.unsplash.com/photo-1455156700891-edd6168e70b9?w=800&h=600&fit=crop', 'The final morning: packed bags, the mountain behind us, the group photograph that earned framing.', 3),

  -- Event 21: Club night, Brixton Academy
  ('e1000000-0000-0000-0000-000000000021', 'https://images.unsplash.com/photo-1540039155194-e7c6de44bc2d?w=800&h=600&fit=crop', 'The Brixton Academy floor from the back: the crowd dense, the stage lit, Oliver Heldens mid-set.', 1),
  ('e1000000-0000-0000-0000-000000000021', 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=600&fit=crop', 'The bar at half-time: the Social Seen group reconvening, comparing floor positions.', 2),
  ('e1000000-0000-0000-0000-000000000021', 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=800&h=600&fit=crop', 'End of night: outside the Academy, the crowd dispersing into Brixton, the group still moving.', 3),

  -- Event 22: Mini golf, City of London
  ('e1000000-0000-0000-0000-000000000022', 'https://images.unsplash.com/photo-1498939559-a43f3ac26ac4?w=800&h=600&fit=crop', 'The mini golf course: City towers framed through the venue windows, a competitive group at the first hole.', 1),
  ('e1000000-0000-0000-0000-000000000022', 'https://images.unsplash.com/photo-1541971875076-8f970d573be1?w=800&h=600&fit=crop', 'The scoreboard dispute: two members calculating the outcome of a particularly contested hole.', 2),
  ('e1000000-0000-0000-0000-000000000022', 'https://images.unsplash.com/photo-1470337458703-c5a4db6b9fd3?w=800&h=600&fit=crop', 'Welcome drinks in hand: 6:30pm in the City, spring evening, the after-work crowd in good spirits.', 3),

  -- Event 23: Theatre night, Union Theatre South Bank
  ('e1000000-0000-0000-0000-000000000023', 'https://images.unsplash.com/photo-1503095396549-807759245b35?w=800&h=600&fit=crop', 'The Union Theatre arch interior: the stage in lamplight, the audience ten feet from the performers.', 1),
  ('e1000000-0000-0000-0000-000000000023', 'https://images.unsplash.com/photo-1513499938-66f574d74571?w=800&h=600&fit=crop', 'Post-show drinks: the South Bank bar, the group still processing what they''d seen.', 2),
  ('e1000000-0000-0000-0000-000000000023', 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=800&h=600&fit=crop', 'The exterior of the Union: the railway arch, the river nearby, a Tuesday in London that earned its evening.', 3),

  -- Event 24: Lake District hike
  ('e1000000-0000-0000-0000-000000000024', 'https://images.unsplash.com/photo-1530789253388-582c481c54b0?w=800&h=600&fit=crop', 'Helvellyn from Striding Edge: the ridge stretching ahead, clouds beneath, the group in single file.', 1),
  ('e1000000-0000-0000-0000-000000000024', 'https://images.unsplash.com/photo-1505118380757-91f5f5632de0?w=800&h=600&fit=crop', 'Grasmere village at lunch: the tearoom, the table, the mud on the boots, the restorative quality of good cake.', 2),
  ('e1000000-0000-0000-0000-000000000024', 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&h=600&fit=crop', 'The summit group: the Lake District spread in every direction, fifteen people and the kind of view that repays the effort.', 3),

  -- Event 25: Polo in the Park, June
  ('e1000000-0000-0000-0000-000000000025', 'https://images.unsplash.com/photo-1564979268366-f4da2e2c4d29?w=800&h=600&fit=crop', 'The polo ground in June: the pitch at half-time, the crowd on the divots, the horses at the far end.', 1),
  ('e1000000-0000-0000-0000-000000000025', 'https://images.unsplash.com/photo-1548247416-ec66f4900b2e?w=800&h=600&fit=crop', 'The divot-treading ritual: Social Seen members on the pitch at half-time, England in summer.', 2),
  ('e1000000-0000-0000-0000-000000000025', 'https://images.unsplash.com/photo-1440418084-26fa1fd97ab9?w=800&h=600&fit=crop', 'Final chukka: the game decided, the afternoon still warm, the group on the lawn.', 3),

  -- Event 26: Regent's Park picnic
  ('e1000000-0000-0000-0000-000000000026', 'https://images.unsplash.com/photo-1519072200026-b15c63e47dc8?w=800&h=600&fit=crop', 'The Regent''s Park picnic: eighty people, blankets spread, the communal spread covering three groundsheets.', 1),
  ('e1000000-0000-0000-0000-000000000026', 'https://images.unsplash.com/photo-1504384308667-08d5c4d0d3b6?w=800&h=600&fit=crop', 'Golden hour over the park: the light at its most London, the group still settled long after the afternoon had become evening.', 2),
  ('e1000000-0000-0000-0000-000000000026', 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800&h=600&fit=crop', 'The food: dishes from a dozen homes, the bring-something-to-share instruction interpreted with ambition.', 3),

  -- Event 27: End of summer, Paloma South Kensington
  ('e1000000-0000-0000-0000-000000000027', 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=800&h=600&fit=crop', 'Paloma from the bar: the South Kensington evening, the cocktails on the counter, the room full.', 1),
  ('e1000000-0000-0000-0000-000000000027', 'https://images.unsplash.com/photo-1511376777869-394efec4a871?w=800&h=600&fit=crop', 'The end-of-summer gathering: familiar faces from across the year, the community concentrated.', 2),
  ('e1000000-0000-0000-0000-000000000027', 'https://images.unsplash.com/photo-1543245381-3c9a5ee69b48?w=800&h=600&fit=crop', 'September light through the windows: the season''s last warmth, well-spent.', 3),

  -- Event 28: Halloween party, Cubanista
  ('e1000000-0000-0000-0000-000000000028', 'https://images.unsplash.com/photo-1509248961158-e54f6934749c?w=800&h=600&fit=crop', 'Cubanista''s entrance: the VIP lounge, Halloween, the Social Seen group having taken the dress code seriously.', 1),
  ('e1000000-0000-0000-0000-000000000028', 'https://images.unsplash.com/photo-1574957584832-e15c68d7aba9?w=800&h=600&fit=crop', 'The dancefloor: the transition from hip hop to R&B, the crowd moving with it.', 2),
  ('e1000000-0000-0000-0000-000000000028', 'https://images.unsplash.com/photo-1574786557568-11e4c451eb0e?w=800&h=600&fit=crop', 'The costumes: the Social Seen''s annual concession to Halloween''s creative possibilities, thoroughly documented.', 3),

  -- Event 29: 80s/90s charity fundraiser
  ('e1000000-0000-0000-0000-000000000029', 'https://images.unsplash.com/photo-1524502174522-a0b0e5f3d41a?w=800&h=600&fit=crop', 'The dancefloor mid-80s set: everyone knowing the words, the floor full in the way that only familiarity produces.', 1),
  ('e1000000-0000-0000-0000-000000000029', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&h=600&fit=crop', 'The fundraising total on the board: the community''s generosity, well-displayed.', 2),
  ('e1000000-0000-0000-0000-000000000029', 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&h=600&fit=crop', 'Late in the evening: the 90s section of the playlist, the group in full voice.', 3),

  -- Event 30: Winter Wonderland, Hyde Park
  ('e1000000-0000-0000-0000-000000000030', 'https://images.unsplash.com/photo-1519615165324-88374aa3a5b1?w=800&h=600&fit=crop', 'Winter Wonderland from the entrance: the lights, the market, the Hyde Park darkness behind it all.', 1),
  ('e1000000-0000-0000-0000-000000000030', 'https://images.unsplash.com/photo-1513297887119-d46091b24bbb?w=800&h=600&fit=crop', 'Mulled wine by the stalls: the group warming their hands, November doing its best.', 2),
  ('e1000000-0000-0000-0000-000000000030', 'https://images.unsplash.com/photo-1544889456-63a166ec6dea?w=800&h=600&fit=crop', 'The ice rink: spectating from the boards, the skaters circling, the city''s seasonal ritual in full effect.', 3);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 9: Event Hosts
-- Mitesh (a0000000-0000-0000-0000-000000000001) is host for all 33 events.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.event_hosts (event_id, profile_id, role_label, sort_order) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000017', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000019', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000022', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000023', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000025', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000026', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000027', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000028', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000029', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000001', 'Host', 1),
  ('e1000000-0000-0000-0000-000000000033', 'a0000000-0000-0000-0000-000000000001', 'Host', 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 10: Event Inclusions
-- Only added where inclusions are clearly implied by the event format.
-- Free bar meetups (events 4, 5, 6, 9, 18, 26, 27, 30, 31) have no inclusions.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.event_inclusions (event_id, label, icon, sort_order) VALUES

  -- Event 1: Fairgame gaming bar (activity + drinks)
  ('e1000000-0000-0000-0000-000000000001', 'Activity session', 'Gamepad2', 1),
  ('e1000000-0000-0000-0000-000000000001', 'Welcome drink', 'Wine', 2),

  -- Event 2: London Cocktail Club (cocktails + pizza)
  ('e1000000-0000-0000-0000-000000000002', 'House cocktails', 'Wine', 1),
  ('e1000000-0000-0000-0000-000000000002', 'Pizza included', 'Utensils', 2),

  -- Event 3: Axe throwing (activity)
  ('e1000000-0000-0000-0000-000000000003', 'Activity session', 'Target', 1),
  ('e1000000-0000-0000-0000-000000000003', 'Equipment provided', 'Shield', 2),

  -- Event 7: Flight Club + cocktail bar (activity)
  ('e1000000-0000-0000-0000-000000000007', 'Activity session', 'Target', 1),
  ('e1000000-0000-0000-0000-000000000007', 'Equipment provided', 'Shield', 2),

  -- Event 8: Cotswolds weekend (multi-day trip)
  ('e1000000-0000-0000-0000-000000000008', 'Accommodation', 'Home', 1),
  ('e1000000-0000-0000-0000-000000000008', 'Breakfast included', 'Coffee', 2),

  -- Event 10: Snowdonia hike (multi-day trip)
  ('e1000000-0000-0000-0000-000000000010', 'Accommodation', 'Home', 1),
  ('e1000000-0000-0000-0000-000000000010', 'Breakfast included', 'Coffee', 2),

  -- Event 11: Black tie gala (formal dinner)
  ('e1000000-0000-0000-0000-000000000011', 'Welcome drink', 'Wine', 1),
  ('e1000000-0000-0000-0000-000000000011', 'Three-course dinner', 'Utensils', 2),

  -- Event 12: Bonfire night (mulled wine + fireworks)
  ('e1000000-0000-0000-0000-000000000012', 'Mulled wine included', 'Wine', 1),
  ('e1000000-0000-0000-0000-000000000012', 'Fireworks display', 'Sparkles', 2),

  -- Event 13: Comedy night + dinner (ticketed show + food)
  ('e1000000-0000-0000-0000-000000000013', 'Comedy show ticket', 'Ticket', 1),
  ('e1000000-0000-0000-0000-000000000013', 'Dinner included', 'Utensils', 2),

  -- Event 14: Tate Late (gallery entry + bar)
  ('e1000000-0000-0000-0000-000000000014', 'Gallery entry', 'Building2', 1),
  ('e1000000-0000-0000-0000-000000000014', 'Top floor bar', 'Wine', 2),

  -- Event 15: Christmas party (cocktails + dancing)
  ('e1000000-0000-0000-0000-000000000015', 'Welcome cocktail', 'Wine', 1),
  ('e1000000-0000-0000-0000-000000000015', 'DJ and dancing', 'Music', 2),

  -- Event 16: Crisis volunteering (refreshments)
  ('e1000000-0000-0000-0000-000000000016', 'Refreshments provided', 'Coffee', 1),

  -- Event 17: Dim sum (sharing dishes)
  ('e1000000-0000-0000-0000-000000000017', 'Dim sum dishes', 'Utensils', 1),
  ('e1000000-0000-0000-0000-000000000017', 'Sharing platters', 'UtensilsCrossed', 2),

  -- Event 19: Roman pizza (food included)
  ('e1000000-0000-0000-0000-000000000019', 'Pizza included', 'Utensils', 1),
  ('e1000000-0000-0000-0000-000000000019', 'Sharing platters', 'UtensilsCrossed', 2),

  -- Event 20: Ski trip (multi-day, accommodation)
  ('e1000000-0000-0000-0000-000000000020', 'Accommodation', 'Home', 1),
  ('e1000000-0000-0000-0000-000000000020', 'Breakfast included', 'Coffee', 2),

  -- Event 21: Brixton Academy club night (entry)
  ('e1000000-0000-0000-0000-000000000021', 'Event entry', 'Music', 1),

  -- Event 22: Mini golf (activity + welcome drink)
  ('e1000000-0000-0000-0000-000000000022', 'Activity session', 'Flag', 1),
  ('e1000000-0000-0000-0000-000000000022', 'Welcome drink', 'Wine', 2),

  -- Event 23: Theatre night (show ticket + post-show drinks)
  ('e1000000-0000-0000-0000-000000000023', 'Show ticket', 'Ticket', 1),
  ('e1000000-0000-0000-0000-000000000023', 'Post-show drinks', 'Wine', 2),

  -- Event 24: Lake District hike (multi-day trip)
  ('e1000000-0000-0000-0000-000000000024', 'Accommodation', 'Home', 1),
  ('e1000000-0000-0000-0000-000000000024', 'Breakfast included', 'Coffee', 2),

  -- Event 25: Polo in the Park (entry + divot-treading)
  ('e1000000-0000-0000-0000-000000000025', 'Event entry', 'Ticket', 1),
  ('e1000000-0000-0000-0000-000000000025', 'Divot-treading access', 'Leaf', 2),

  -- Event 28: Halloween party (entry + VIP lounge)
  ('e1000000-0000-0000-0000-000000000028', 'Entry included', 'PartyPopper', 1),
  ('e1000000-0000-0000-0000-000000000028', 'VIP lounge access', 'Crown', 2),

  -- Event 29: Charity 80s/90s night (entry + fundraiser)
  ('e1000000-0000-0000-0000-000000000029', 'Entry included', 'Music', 1),
  ('e1000000-0000-0000-0000-000000000029', 'Fundraiser contribution', 'Heart', 2),

  -- Event 32: The Knox dinner-into-dancing (welcome drink + DJ)
  ('e1000000-0000-0000-0000-000000000032', 'Welcome drink', 'Wine', 1),
  ('e1000000-0000-0000-0000-000000000032', 'DJ and dancing', 'Music', 2),

  -- Event 33: Summer party Langan's (paid dinner event)
  ('e1000000-0000-0000-0000-000000000033', 'Welcome drink', 'Wine', 1),
  ('e1000000-0000-0000-0000-000000000033', 'Dinner included', 'Utensils', 2);

COMMIT;
