BEGIN;
CREATE FUNCTION pbms_guard_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry_parking uuid; entry_type text; allowed_type uuid; exit_parking uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.vehicle_id, OLD.vehicle_type_id, OLD.license_plate_in, OLD.entry_gate_id, OLD.entry_time) IS DISTINCT FROM (NEW.vehicle_id, NEW.vehicle_type_id, NEW.license_plate_in, NEW.entry_gate_id, NEW.entry_time) THEN
    RAISE EXCEPTION 'Session identity is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT f.parking_id, g.gate_type, f.dedicated_vehicle_type_id INTO entry_parking, entry_type, allowed_type FROM gates g JOIN floors f ON f.id=g.floor_id WHERE g.id=NEW.entry_gate_id;
  IF entry_type IS DISTINCT FROM 'Entry' OR (allowed_type IS NOT NULL AND allowed_type <> NEW.vehicle_type_id) THEN RAISE EXCEPTION 'Wrong entry gate type' USING ERRCODE='23514'; END IF;
  IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vehicles WHERE id=NEW.vehicle_id AND vehicle_type_id=NEW.vehicle_type_id AND license_plate=NEW.license_plate_in) THEN RAISE EXCEPTION 'Vehicle identity mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.actual_slot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM parking_slots WHERE id=NEW.actual_slot_id AND parking_id=entry_parking AND vehicle_type_id=NEW.vehicle_type_id AND status NOT IN ('Locked','Maintenance')) THEN RAISE EXCEPTION 'Slot does not match entry parking or type' USING ERRCODE='23514'; END IF;
  IF NEW.exit_gate_id IS NOT NULL THEN
    SELECT f.parking_id INTO exit_parking FROM gates g JOIN floors f ON f.id=g.floor_id WHERE g.id=NEW.exit_gate_id AND g.gate_type='Exit';
    IF exit_parking IS DISTINCT FROM entry_parking THEN RAISE EXCEPTION 'Wrong exit parking' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.license_plate_out IS NOT NULL AND NEW.license_plate_out<>NEW.license_plate_in THEN RAISE EXCEPTION 'Exit plate mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pbms_session_guard BEFORE INSERT OR UPDATE ON parking_sessions FOR EACH ROW EXECUTE FUNCTION pbms_guard_session();

CREATE FUNCTION pbms_guard_vehicle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (OLD.license_plate,OLD.vehicle_type_id,OLD.user_id) IS DISTINCT FROM (NEW.license_plate,NEW.vehicle_type_id,NEW.user_id) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('gate-entry',0));
    IF EXISTS(SELECT 1 FROM parking_sessions WHERE (vehicle_id=OLD.id OR license_plate_in=OLD.license_plate) AND status IN ('Active','Exception')) THEN RAISE EXCEPTION 'Vehicle is inside parking' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pbms_vehicle_guard BEFORE UPDATE OR DELETE ON vehicles FOR EACH ROW EXECUTE FUNCTION pbms_guard_vehicle();

CREATE FUNCTION pbms_guard_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='parking_slots' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('gate-entry',0));
    IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM parking_sessions WHERE actual_slot_id=OLD.id AND status IN ('Active','Exception')) AND (NEW.status<>'Occupied' OR (NEW.floor_id,NEW.parking_id,NEW.vehicle_type_id) IS DISTINCT FROM (OLD.floor_id,OLD.parking_id,OLD.vehicle_type_id)) THEN RAISE EXCEPTION 'Slot in use' USING ERRCODE='23514'; END IF;
    IF NOT EXISTS(SELECT 1 FROM floors WHERE id=NEW.floor_id AND parking_id=NEW.parking_id AND (dedicated_vehicle_type_id IS NULL OR dedicated_vehicle_type_id=NEW.vehicle_type_id)) THEN RAISE EXCEPTION 'Slot floor parking type mismatch' USING ERRCODE='23514'; END IF;
    IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM monthly_subscriptions WHERE fixed_slot_id=OLD.id AND status='Active') AND (NEW.status IN ('Available','Locked','Maintenance') OR NEW.vehicle_type_id<>OLD.vehicle_type_id OR NEW.parking_id<>OLD.parking_id) THEN RAISE EXCEPTION 'Slot assigned to subscription' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='floors' THEN
    IF (NEW.parking_id,NEW.dedicated_vehicle_type_id,NEW.is_resident) IS DISTINCT FROM (OLD.parking_id,OLD.dedicated_vehicle_type_id,OLD.is_resident) AND EXISTS(SELECT 1 FROM parking_slots WHERE floor_id=OLD.id) THEN RAISE EXCEPTION 'Floor has slots; migrate explicitly' USING ERRCODE='23514'; END IF;
    IF NEW.total_capacity < (SELECT count(*) FROM parking_slots WHERE floor_id=OLD.id) THEN RAISE EXCEPTION 'Capacity below slot count' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='gates' THEN
    IF (NEW.floor_id,NEW.gate_type) IS DISTINCT FROM (OLD.floor_id,OLD.gate_type) AND EXISTS(SELECT 1 FROM parking_sessions WHERE entry_gate_id=OLD.id OR exit_gate_id=OLD.id) THEN RAISE EXCEPTION 'Gate has session history' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pbms_slot_guard BEFORE INSERT OR UPDATE ON parking_slots FOR EACH ROW EXECUTE FUNCTION pbms_guard_catalog();
CREATE TRIGGER pbms_floor_guard BEFORE UPDATE ON floors FOR EACH ROW EXECUTE FUNCTION pbms_guard_catalog();
CREATE TRIGGER pbms_gate_guard BEFORE UPDATE ON gates FOR EACH ROW EXECUTE FUNCTION pbms_guard_catalog();
REVOKE ALL ON FUNCTION pbms_guard_session(),pbms_guard_vehicle(),pbms_guard_catalog() FROM PUBLIC;
ALTER TABLE pricing_policies ADD CONSTRAINT pricing_positive CHECK (base_price>=0 AND base_hours>0 AND extra_hour_price>=0 AND night_surcharge>=0) NOT VALID;
ALTER TABLE subscription_packages ADD CONSTRAINT package_positive CHECK (duration_months>0 AND duration_days>0 AND price>=0 AND NOT (all_parkings AND require_fixed_slot)) NOT VALID;
ALTER TABLE floors ADD CONSTRAINT floor_capacity_nonnegative CHECK (total_capacity>=0) NOT VALID;
ALTER TABLE payments ADD CONSTRAINT payment_amount_nonnegative CHECK (amount>=0) NOT VALID;
COMMIT;
