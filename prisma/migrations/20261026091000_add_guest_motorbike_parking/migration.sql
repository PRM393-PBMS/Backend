-- Add 120 numbered guest-motorbike slots and Entry/Exit gates to each of the four
-- existing satellite parkings. Existing motorbike, car and resident areas stay unchanged.
-- Also safe when the same data was already inserted manually in SQL Editor.
-- Parkings absent from an environment are not created by this migration.
DO $$
DECLARE
  target RECORD;
  motorbike_type_id UUID;
  guest_floor_id UUID;
  guest_capacity CONSTANT INTEGER := 120;
BEGIN
  FOR target IN
    SELECT p.id, config.floor_name
    FROM public.parkings AS p
    JOIN (
      VALUES
        ('Bãi xe Bitexco', 'Bitexco - Xe máy vãng lai'),
        ('Bãi xe FPT', 'FPT - Xe máy vãng lai'),
        ('Bãi xe Landmark 81', 'Landmark 81 - Xe máy vãng lai'),
        ('Bãi xe Saigon Centre', 'Saigon Centre - Xe máy vãng lai')
    ) AS config(parking_name, floor_name) ON p.name = config.parking_name
    ORDER BY p.id
  LOOP
    IF motorbike_type_id IS NULL THEN
      SELECT id INTO STRICT motorbike_type_id
      FROM public.vehicle_types
      WHERE lower(type_name) = lower('Xe máy');
    END IF;

    INSERT INTO public.floors (
      id, parking_id, floor_name,
      dedicated_vehicle_type_id, total_capacity, is_resident
    )
    VALUES (
      gen_random_uuid(), target.id, target.floor_name,
      motorbike_type_id, guest_capacity, false
    )
    ON CONFLICT (floor_name) DO NOTHING;

    SELECT id INTO STRICT guest_floor_id
    FROM public.floors
    WHERE parking_id = target.id
      AND floor_name = target.floor_name
      AND dedicated_vehicle_type_id = motorbike_type_id
      AND is_resident = false
      AND total_capacity >= guest_capacity;

    INSERT INTO public.parking_slots (
      id, parking_id, floor_id, slot_code, vehicle_type_id, status
    )
    SELECT
      gen_random_uuid(), target.id, guest_floor_id,
      'VL-M' || lpad(n::text, 3, '0'), motorbike_type_id, 'Available'
    FROM generate_series(1, guest_capacity) AS n
    ON CONFLICT (parking_id, slot_code) DO NOTHING;

    -- A conflicting code must not silently leave fewer than 120 guest slots.
    IF (
      SELECT count(*)
      FROM public.parking_slots
      WHERE parking_id = target.id
        AND floor_id = guest_floor_id
        AND vehicle_type_id = motorbike_type_id
        AND slot_code IN (
          SELECT 'VL-M' || lpad(n::text, 3, '0')
          FROM generate_series(1, guest_capacity) AS n
        )
    ) <> guest_capacity THEN
      RAISE EXCEPTION 'Conflicting guest-motorbike slot codes at floor %', target.floor_name;
    END IF;

    INSERT INTO public.gates (id, floor_id, gate_name, gate_type)
    SELECT
      gen_random_uuid(), guest_floor_id, g.gate_name, g.gate_type
    FROM (
      VALUES
        ('Cổng vào xe máy vãng lai', 'Entry'),
        ('Cổng ra xe máy vãng lai', 'Exit')
    ) AS g(gate_name, gate_type)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.gates AS existing
      WHERE existing.floor_id = guest_floor_id
        AND existing.gate_type = g.gate_type
    );
  END LOOP;
END;
$$;
