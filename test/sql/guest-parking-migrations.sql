-- Run only against a disposable, empty PostgreSQL database:
-- psql -X -v ON_ERROR_STOP=1 -d test_database -f test/sql/guest-parking-migrations.sql
BEGIN;
CREATE TABLE public.vehicle_types (
  id UUID PRIMARY KEY,
  type_name VARCHAR(50) NOT NULL UNIQUE
);
CREATE TABLE public.parkings (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE
);
CREATE TABLE public.floors (
  id UUID PRIMARY KEY,
  parking_id UUID NOT NULL REFERENCES public.parkings(id),
  floor_name VARCHAR(50) NOT NULL UNIQUE,
  dedicated_vehicle_type_id UUID REFERENCES public.vehicle_types(id),
  total_capacity INTEGER NOT NULL,
  is_resident BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE public.parking_slots (
  id UUID PRIMARY KEY,
  parking_id UUID NOT NULL REFERENCES public.parkings(id),
  floor_id UUID NOT NULL REFERENCES public.floors(id),
  slot_code VARCHAR(15) NOT NULL,
  vehicle_type_id UUID NOT NULL REFERENCES public.vehicle_types(id),
  status VARCHAR(20) NOT NULL DEFAULT 'Available',
  assigned_user_id UUID,
  UNIQUE (parking_id, slot_code)
);
CREATE TABLE public.gates (
  id UUID PRIMARY KEY,
  floor_id UUID NOT NULL REFERENCES public.floors(id),
  gate_name VARCHAR(50) NOT NULL,
  gate_type VARCHAR(10) NOT NULL
);
-- No satellite parkings in a fresh environment: migration is a no-op.
\ir ../../prisma/migrations/20261026090000_add_guest_car_parking/migration.sql
\ir ../../prisma/migrations/20261026091000_add_guest_motorbike_parking/migration.sql
INSERT INTO public.vehicle_types VALUES
  ('550e8400-e29b-41d4-a716-446655440000', 'Xe máy'),
  ('660e8400-e29b-41d4-a716-446655440000', 'Ô tô');
INSERT INTO public.parkings VALUES
  ('a5c99101-cb76-4996-b056-720308a8929e', 'Bãi xe Bitexco'),
  ('987feae6-5995-4a7a-80e4-dc5afad353ed', 'Bãi xe FPT'),
  ('8c58456c-d1d1-44cd-b949-96d516ae4aab', 'Bãi xe Landmark 81'),
  ('fbed3285-235f-441e-ad00-0a357dcd375f', 'Bãi xe Saigon Centre'),
  ('c56a4180-65aa-42ec-a945-5fd21dec0538', 'Bãi đỗ trung tâm');
INSERT INTO public.floors
SELECT gen_random_uuid(), p.id, p.name || ' - Xe máy',
       '550e8400-e29b-41d4-a716-446655440000', 120, true
FROM public.parkings AS p;
INSERT INTO public.parking_slots
SELECT gen_random_uuid(), f.parking_id, f.id, 'BIKE-01',
       f.dedicated_vehicle_type_id, 'Occupied', NULL
FROM public.floors AS f;
INSERT INTO public.floors VALUES (
  '7ec0bd7f-11c0-43da-975e-2a8ad9ebae0b',
  'c56a4180-65aa-42ec-a945-5fd21dec0538', 'Tầng B2',
  '660e8400-e29b-41d4-a716-446655440000', 30, true
);
INSERT INTO public.parking_slots
SELECT gen_random_uuid(), 'c56a4180-65aa-42ec-a945-5fd21dec0538',
       '7ec0bd7f-11c0-43da-975e-2a8ad9ebae0b',
       'B2-C' || lpad(n::text, 2, '0'),
       '660e8400-e29b-41d4-a716-446655440000', 'Assigned',
       '11111111-2222-4333-8444-555555555555'
FROM generate_series(1, 30) AS n;
CREATE TEMP TABLE original_floors AS SELECT * FROM public.floors;
CREATE TEMP TABLE original_slots AS SELECT * FROM public.parking_slots;
\ir ../../prisma/migrations/20261026090000_add_guest_car_parking/migration.sql
CREATE TEMP TABLE existing_car_slots AS SELECT * FROM public.parking_slots;
CREATE TEMP TABLE existing_car_floors AS SELECT * FROM public.floors;
\ir ../../prisma/migrations/20261026091000_add_guest_motorbike_parking/migration.sql
DO $$
BEGIN
  IF (SELECT count(*) FROM public.floors WHERE NOT is_resident) <> 8 THEN
    RAISE EXCEPTION 'Expected four car and four motorbike guest floors';
  END IF;
  IF EXISTS (
    SELECT f.id FROM public.floors AS f
    LEFT JOIN public.parking_slots AS s ON s.floor_id = f.id
    WHERE NOT f.is_resident
    GROUP BY f.id, f.total_capacity, f.dedicated_vehicle_type_id
    HAVING count(s.id) <> CASE f.dedicated_vehicle_type_id
      WHEN '660e8400-e29b-41d4-a716-446655440000' THEN 30
      WHEN '550e8400-e29b-41d4-a716-446655440000' THEN 120
      ELSE -1 END
      OR f.total_capacity <> count(s.id)
      OR bool_or(s.parking_id <> f.parking_id OR s.vehicle_type_id <> f.dedicated_vehicle_type_id)
      OR bool_or(s.status <> 'Available')
  ) THEN
    RAISE EXCEPTION 'Expected 30 car or 120 motorbike slots per guest floor';
  END IF;
  IF EXISTS (
    SELECT f.id FROM public.floors AS f
    LEFT JOIN public.gates AS g ON g.floor_id = f.id
    WHERE NOT f.is_resident
    GROUP BY f.id
    HAVING count(*) FILTER (WHERE g.gate_type = 'Entry') <> 1
      OR count(*) FILTER (WHERE g.gate_type = 'Exit') <> 1
  ) THEN
    RAISE EXCEPTION 'Each guest floor needs one Entry and one Exit gate';
  END IF;
  IF EXISTS (SELECT * FROM original_floors EXCEPT SELECT * FROM public.floors)
    OR EXISTS (SELECT * FROM original_slots EXCEPT SELECT * FROM public.parking_slots)
    OR EXISTS (SELECT * FROM existing_car_slots EXCEPT SELECT * FROM public.parking_slots)
    OR EXISTS (SELECT * FROM existing_car_floors EXCEPT SELECT * FROM public.floors) THEN
    RAISE EXCEPTION 'Existing motorbike and resident data must stay unchanged';
  END IF;
END;
$$;
-- A repeat after manual setup must not duplicate rows or reset busy slots.
UPDATE public.parking_slots SET status = 'Occupied'
WHERE slot_code IN ('VL-C001', 'VL-M001');
CREATE TEMP TABLE first_run_slots AS SELECT * FROM public.parking_slots;
CREATE TEMP TABLE first_run_floors AS SELECT * FROM public.floors;
CREATE TEMP TABLE first_run_gates AS SELECT * FROM public.gates;
\ir ../../prisma/migrations/20261026090000_add_guest_car_parking/migration.sql
\ir ../../prisma/migrations/20261026091000_add_guest_motorbike_parking/migration.sql
DO $$
BEGIN
  IF EXISTS (SELECT * FROM first_run_slots EXCEPT SELECT * FROM public.parking_slots)
    OR EXISTS (SELECT * FROM public.parking_slots EXCEPT SELECT * FROM first_run_slots)
    OR EXISTS (SELECT * FROM first_run_floors EXCEPT SELECT * FROM public.floors)
    OR EXISTS (SELECT * FROM public.floors EXCEPT SELECT * FROM first_run_floors)
    OR EXISTS (SELECT * FROM first_run_gates EXCEPT SELECT * FROM public.gates)
    OR EXISTS (SELECT * FROM public.gates EXCEPT SELECT * FROM first_run_gates) THEN
    RAISE EXCEPTION 'Repeat must preserve rows, identities and occupancy';
  END IF;
END;
$$;
ROLLBACK;
