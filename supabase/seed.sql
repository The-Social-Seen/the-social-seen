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

INSERT INTO public.events (
  id, slug, title, description, short_description,
  date_time, end_time, venue_name, venue_address,
  category, price, capacity, image_url, dress_code,
  is_published, is_cancelled
) VALUES

-- ── Upcoming Events ──────────────────────────────────────────────────────────

-- Event 01: Wine & Wisdom — SOLD OUT (capacity 6, will fill with bookings)
(
  'e1000000-0000-0000-0000-000000000001',
  'wine-and-wisdom-borough-market',
  'Wine & Wisdom at Borough Market',
  'Join us beneath the ancient railway arches of Borough Market for an intimate guided wine tasting led by Master of Wine, Elena Vasquez. Six carefully selected wines from emerging European producers — each one a story of craft, terroir, and the people behind the bottle. You''ll taste alongside a small group of 20 fellow professionals, guided through tasting notes, food pairing, and the art of finding the wine that surprises you. Artisan cheese and charcuterie board included. Take home a tasting notes card and a recommendation list curated by Elena.',
  'Six guided wine flights beneath Borough Market''s iconic arches, hosted by a Master of Wine. Cheese board included.',
  '2026-04-12 18:00:00+00',
  '2026-04-12 21:00:00+00',
  'The Vinopolis Wine Cellar',
  'Park Street, London SE1 9DE',
  'drinks',
  4500,
  6,
  'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80',
  'Smart Casual',
  true, false
),

-- Event 02: Chef's Table at The Clove Club
(
  'e1000000-0000-0000-0000-000000000002',
  'chefs-table-clove-club',
  'Chef''s Table at The Clove Club',
  'An exclusive access evening at one of London''s most celebrated Michelin-starred restaurants. The Social Seen has arranged a private chef''s table experience for twelve guests — you''ll sit at the pass, watch the kitchen in full flow, and enjoy a seven-course tasting menu featuring Isaac McHale''s signature British-Nordic cooking. Each course is paired with a natural wine chosen by the head sommelier. This is a rare glimpse behind the curtain of a kitchen that has shaped modern British dining. Dress code is smart; the atmosphere is warm and unstuffy.',
  'Private chef''s table at a Michelin-starred Shoreditch restaurant. Seven courses, wine pairing, kitchen pass seating.',
  '2026-05-03 18:30:00+00',
  '2026-05-03 22:30:00+00',
  'The Clove Club',
  '380 Old Street, London EC1V 9LT',
  'dining',
  8500,
  12,
  'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80',
  'Smart',
  true, false
),

-- Event 03: Late Night at Tate Modern — FREE
(
  'e1000000-0000-0000-0000-000000000003',
  'late-night-tate-modern',
  'Late Night at Tate Modern',
  'The Tate Modern opens exclusively for Social Seen members on a Friday evening — two hours of private access to the Turbine Hall and three current exhibitions, with an expert guide who brings the context alive without the academic dryness. Afterwards, there''s a glass of wine in the Members Room overlooking the Thames and St Paul''s. This is the kind of evening London promises but rarely delivers: a famous cultural institution, a small group of curious people, and no queues. Free to attend — simply book your spot.',
  'Private after-hours access to Tate Modern with an expert art guide and drinks in the Members Room. Completely free.',
  '2026-04-26 17:30:00+00',
  '2026-04-26 20:30:00+00',
  'Tate Modern',
  'Bankside, London SE1 9TG',
  'cultural',
  0,
  30,
  'https://images.unsplash.com/photo-1569863959165-56b6a497cdaf?w=800&q=80',
  NULL,
  true, false
),

-- Event 04: Sunday Yoga & Brunch
(
  'e1000000-0000-0000-0000-000000000004',
  'sunday-yoga-brunch-hackney',
  'Sunday Yoga & Brunch in Hackney',
  'Start your Sunday properly. We''ve taken over a beautiful light-filled studio in Hackney for a 75-minute yoga flow led by certified instructor Amara Cole — the kind of class that works equally for first-timers and regulars. Afterwards, a full brunch spread: eggs every way, seasonal fruit, pastries, and freshly pressed juice. It''s a two-hour morning designed to slow you down and send you into the week feeling genuinely good. All levels welcome; mats, blocks and props provided.',
  '75-minute yoga flow followed by a full brunch spread in a light-filled Hackney studio. All levels welcome, equipment provided.',
  '2026-05-10 09:00:00+00',
  '2026-05-10 12:00:00+00',
  'The Library Wellness Studio',
  '90 Morning Lane, Hackney, London E9 6ND',
  'wellness',
  3500,
  20,
  'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=80',
  'Gym-ready',
  true, false
),

-- Event 05: Five-a-Side in Battersea Park
(
  'e1000000-0000-0000-0000-000000000005',
  'five-a-side-battersea-park',
  'Five-a-Side Football in Battersea Park',
  'A friendly five-a-side match in Battersea Park, followed by drinks at The Pump House Gallery cafe. We keep it social: no egos, no sliding tackles, mixed ability welcome. Teams are randomised on the day so you''ll meet new people rather than just playing with your usual crew. After the match there''s time to cool down, swap numbers, and decompress with a cold pint or a coffee in the park. Boots, bibs and a match ball are provided — just bring yourself and a willingness to have a go.',
  'A friendly social five-a-side match in Battersea Park, followed by drinks. Mixed ability, all welcome.',
  '2026-04-19 09:00:00+00',
  '2026-04-19 12:00:00+00',
  'Battersea Park 5-a-Side Courts',
  'Battersea Park Road, London SW8 4NW',
  'sport',
  1500,
  20,
  'https://images.unsplash.com/photo-1574623452334-1e0ac2b3ccb4?w=800&q=80',
  'Sportswear',
  true, false
),

-- Event 06: Creative Coding for Founders Workshop
(
  'e1000000-0000-0000-0000-000000000006',
  'creative-coding-founders',
  'Creative Coding for Founders',
  'You don''t need to be an engineer to understand code — you just need the right teacher. This workshop is built for non-technical founders, product managers, and operators who want to stop nodding along in engineering stand-ups and start asking better questions. In three hours, you''ll learn to read JavaScript, understand what your engineers actually mean when they say something is "hard", and build something small yourself. Taught by seasoned software engineer and ex-Monzo developer Marcus Okafor, with a focus on practical understanding over theoretical grounding. Loaner laptops available for those who need one.',
  'A hands-on coding workshop designed for non-technical founders and PMs. Build something real in three hours.',
  '2026-05-17 09:00:00+00',
  '2026-05-17 13:00:00+00',
  'Second Home',
  '68-80 Hanbury Street, London E1 5JL',
  'workshops',
  5500,
  16,
  'https://images.unsplash.com/photo-1515378791036-0648a3ef77b2?w=800&q=80',
  NULL,
  true, false
),

-- Event 07: Jazz & Cocktails at Ronnie Scott's
(
  'e1000000-0000-0000-0000-000000000007',
  'jazz-cocktails-ronnies',
  'Jazz & Cocktails at Ronnie Scott''s',
  'Ronnie Scott''s Jazz Club is a London institution — the kind of place that has hosted Miles Davis, Nina Simone, and Chet Baker. Tonight, Social Seen members have a block of reserved seats for what promises to be an extraordinary evening: the Felix Higgins Quartet, fresh from a run at the Barbican, perform an all-new set of original compositions inspired by London at night. We arrive early enough to settle in with a cocktail before the set begins. This is one for anyone who loves great music in a room where you can feel it properly.',
  'Reserved seating for the Felix Higgins Quartet at the legendary Ronnie Scott''s Jazz Club. Cocktails and live music.',
  '2026-06-06 18:30:00+00',
  '2026-06-06 23:00:00+00',
  'Ronnie Scott''s Jazz Club',
  '47 Frith Street, London W1D 4HT',
  'music',
  6500,
  18,
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&q=80',
  'Smart Casual',
  true, false
),

-- Event 08: West London Founders Circle
(
  'e1000000-0000-0000-0000-000000000008',
  'west-london-founders-circle',
  'West London Founders Circle',
  'A structured networking evening for founders, operators, and investors in the room — curated to make introductions that actually go somewhere. We use a rotating format: fifteen-minute conversations at small tables, facilitated by a host who knows everyone in the room. No pitching. No speed dating. Just honest conversation about what you''re building, what you''re struggling with, and what you''re looking for. Followed by an open drinks hour where connections can breathe. Previous members have found co-founders, early customers, and advisors through this format. If you''re building something, you should be here.',
  'A structured networking evening for London founders, operators and investors — curated conversations, no pitch decks.',
  '2026-04-23 17:30:00+00',
  '2026-04-23 21:00:00+00',
  'The Curtain Hotel',
  '45 Curtain Road, Shoreditch, London EC2A 3PT',
  'networking',
  2500,
  40,
  'https://images.unsplash.com/photo-1540317580384-e5d43616b9aa?w=800&q=80',
  'Business Casual',
  true, false
),

-- ── Past Events ───────────────────────────────────────────────────────────────

-- Event 09: Cocktail Masterclass — Speakeasy Edition (PAST)
(
  'e1000000-0000-0000-0000-000000000009',
  'cocktail-masterclass-speakeasy',
  'Cocktail Masterclass: Speakeasy Edition',
  'Step back into 1920s Soho for an evening inside one of London''s finest speakeasy bars. Our resident bar team walked guests through the history and craft of three iconic Prohibition-era cocktails: the Bee''s Knees, a Corpse Reviver, and their house signature Negroni variation using a rare barrel-aged Campari. Each guest made all three themselves — with results ranging from surprisingly excellent to memorably terrible. A genuinely fun evening in a genuinely beautiful venue. The kind of night you end up talking about for weeks.',
  'Hands-on cocktail masterclass at a genuine Soho speakeasy. Shake three Prohibition-era cocktails with the bar team.',
  '2026-03-15 18:00:00+00',
  '2026-03-15 21:00:00+00',
  'Nightjar Cocktail Bar',
  '129 City Road, London EC1V 1JB',
  'drinks',
  5500,
  20,
  'https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=800&q=80',
  'Cocktail Attire',
  true, false
),

-- Event 10: Private Dining at Sabor (PAST)
(
  'e1000000-0000-0000-0000-000000000010',
  'private-dining-sabor-six-courses',
  'Private Dining: Six Courses at Sabor',
  'Nieves Barragán Mohacho''s Sabor was named the National Restaurant Awards'' Restaurant of the Year for good reason. For this exclusive Social Seen evening, we had a private dining room — eight guests, six courses of Spanish cooking at its most brilliant, and a natural wine flight curated specifically for the menu. From jamón ibérico and Galician octopus to slow-cooked suckling pig and a Pedro Ximénez sherry trifle that nobody quite recovered from. One of those evenings that remind you why London is still one of the best cities in the world to eat in.',
  'An eight-seat private dining experience at the award-winning Sabor — six courses of extraordinary Spanish cooking.',
  '2026-03-22 18:30:00+00',
  '2026-03-22 23:00:00+00',
  'Sabor Restaurant',
  '35-37 Heddon Street, Mayfair, London W1B 4BR',
  'dining',
  9500,
  8,
  'https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=800&q=80',
  'Smart',
  true, false
),

-- ── Cancelled Event ───────────────────────────────────────────────────────────

-- Event 11: Sunrise Yoga at Primrose Hill — CANCELLED
(
  'e1000000-0000-0000-0000-000000000011',
  'sunrise-yoga-primrose-hill',
  'Sunrise Yoga at Primrose Hill',
  'An early morning yoga session at the top of Primrose Hill, as the sun rises over London. Led by certified instructor Amara Cole, this outdoor session would have been followed by a healthy breakfast at a nearby café. Unfortunately this event has been cancelled due to venue permit issues. We''re working to reschedule — affected members will be notified first.',
  'Outdoor sunrise yoga on Primrose Hill followed by a healthy breakfast. Unfortunately this event has been cancelled.',
  '2026-04-08 06:00:00+00',
  '2026-04-08 09:00:00+00',
  'Primrose Hill',
  'Primrose Hill Road, London NW3 3AX',
  'wellness',
  0,
  25,
  'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80',
  'Comfortable',
  true, true
);

-- ── Step 5: Event Hosts ──────────────────────────────────────────────────────

INSERT INTO public.event_hosts (event_id, profile_id, role_label, sort_order) VALUES
  -- Event 01: Wine & Wisdom
  ('e1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Host', 0),
  -- Event 02: Chef's Table
  ('e1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Host', 0),
  -- Event 03: Tate Modern
  ('e1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Host', 0),
  ('e1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'Co-Host', 1),
  -- Event 04: Yoga & Brunch
  ('e1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Host', 0),
  -- Event 05: Five-a-Side
  ('e1000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Host', 0),
  ('e1000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000007', 'Co-Host', 1),
  -- Event 06: Coding Workshop
  ('e1000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Host', 0),
  ('e1000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000005', 'Co-Host', 1),
  -- Event 07: Jazz
  ('e1000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'Host', 0),
  -- Event 08: Founders Circle
  ('e1000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'Host', 0),
  ('e1000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000005', 'Co-Host', 1),
  -- Event 09: Cocktail Masterclass (past)
  ('e1000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'Host', 0),
  -- Event 10: Private Dining (past)
  ('e1000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'Host', 0),
  -- Event 11: Sunrise Yoga (cancelled)
  ('e1000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'Host', 0);

-- ── Step 6: Event Inclusions ─────────────────────────────────────────────────

INSERT INTO public.event_inclusions (event_id, label, icon, sort_order) VALUES
  -- Event 01: Wine & Wisdom
  ('e1000000-0000-0000-0000-000000000001', '6 guided wine flights', 'wine', 0),
  ('e1000000-0000-0000-0000-000000000001', 'Artisan cheese & charcuterie board', 'utensils-crossed', 1),
  ('e1000000-0000-0000-0000-000000000001', 'Expert sommelier hosting', 'users', 2),
  ('e1000000-0000-0000-0000-000000000001', 'Tasting notes card to take home', 'book-open', 3),

  -- Event 02: Chef's Table
  ('e1000000-0000-0000-0000-000000000002', '7-course tasting menu', 'utensils', 0),
  ('e1000000-0000-0000-0000-000000000002', 'Natural wine pairing with each course', 'wine', 1),
  ('e1000000-0000-0000-0000-000000000002', 'Kitchen pass seating', 'chef-hat', 2),
  ('e1000000-0000-0000-0000-000000000002', 'Recipe card signed by the chef', 'book-open', 3),

  -- Event 03: Tate Modern
  ('e1000000-0000-0000-0000-000000000003', 'Private after-hours gallery access', 'star', 0),
  ('e1000000-0000-0000-0000-000000000003', 'Expert art guide included', 'book-open', 1),
  ('e1000000-0000-0000-0000-000000000003', 'Welcome drink in the Members Room', 'wine', 2),

  -- Event 04: Yoga & Brunch
  ('e1000000-0000-0000-0000-000000000004', '75-minute yoga flow with expert instruction', 'heart', 0),
  ('e1000000-0000-0000-0000-000000000004', 'Full brunch spread included', 'coffee', 1),
  ('e1000000-0000-0000-0000-000000000004', 'Mats, blocks & props provided', 'dumbbell', 2),

  -- Event 05: Five-a-Side
  ('e1000000-0000-0000-0000-000000000005', 'Pitch hire included', 'trophy', 0),
  ('e1000000-0000-0000-0000-000000000005', 'Post-match pub drinks', 'users', 1),
  ('e1000000-0000-0000-0000-000000000005', 'Bibs & match ball provided', 'zap', 2),

  -- Event 06: Coding Workshop
  ('e1000000-0000-0000-0000-000000000006', 'All course materials included', 'book-open', 0),
  ('e1000000-0000-0000-0000-000000000006', 'Loaner laptops available', 'laptop', 1),
  ('e1000000-0000-0000-0000-000000000006', 'Post-workshop drinks', 'coffee', 2),
  ('e1000000-0000-0000-0000-000000000006', 'Certificate of completion', 'star', 3),

  -- Event 07: Jazz
  ('e1000000-0000-0000-0000-000000000007', 'Welcome cocktail on arrival', 'wine', 0),
  ('e1000000-0000-0000-0000-000000000007', 'Reserved seating', 'map-pin', 1),
  ('e1000000-0000-0000-0000-000000000007', 'Live jazz from 8pm', 'music', 2),
  ('e1000000-0000-0000-0000-000000000007', 'Post-show meet & greet with the band', 'users', 3),

  -- Event 08: Founders Circle
  ('e1000000-0000-0000-0000-000000000008', 'Structured curated networking format', 'users', 0),
  ('e1000000-0000-0000-0000-000000000008', 'Light bites & open drinks bar', 'coffee', 1),
  ('e1000000-0000-0000-0000-000000000008', 'Founder spotlight presentations', 'mic', 2),
  ('e1000000-0000-0000-0000-000000000008', 'Private community Slack access', 'zap', 3),

  -- Event 09: Cocktail Masterclass (past)
  ('e1000000-0000-0000-0000-000000000009', 'Shake 3 Prohibition-era cocktails', 'wine', 0),
  ('e1000000-0000-0000-0000-000000000009', 'Professional bar tools to use', 'zap', 1),
  ('e1000000-0000-0000-0000-000000000009', 'Recipe cards to take home', 'book-open', 2),
  ('e1000000-0000-0000-0000-000000000009', 'Canapés throughout the evening', 'utensils', 3),

  -- Event 10: Private Dining (past)
  ('e1000000-0000-0000-0000-000000000010', '6-course Spanish tasting menu', 'utensils', 0),
  ('e1000000-0000-0000-0000-000000000010', 'Natural wine flight pairing', 'wine', 1),
  ('e1000000-0000-0000-0000-000000000010', 'Private dining room for 8 guests', 'map-pin', 2),
  ('e1000000-0000-0000-0000-000000000010', 'Recipe booklet to take home', 'book-open', 3),

  -- Event 11: Sunrise Yoga (cancelled)
  ('e1000000-0000-0000-0000-000000000011', 'Guided sunrise yoga session', 'heart', 0),
  ('e1000000-0000-0000-0000-000000000011', 'Healthy breakfast at Rök café', 'coffee', 1);

-- ── Step 7: Bookings ─────────────────────────────────────────────────────────
-- Note: Inserting directly (bypassing book_event RPC) for seed data.
-- past bookings for events 09 and 10 use created_at offsets to show history.

INSERT INTO public.bookings (user_id, event_id, status, waitlist_position, price_at_booking, booked_at) VALUES

  -- ── Event 01: Wine & Wisdom — SOLD OUT (capacity 6) ──────────────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000001', 'confirmed', NULL, 4500, now() - interval '15 days'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000001', 'confirmed', NULL, 4500, now() - interval '14 days'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000001', 'confirmed', NULL, 4500, now() - interval '12 days'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000001', 'confirmed', NULL, 4500, now() - interval '10 days'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000001', 'confirmed', NULL, 4500, now() - interval '9 days'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000001', 'confirmed', NULL, 4500, now() - interval '8 days'),
  -- Mitesh on the waitlist
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001', 'waitlisted', 1, 4500, now() - interval '5 days'),

  -- ── Event 02: Chef's Table ────────────────────────────────────────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'confirmed', NULL, 8500, now() - interval '7 days'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 'confirmed', NULL, 8500, now() - interval '6 days'),

  -- ── Event 03: Tate Modern (FREE) ─────────────────────────────────────────
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000003', 'confirmed', NULL, 0, now() - interval '10 days'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000003', 'confirmed', NULL, 0, now() - interval '9 days'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000003', 'confirmed', NULL, 0, now() - interval '8 days'),
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', 'confirmed', NULL, 0, now() - interval '7 days'),
  -- Sophie booked then cancelled
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000003', 'cancelled', NULL, 0, now() - interval '11 days'),

  -- ── Event 04: Yoga & Brunch ───────────────────────────────────────────────
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000004', 'confirmed', NULL, 3500, now() - interval '5 days'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000004', 'confirmed', NULL, 3500, now() - interval '4 days'),

  -- ── Event 05: Five-a-Side ─────────────────────────────────────────────────
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000005', 'confirmed', NULL, 1500, now() - interval '6 days'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000005', 'confirmed', NULL, 1500, now() - interval '5 days'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000005', 'confirmed', NULL, 1500, now() - interval '4 days'),

  -- ── Event 06: Coding Workshop ─────────────────────────────────────────────
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000006', 'confirmed', NULL, 5500, now() - interval '8 days'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000006', 'confirmed', NULL, 5500, now() - interval '6 days'),
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000006', 'confirmed', NULL, 5500, now() - interval '5 days'),

  -- ── Event 07: Jazz at Ronnie Scott's ──────────────────────────────────────
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000007', 'confirmed', NULL, 6500, now() - interval '4 days'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000007', 'confirmed', NULL, 6500, now() - interval '3 days'),
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000007', 'confirmed', NULL, 6500, now() - interval '2 days'),

  -- ── Event 08: Founders Circle ─────────────────────────────────────────────
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000008', 'confirmed', NULL, 2500, now() - interval '9 days'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000008', 'confirmed', NULL, 2500, now() - interval '8 days'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000008', 'confirmed', NULL, 2500, now() - interval '6 days'),
  ('a0000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000008', 'confirmed', NULL, 2500, now() - interval '3 days'),

  -- ── Event 09: Cocktail Masterclass (PAST) ────────────────────────────────
  ('a0000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000009', 'confirmed', NULL, 5500, now() - interval '28 days'),
  ('a0000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000009', 'confirmed', NULL, 5500, now() - interval '27 days'),
  ('a0000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000009', 'confirmed', NULL, 5500, now() - interval '26 days'),

  -- ── Event 10: Private Dining at Sabor (PAST) ─────────────────────────────
  ('a0000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000010', 'confirmed', NULL, 9500, now() - interval '21 days'),
  ('a0000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000010', 'confirmed', NULL, 9500, now() - interval '20 days'),
  ('a0000000-0000-0000-0000-000000000007', 'e1000000-0000-0000-0000-000000000010', 'confirmed', NULL, 9500, now() - interval '19 days');

-- ── Step 8: Reviews ──────────────────────────────────────────────────────────
-- Reviews only for past events. Reviewers must have had confirmed bookings.

INSERT INTO public.event_reviews (user_id, event_id, rating, review_text, is_visible) VALUES

  -- Event 09: Cocktail Masterclass — Charlotte (5★)
  (
    'a0000000-0000-0000-0000-000000000002',
    'e1000000-0000-0000-0000-000000000009',
    5,
    'What a brilliant evening — our host made three incredibly complex cocktails look effortless, then let us have a go ourselves. The Negroni variation I made at the end was genuinely the best cocktail I''ve ever tasted. The venue felt like stepping back into 1920s Soho. Already looking at next month''s event.',
    true
  ),

  -- Event 09: Cocktail Masterclass — James (4★)
  (
    'a0000000-0000-0000-0000-000000000003',
    'e1000000-0000-0000-0000-000000000009',
    4,
    'Well-organised evening in a genuinely atmospheric venue. The masterclass was educational without being overly technical, and the canapés were a lovely touch. Only slight note: could have used another 30 minutes — we''d have loved to try one more recipe. Will absolutely be back.',
    true
  ),

  -- Event 09: Cocktail Masterclass — Priya (5★)
  (
    'a0000000-0000-0000-0000-000000000004',
    'e1000000-0000-0000-0000-000000000009',
    5,
    'One of the best evenings I''ve had in London in years. The group was warm and interesting, the bar team were total pros, and somehow I managed to make a genuinely decent Paloma. Highly recommend if you want a fun, social night with people who appreciate good drinks.',
    true
  ),

  -- Event 10: Private Dining — Oliver (5★)
  (
    'a0000000-0000-0000-0000-000000000005',
    'e1000000-0000-0000-0000-000000000010',
    5,
    'Six courses that told a story — each dish slightly unexpected, each wine pairing perfectly chosen. The private dining room felt intimate without being stuffy, and the group of eight made for exactly the kind of conversation you hope for when you book something like this. Exceptional in every sense.',
    true
  ),

  -- Event 10: Private Dining — Sophie (4★)
  (
    'a0000000-0000-0000-0000-000000000006',
    'e1000000-0000-0000-0000-000000000010',
    4,
    'Beautifully executed evening. Sabor''s kitchen does remarkable things with Spanish ingredients, and the tasting menu felt celebratory without being overwrought. The only slight miss was the pacing — two courses arrived closer together than ideal. But genuinely memorable food and great company.',
    true
  ),

  -- Event 10: Private Dining — Marcus (5★)
  (
    'a0000000-0000-0000-0000-000000000007',
    'e1000000-0000-0000-0000-000000000010',
    5,
    'I''ve been to many ''networking dinners'' in London and they''re usually awkward. This was completely different — the format, the food, the curation of guests made it feel like a proper occasion. I left with three new connections and a recipe for croquetas I intend to attempt this weekend.',
    true
  );

-- ── Step 9: Event Photos ─────────────────────────────────────────────────────

INSERT INTO public.event_photos (event_id, image_url, caption, sort_order) VALUES

  -- Event 01: Wine & Wisdom
  ('e1000000-0000-0000-0000-000000000001', 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80', 'Six wines, one unforgettable evening', 0),
  ('e1000000-0000-0000-0000-000000000001', 'https://images.unsplash.com/photo-1569944031090-8b39a95b57a3?w=800&q=80', 'The Vinopolis cellar', 1),

  -- Event 02: Chef's Table
  ('e1000000-0000-0000-0000-000000000002', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80', 'The chef''s table at The Clove Club', 0),
  ('e1000000-0000-0000-0000-000000000002', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800&q=80', 'Seven courses of precision', 1),

  -- Event 03: Tate Modern
  ('e1000000-0000-0000-0000-000000000003', 'https://images.unsplash.com/photo-1569863959165-56b6a497cdaf?w=800&q=80', 'The Turbine Hall after hours', 0),
  ('e1000000-0000-0000-0000-000000000003', 'https://images.unsplash.com/photo-1536922246289-88c42f957773?w=800&q=80', 'A private view, literally', 1),
  ('e1000000-0000-0000-0000-000000000003', 'https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=800&q=80', 'Contemporary gallery opening', 2),

  -- Event 04: Yoga & Brunch
  ('e1000000-0000-0000-0000-000000000004', 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800&q=80', 'Morning flow in Hackney', 0),
  ('e1000000-0000-0000-0000-000000000004', 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&q=80', 'Finding stillness in the city', 1),

  -- Event 05: Five-a-Side
  ('e1000000-0000-0000-0000-000000000005', 'https://images.unsplash.com/photo-1574623452334-1e0ac2b3ccb4?w=800&q=80', 'Battersea Park, golden hour', 0),
  ('e1000000-0000-0000-0000-000000000005', 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=800&q=80', 'The post-match debrief', 1),

  -- Event 06: Coding Workshop
  ('e1000000-0000-0000-0000-000000000006', 'https://images.unsplash.com/photo-1515378791036-0648a3ef77b2?w=800&q=80', 'Building something real', 0),
  ('e1000000-0000-0000-0000-000000000006', 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80', 'Second Home, Spitalfields', 1),

  -- Event 07: Jazz at Ronnie Scott's
  ('e1000000-0000-0000-0000-000000000007', 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&q=80', 'Ronnie Scott''s on a Saturday night', 0),
  ('e1000000-0000-0000-0000-000000000007', 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=800&q=80', 'Felix Higgins Quartet in full flight', 1),
  ('e1000000-0000-0000-0000-000000000007', 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800&q=80', 'The room after midnight', 2),

  -- Event 08: Founders Circle
  ('e1000000-0000-0000-0000-000000000008', 'https://images.unsplash.com/photo-1540317580384-e5d43616b9aa?w=800&q=80', 'The Curtain Hotel, Shoreditch', 0),
  ('e1000000-0000-0000-0000-000000000008', 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=800&q=80', 'Connections that go somewhere', 1),

  -- Event 09: Cocktail Masterclass (past)
  ('e1000000-0000-0000-0000-000000000009', 'https://images.unsplash.com/photo-1528823872057-9c018a7a7553?w=800&q=80', 'A speakeasy evening in Soho', 0),
  ('e1000000-0000-0000-0000-000000000009', 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=800&q=80', 'Shaking things up at Nightjar', 1),
  ('e1000000-0000-0000-0000-000000000009', 'https://images.unsplash.com/photo-1566633806327-68e152aaf26d?w=800&q=80', 'The Bee''s Knees — circa 1922', 2),

  -- Event 10: Private Dining (past)
  ('e1000000-0000-0000-0000-000000000010', 'https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=800&q=80', 'Six courses of extraordinary cooking', 0),
  ('e1000000-0000-0000-0000-000000000010', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&q=80', 'The private dining room at Sabor', 1),
  ('e1000000-0000-0000-0000-000000000010', 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800&q=80', 'Suckling pig — the highlight of the evening', 2);

COMMIT;
