-- Schema für das Gesundheits-Dashboard (Garmin via Missing MCP + Hevy).
-- Idempotent: kann mehrfach ausgeführt werden.
-- Schreibzugriff erfolgt ausschließlich über die Supabase-Management-API (SQL),
-- das Dashboard liest nur (RLS: nur eingeloggte Nutzer).

create table if not exists public.garmin_daily (
  date date primary key,
  -- Aktivität / Energie
  steps int, step_goal int, distance_m int,
  total_calories int, active_calories int, resting_calories int,
  floors_up numeric, floors_down numeric,
  intensity_moderate int, intensity_vigorous int,
  sedentary_seconds int, active_seconds int, highly_active_seconds int,
  -- Herz
  resting_hr int, min_hr int, max_hr int, rhr_7day_avg int,
  -- Stress
  stress_avg int, stress_max int, stress_qualifier text,
  stress_rest_pct numeric, stress_low_pct numeric, stress_medium_pct numeric, stress_high_pct numeric,
  -- Body Battery
  bb_high int, bb_low int, bb_charged int, bb_drained int, bb_at_wake int, bb_during_sleep int, bb_latest int,
  -- Atmung / SpO2 (Tag)
  spo2_avg numeric, spo2_low int, respiration_avg numeric, respiration_low numeric, respiration_high numeric,
  -- Schlaf (Nacht auf dieses Datum)
  sleep_seconds int, nap_seconds int, deep_seconds int, light_seconds int, rem_seconds int, awake_seconds int,
  awake_count int, sleep_score int, sleep_qualifier text, sleep_start timestamptz, sleep_end timestamptz,
  sleep_stress_avg numeric, sleep_rhr int, sleep_spo2_avg numeric, sleep_spo2_low int, sleep_hrv numeric,
  restless_moments int,
  -- HFV
  hrv_last_night int, hrv_weekly_avg int, hrv_5min_high int, hrv_status text, hrv_feedback text,
  -- Trainingsbereitschaft
  readiness_score int, readiness_level text, readiness_feedback text, recovery_time_hours numeric,
  readiness_sleep_pct int, readiness_recovery_pct int, readiness_load_pct int, readiness_hrv_pct int,
  readiness_stress_pct int, readiness_sleep_hist_pct int,
  -- Trainingsstatus / Last
  atl int, ctl int, tsb int, acwr numeric, acwr_status text, training_status text, fitness_trend int,
  vo2max numeric, vo2max_carried_forward boolean,
  optimal_ctl_min numeric, optimal_ctl_max numeric,
  -- Körper
  weight_kg numeric, bmi numeric, body_fat_pct numeric, body_water_pct numeric,
  muscle_mass_kg numeric, bone_mass_kg numeric,
  -- Rohdaten (pro Quelle) und Metadaten
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.garmin_activities (
  id bigint primary key,
  date date not null,
  start_time timestamptz,
  name text, type text, event_type text,
  duration_s numeric, distance_m numeric, calories numeric,
  avg_hr int, max_hr int, steps int,
  elevation_gain_m numeric, elevation_loss_m numeric,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists garmin_activities_date_idx on public.garmin_activities(date);

create table if not exists public.garmin_weekly_intensity (
  week_start date primary key,
  goal int, moderate_minutes int, vigorous_minutes int, total_minutes int,
  updated_at timestamptz not null default now()
);

create table if not exists public.hevy_workouts (
  id uuid primary key,
  title text, routine_id uuid, description text,
  start_time timestamptz not null, end_time timestamptz,
  date date generated always as ((start_time at time zone 'Europe/Vienna')::date) stored,
  duration_s int,
  exercise_count int, set_count int, working_set_count int,
  volume_kg numeric, total_reps int,
  exercises jsonb not null default '[]'::jsonb,
  hevy_updated_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists hevy_workouts_date_idx on public.hevy_workouts(date);

create table if not exists public.hevy_sets (
  workout_id uuid not null references public.hevy_workouts(id) on delete cascade,
  exercise_index int not null,
  set_index int not null,
  exercise_title text not null,
  exercise_template_id text,
  superset_id int,
  set_type text,
  weight_kg numeric, reps int, distance_m numeric, duration_s int, rpe numeric, custom_metric numeric,
  start_time timestamptz not null,
  primary key (workout_id, exercise_index, set_index)
);
create index if not exists hevy_sets_exercise_idx on public.hevy_sets(exercise_title, start_time);

create table if not exists public.sync_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  source text not null,
  range_start date, range_end date,
  rows int, note text
);

-- Row Level Security: nur eingeloggte Nutzer dürfen lesen, niemand schreibt über die API.
do $$
declare t text;
begin
  foreach t in array array['garmin_daily','garmin_activities','garmin_weekly_intensity','hevy_workouts','hevy_sets','sync_runs']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read_auth', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read_auth', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Wochen-/Monats-Hilfssichten (werden vom Dashboard genutzt, Aggregation läuft aber auch clientseitig)
create or replace view public.v_garmin_weekly as
select date_trunc('week', date)::date as week_start,
       count(*) as days,
       round(avg(steps)) as steps_avg, sum(steps) as steps_sum,
       round(avg(active_calories)) as active_cal_avg,
       round(avg(resting_hr),1) as rhr_avg,
       round(avg(hrv_last_night),1) as hrv_avg,
       round(avg(sleep_seconds)/3600.0,2) as sleep_h_avg,
       round(avg(sleep_score),1) as sleep_score_avg,
       round(avg(stress_avg),1) as stress_avg,
       round(avg(readiness_score),1) as readiness_avg,
       round(avg(weight_kg),2) as weight_avg,
       round(avg(body_fat_pct),2) as body_fat_avg
from public.garmin_daily group by 1;
grant select on public.v_garmin_weekly to authenticated;

create or replace view public.v_garmin_monthly as
select date_trunc('month', date)::date as month_start,
       count(*) as days,
       round(avg(steps)) as steps_avg, sum(steps) as steps_sum,
       round(avg(active_calories)) as active_cal_avg,
       round(avg(resting_hr),1) as rhr_avg,
       round(avg(hrv_last_night),1) as hrv_avg,
       round(avg(sleep_seconds)/3600.0,2) as sleep_h_avg,
       round(avg(sleep_score),1) as sleep_score_avg,
       round(avg(stress_avg),1) as stress_avg,
       round(avg(readiness_score),1) as readiness_avg,
       round(avg(weight_kg),2) as weight_avg,
       round(avg(body_fat_pct),2) as body_fat_avg
from public.garmin_daily group by 1;
grant select on public.v_garmin_monthly to authenticated;
