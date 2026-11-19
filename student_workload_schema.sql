--
-- PostgreSQL database dump
--

\restrict TEYDfH5qGYUo8BVlJbmGMgVDEPfy6o47T79UnvTPgirpJ5u28VJksUXxdXYtbYZ

-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: fn_prevent_circular_dependencies(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_prevent_circular_dependencies() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_cycle_detected INT := 0;
BEGIN
    WITH RECURSIVE prereq_path AS (
        SELECT td.prerequisite_task_id
        FROM task_dependencies td
        WHERE td.task_id = NEW.prerequisite_task_id

        UNION

        SELECT td.prerequisite_task_id
        FROM task_dependencies td
        JOIN prereq_path pp ON td.task_id = pp.prerequisite_task_id
    )
    SELECT COUNT(*)
    INTO v_cycle_detected
    FROM prereq_path
    WHERE prerequisite_task_id = NEW.task_id;

    IF v_cycle_detected > 0 THEN
        RAISE EXCEPTION 'Circular dependency detected: Prerequisite chain cannot form a cycle.'
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_student_tasks_after_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_student_tasks_after_insert() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF COALESCE(current_setting('app.disable_triggers', true), '0') <> '1' THEN
        PERFORM sp_calculate_workload(NEW.student_id, NOW(), NOW() + INTERVAL '14 days');
        PERFORM sp_detect_collisions(NEW.student_id);
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: fn_tasks_deadline_check(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_tasks_deadline_check() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.release_datetime IS NOT NULL AND NEW.deadline_datetime <= NEW.release_datetime THEN
        RAISE EXCEPTION 'Invalid task dates: deadline_datetime must be strictly after release_datetime.'
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: sp_assign_task_to_students(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sp_assign_task_to_students(p_task_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_course_semester INT;
    v_count INT;
BEGIN
    SELECT c.semester
    INTO v_course_semester
    FROM tasks t
    JOIN courses c ON t.course_id = c.course_id
    WHERE t.task_id = p_task_id;

    INSERT INTO student_tasks (student_id, task_id, assigned_at, status, actual_hours, completion_percentage)
    SELECT s.student_id, p_task_id, NOW(), 'assigned', 0.00, 0.00
    FROM students s
    WHERE s.semester = v_course_semester
    ON CONFLICT (student_id, task_id) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: workload_analysis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workload_analysis (
    analysis_id integer NOT NULL,
    student_id integer NOT NULL,
    start_datetime timestamp with time zone,
    end_datetime timestamp with time zone,
    total_estimated_hours numeric(7,2),
    available_hours numeric(7,2),
    temporal_pressure numeric(5,2),
    workload_pressure numeric(5,2),
    cognitive_pressure numeric(5,2),
    assessment_pressure numeric(5,2),
    dependency_pressure numeric(5,2),
    overall_risk_score numeric(5,2),
    risk_level character varying(30),
    calculated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sp_calculate_workload(integer, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sp_calculate_workload(p_student_id integer, p_start_dt timestamp with time zone DEFAULT NULL::timestamp with time zone, p_end_dt timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS public.workload_analysis
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_window_days          INT := 14;
    v_total_tasks          INT := 0;
    v_total_estimated      NUMERIC(7,2) := 0;
    v_logged_hours         NUMERIC(7,2) := 0;
    v_available_hours      NUMERIC(7,2) := 0;
    v_effective_available  NUMERIC(7,2) := 1;
    v_raw_cog_diff         NUMERIC(7,2) := 0;
    v_raw_weight           NUMERIC(7,2) := 0;
    v_unfinished_prereqs   INT := 0;

    v_temporal    NUMERIC(5,2) := 0;
    v_workload    NUMERIC(5,2) := 0;
    v_cognitive   NUMERIC(5,2) := 0;
    v_assessment  NUMERIC(5,2) := 0;
    v_dependency  NUMERIC(5,2) := 0;
    v_overall     NUMERIC(5,2) := 0;
    v_risk_level  VARCHAR(30)  := 'LOW';

    v_row workload_analysis;
BEGIN
    -- Normalize date window defaults
    p_start_dt := COALESCE(p_start_dt, NOW());
    p_end_dt   := COALESCE(p_end_dt, p_start_dt + INTERVAL '14 days');

    v_window_days := GREATEST(1, p_end_dt::date - p_start_dt::date);

    -- Uncompleted tasks due in window
    SELECT
        COUNT(*),
        COALESCE(SUM(COALESCE(t.estimated_hours, 5.00)
                     * (1.00 - ROUND(COALESCE(st.completion_percentage, 0) / 100.00, 6))), 0),
        COALESCE(AVG(COALESCE(t.cognitive_load, 3) * COALESCE(t.difficulty_level, 3)), 0),
        COALESCE(SUM(COALESCE(t.assessment_weight, 0)), 0)
    INTO v_total_tasks, v_total_estimated, v_raw_cog_diff, v_raw_weight
    FROM student_tasks st
    JOIN tasks t ON st.task_id = t.task_id
    WHERE st.student_id = p_student_id
      AND st.status <> 'completed'
      AND st.completion_percentage < 100
      AND t.deadline_datetime BETWEEN p_start_dt AND p_end_dt;

    -- Logged availability overlapping the window
    SELECT COALESCE(SUM(available_hours), 0)
    INTO v_logged_hours
    FROM availability
    WHERE student_id = p_student_id
      AND start_datetime < p_end_dt
      AND end_datetime   > p_start_dt;

    -- Use logged hours if any; otherwise assume a 4 hour/day baseline
    IF v_logged_hours > 0 THEN
        v_available_hours := v_logged_hours;
    ELSE
        v_available_hours := v_window_days * 4.00;
    END IF;
    v_effective_available := GREATEST(1.00, v_available_hours);

    -- 1. Temporal: deadlines/week; 5 per week = 100
    v_temporal := LEAST(100.00, ROUND(ROUND(v_total_tasks::NUMERIC / v_window_days, 4) * 7.00 * 20.00, 2));

    -- 2. Workload: required hours vs available hours
    v_workload := LEAST(100.00, ROUND(ROUND(v_total_estimated / v_effective_available, 6) * 100.00, 2));

    -- 3. Cognitive: avg(cog 1-10 x diff 1-5), max product 50 scaled to 100
    v_cognitive := LEAST(100.00, ROUND(ROUND(v_raw_cog_diff / 50.00, 6) * 100.00, 2));

    -- 4. Assessment: sum of grade weights due in window
    v_assessment := LEAST(100.00, ROUND(v_raw_weight, 2));

    -- 5. Dependency: unfinished prerequisites for tasks due in window
    SELECT COUNT(*)
    INTO v_unfinished_prereqs
    FROM task_dependencies td
    JOIN student_tasks st_due ON td.task_id = st_due.task_id
    JOIN tasks t_due          ON st_due.task_id = t_due.task_id
    LEFT JOIN student_tasks st_pre
           ON td.prerequisite_task_id = st_pre.task_id
          AND st_pre.student_id = p_student_id
    WHERE st_due.student_id = p_student_id
      AND st_due.status <> 'completed'
      AND st_due.completion_percentage < 100
      AND t_due.deadline_datetime BETWEEN p_start_dt AND p_end_dt
      AND (st_pre.student_task_id IS NULL
           OR st_pre.status <> 'completed'
           OR st_pre.completion_percentage < 100);

    v_dependency := LEAST(100.00, ROUND(v_unfinished_prereqs * 25.00, 2));

    -- Weighted overall score
    v_overall := LEAST(100.00, ROUND(
          0.25 * v_temporal
        + 0.30 * v_workload
        + 0.15 * v_cognitive
        + 0.20 * v_assessment
        + 0.10 * v_dependency, 2));

    v_risk_level := CASE
        WHEN v_overall < 30.00 THEN 'LOW'
        WHEN v_overall < 55.00 THEN 'MEDIUM'
        WHEN v_overall < 75.00 THEN 'HIGH'
        ELSE 'CRITICAL'
    END;

    INSERT INTO workload_analysis (
        student_id, start_datetime, end_datetime,
        total_estimated_hours, available_hours,
        temporal_pressure, workload_pressure, cognitive_pressure,
        assessment_pressure, dependency_pressure,
        overall_risk_score, risk_level, calculated_at
    ) VALUES (
        p_student_id, p_start_dt, p_end_dt,
        v_total_estimated, v_available_hours,
        v_temporal, v_workload, v_cognitive,
        v_assessment, v_dependency,
        v_overall, v_risk_level, NOW()
    )
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;


--
-- Name: sp_detect_collisions(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sp_detect_collisions(p_student_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_latest_analysis_id INT;
    v_total_est          NUMERIC(7,2) := 0;
    v_avail_hours        NUMERIC(7,2) := 0;

    rec                  RECORD;
    v_cluster_count      INT;
    v_overlap_count      INT;
    v_overlap_weight     NUMERIC(7,2);
    v_date_str           TEXT;
    v_inserted           INT := 0;
BEGIN
    -- Latest workload analysis for reference
    SELECT analysis_id, total_estimated_hours, available_hours
    INTO v_latest_analysis_id, v_total_est, v_avail_hours
    FROM workload_analysis
    WHERE student_id = p_student_id
    ORDER BY calculated_at DESC, analysis_id DESC
    LIMIT 1;

    v_total_est   := COALESCE(v_total_est, 0);
    v_avail_hours := COALESCE(v_avail_hours, 0);

    -- CHECK 1: OVERLOAD
    IF v_total_est > v_avail_hours AND v_total_est > 0 THEN
        IF NOT EXISTS (
            SELECT 1 FROM collisions
            WHERE student_id = p_student_id
              AND collision_type = 'OVERLOAD'
              AND resolved = FALSE
        ) THEN
            INSERT INTO collisions (student_id, analysis_id, collision_type, severity, description, detected_at, resolved)
            VALUES (
                p_student_id,
                v_latest_analysis_id,
                'OVERLOAD',
                CASE WHEN v_total_est >= 1.50 * v_avail_hours THEN 'HIGH' ELSE 'MEDIUM' END,
                'Workload overload: ' || v_total_est || ' required task hours exceed '
                    || v_avail_hours || ' available study hours in next 14 days.',
                NOW(),
                FALSE
            );
            v_inserted := v_inserted + 1;
        END IF;
    END IF;

    -- CHECK 2 & 3: walk future uncompleted deadlines in order
    FOR rec IN
        SELECT t.task_id, t.deadline_datetime, t.title
        FROM student_tasks st
        JOIN tasks t ON st.task_id = t.task_id
        WHERE st.student_id = p_student_id
          AND st.status <> 'completed'
          AND st.completion_percentage < 100
          AND t.deadline_datetime >= NOW()
        ORDER BY t.deadline_datetime ASC
    LOOP
        v_date_str := to_char(rec.deadline_datetime, 'YYYY-MM-DD');

        -- Deadlines within 48h starting at this one
        SELECT COUNT(*)
        INTO v_cluster_count
        FROM student_tasks st2
        JOIN tasks t2 ON st2.task_id = t2.task_id
        WHERE st2.student_id = p_student_id
          AND st2.status <> 'completed'
          AND st2.completion_percentage < 100
          AND t2.deadline_datetime >= rec.deadline_datetime
          AND t2.deadline_datetime <= rec.deadline_datetime + INTERVAL '48 hours';

        IF v_cluster_count >= 3 AND NOT EXISTS (
            SELECT 1 FROM collisions
            WHERE student_id = p_student_id
              AND collision_type = 'DEADLINE_CLUSTER'
              AND resolved = FALSE
              AND description LIKE '%' || v_date_str || '%'
        ) THEN
            INSERT INTO collisions (student_id, analysis_id, collision_type, severity, description, detected_at, resolved)
            VALUES (
                p_student_id,
                v_latest_analysis_id,
                'DEADLINE_CLUSTER',
                CASE WHEN v_cluster_count >= 4 THEN 'HIGH' ELSE 'MEDIUM' END,
                'Deadline cluster detected: ' || v_cluster_count
                    || ' deadlines fall within 48 hours starting at '
                    || to_char(rec.deadline_datetime, 'YYYY-MM-DD HH24:MI'),
                NOW(),
                FALSE
            );
            v_inserted := v_inserted + 1;
        END IF;

        -- Assessments within 24h starting at this one
        SELECT COUNT(*), COALESCE(SUM(t3.assessment_weight), 0)
        INTO v_overlap_count, v_overlap_weight
        FROM student_tasks st3
        JOIN tasks t3 ON st3.task_id = t3.task_id
        WHERE st3.student_id = p_student_id
          AND st3.status <> 'completed'
          AND st3.completion_percentage < 100
          AND t3.deadline_datetime >= rec.deadline_datetime
          AND t3.deadline_datetime <= rec.deadline_datetime + INTERVAL '24 hours';

        IF v_overlap_count >= 2 AND v_overlap_weight >= 25.00 AND NOT EXISTS (
            SELECT 1 FROM collisions
            WHERE student_id = p_student_id
              AND collision_type = 'ASSESSMENT_OVERLAP'
              AND resolved = FALSE
              AND description LIKE '%' || v_date_str || '%'
        ) THEN
            INSERT INTO collisions (student_id, analysis_id, collision_type, severity, description, detected_at, resolved)
            VALUES (
                p_student_id,
                v_latest_analysis_id,
                'ASSESSMENT_OVERLAP',
                'HIGH',
                'High assessment collision: ' || v_overlap_count
                    || ' assessments totalling ' || v_overlap_weight
                    || '% of course grades due within 24 hours of '
                    || to_char(rec.deadline_datetime, 'YYYY-MM-DD HH24:MI'),
                NOW(),
                FALSE
            );
            v_inserted := v_inserted + 1;
        END IF;
    END LOOP;

    RETURN v_inserted;
END;
$$;


--
-- Name: sp_refresh_student(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sp_refresh_student(p_student_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    PERFORM sp_calculate_workload(p_student_id, NOW(), NOW() + INTERVAL '14 days');
    PERFORM sp_detect_collisions(p_student_id);
END;
$$;


--
-- Name: simulations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.simulations (
    simulation_id integer NOT NULL,
    faculty_id integer NOT NULL,
    task_id integer NOT NULL,
    original_deadline timestamp with time zone,
    proposed_deadline timestamp with time zone,
    affected_students integer,
    original_risk numeric(5,2),
    projected_risk numeric(5,2),
    original_collisions integer,
    projected_collisions integer,
    impact_score numeric(5,2),
    recommendation character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sp_simulate_deadline_change(integer, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sp_simulate_deadline_change(p_task_id integer, p_proposed_deadline timestamp with time zone, p_faculty_id integer) RETURNS public.simulations
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_course_semester      INT;
    v_original_deadline    TIMESTAMPTZ;
    v_affected_students    INT := 0;
    v_original_risk        NUMERIC(5,2) := 0;
    v_projected_risk       NUMERIC(5,2) := 0;
    v_original_collisions  INT := 0;
    v_projected_collisions INT := 0;
    v_impact_score         NUMERIC(5,2) := 0;
    v_recommendation       VARCHAR(255);
    v_orig_clusters        INT := 0;
    v_proj_clusters        INT := 0;
    v_row                  simulations;
BEGIN
    SELECT c.semester, t.deadline_datetime
    INTO v_course_semester, v_original_deadline
    FROM tasks t
    JOIN courses c ON t.course_id = c.course_id
    WHERE t.task_id = p_task_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task % does not exist', p_task_id;
    END IF;

    SELECT COUNT(DISTINCT s.student_id)
    INTO v_affected_students
    FROM students s
    WHERE s.semester = v_course_semester;

    -- Baseline: average latest risk + unresolved collisions for the cohort
    SELECT
        COALESCE(ROUND(AVG(lw.overall_risk_score), 2), 35.00),
        COALESCE(SUM(cc.unresolved_count), 0)
    INTO v_original_risk, v_original_collisions
    FROM students s
    LEFT JOIN v_latest_workload lw ON lw.student_id = s.student_id
    LEFT JOIN (
        SELECT student_id, COUNT(*) AS unresolved_count
        FROM collisions
        WHERE resolved = FALSE
        GROUP BY student_id
    ) cc ON cc.student_id = s.student_id
    WHERE s.semester = v_course_semester;

    -- Other same-semester tasks within +/-48h of the ORIGINAL deadline
    SELECT COUNT(*)
    INTO v_orig_clusters
    FROM tasks t2
    JOIN courses c2 ON t2.course_id = c2.course_id
    WHERE c2.semester = v_course_semester
      AND t2.task_id <> p_task_id
      AND t2.deadline_datetime BETWEEN v_original_deadline - INTERVAL '48 hours'
                                   AND v_original_deadline + INTERVAL '48 hours';

    -- Other same-semester tasks within +/-48h of the PROPOSED deadline
    SELECT COUNT(*)
    INTO v_proj_clusters
    FROM tasks t3
    JOIN courses c3 ON t3.course_id = c3.course_id
    WHERE c3.semester = v_course_semester
      AND t3.task_id <> p_task_id
      AND t3.deadline_datetime BETWEEN p_proposed_deadline - INTERVAL '48 hours'
                                   AND p_proposed_deadline + INTERVAL '48 hours';

    -- Moving into a cluster raises risk 15 pts per extra clashing task
    v_projected_risk := LEAST(100.00, GREATEST(5.00, ROUND(
        v_original_risk + (v_proj_clusters - v_orig_clusters) * 15.00, 2)));

    v_projected_collisions := GREATEST(0,
        v_original_collisions + (v_proj_clusters - v_orig_clusters) * GREATEST(1, v_affected_students));

    v_impact_score := ROUND(v_projected_risk - v_original_risk, 2);

    IF v_impact_score <= -5.00 THEN
        v_recommendation := 'APPROVE: Shifting deadline relieves pressure and resolves deadline collisions.';
    ELSIF v_impact_score <= 4.00 AND v_proj_clusters < 2 THEN
        v_recommendation := 'APPROVE: Proposed deadline maintains a balanced workload with negligible impact.';
    ELSIF v_proj_clusters >= 2 OR v_impact_score >= 15.00 THEN
        v_recommendation := 'NOT RECOMMENDED: Severe collision cluster created with 3+ overlapping tasks.';
    ELSE
        v_recommendation := 'SUGGEST ALTERNATE DATE: Moderate risk increase; consider postponing by 2 to 3 days.';
    END IF;

    INSERT INTO simulations (
        faculty_id, task_id, original_deadline, proposed_deadline,
        affected_students, original_risk, projected_risk,
        original_collisions, projected_collisions,
        impact_score, recommendation, created_at
    ) VALUES (
        p_faculty_id, p_task_id, v_original_deadline, p_proposed_deadline,
        v_affected_students, v_original_risk, v_projected_risk,
        v_original_collisions, v_projected_collisions,
        v_impact_score, v_recommendation, NOW()
    )
    RETURNING * INTO v_row;

    RETURN v_row;
END;
$$;


--
-- Name: availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.availability (
    availability_id integer NOT NULL,
    student_id integer NOT NULL,
    start_datetime timestamp with time zone NOT NULL,
    end_datetime timestamp with time zone NOT NULL,
    available_hours numeric(5,2),
    availability_type character varying(50),
    CONSTRAINT chk_availability_window CHECK ((end_datetime > start_datetime))
);


--
-- Name: availability_availability_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.availability ALTER COLUMN availability_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.availability_availability_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: collisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collisions (
    collision_id integer NOT NULL,
    student_id integer NOT NULL,
    analysis_id integer,
    collision_type character varying(50),
    severity character varying(30),
    description text,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved boolean DEFAULT false NOT NULL
);


--
-- Name: collisions_collision_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.collisions ALTER COLUMN collision_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.collisions_collision_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    course_id integer NOT NULL,
    course_code character varying(50) NOT NULL,
    course_name character varying(150) NOT NULL,
    faculty_id integer,
    credits integer,
    semester integer
);


--
-- Name: courses_course_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.courses ALTER COLUMN course_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.courses_course_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: simulations_simulation_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.simulations ALTER COLUMN simulation_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.simulations_simulation_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: student_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.student_tasks (
    student_task_id integer NOT NULL,
    student_id integer NOT NULL,
    task_id integer NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(50) DEFAULT 'assigned'::character varying,
    actual_hours numeric(7,2) DEFAULT 0,
    completion_percentage numeric(5,2) DEFAULT 0,
    submitted_at timestamp with time zone,
    score numeric(5,2),
    CONSTRAINT chk_student_tasks_completion CHECK (((completion_percentage >= (0)::numeric) AND (completion_percentage <= (100)::numeric)))
);


--
-- Name: student_tasks_student_task_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.student_tasks ALTER COLUMN student_task_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.student_tasks_student_task_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: students; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.students (
    student_id integer NOT NULL,
    user_id integer NOT NULL,
    roll_no character varying(50) NOT NULL,
    program character varying(100),
    semester integer,
    section character varying(20),
    advisor_id integer
);


--
-- Name: students_student_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.students ALTER COLUMN student_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.students_student_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: task_dependencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.task_dependencies (
    dependency_id integer NOT NULL,
    task_id integer NOT NULL,
    prerequisite_task_id integer NOT NULL,
    dependency_type character varying(50),
    CONSTRAINT chk_no_self_dependency CHECK ((task_id <> prerequisite_task_id))
);


--
-- Name: task_dependencies_dependency_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.task_dependencies ALTER COLUMN dependency_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.task_dependencies_dependency_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    task_id integer NOT NULL,
    course_id integer NOT NULL,
    title character varying(200) NOT NULL,
    description text,
    task_type character varying(50),
    release_datetime timestamp with time zone,
    deadline_datetime timestamp with time zone NOT NULL,
    estimated_hours numeric(7,2),
    difficulty_level integer,
    cognitive_load integer,
    assessment_weight numeric(5,2),
    is_team_task boolean DEFAULT false NOT NULL,
    status character varying(50) DEFAULT 'active'::character varying,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_tasks_cognitive CHECK (((cognitive_load >= 1) AND (cognitive_load <= 10))),
    CONSTRAINT chk_tasks_difficulty CHECK (((difficulty_level >= 1) AND (difficulty_level <= 5))),
    CONSTRAINT chk_tasks_weight CHECK (((assessment_weight >= (0)::numeric) AND (assessment_weight <= (100)::numeric)))
);


--
-- Name: tasks_task_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.tasks ALTER COLUMN task_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.tasks_task_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    user_id integer NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_users_role CHECK (((role)::text = ANY ((ARRAY['student'::character varying, 'faculty'::character varying, 'admin'::character varying])::text[])))
);


--
-- Name: users_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.users ALTER COLUMN user_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.users_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: v_latest_workload; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_latest_workload AS
 SELECT DISTINCT ON (student_id) analysis_id,
    student_id,
    start_datetime,
    end_datetime,
    total_estimated_hours,
    available_hours,
    temporal_pressure,
    workload_pressure,
    cognitive_pressure,
    assessment_pressure,
    dependency_pressure,
    overall_risk_score,
    risk_level,
    calculated_at
   FROM public.workload_analysis
  ORDER BY student_id, analysis_id DESC;


--
-- Name: v_course_risk_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_course_risk_summary AS
 SELECT c.course_id,
    c.course_code,
    c.course_name,
    c.credits,
    c.semester,
    c.faculty_id,
    fu.username AS faculty_name,
    (count(DISTINCT t.task_id))::integer AS total_tasks,
    (count(DISTINCT s.student_id))::integer AS total_enrolled_students,
    COALESCE(round(avg(st.completion_percentage), 2), 0.00) AS avg_completion_percentage,
    COALESCE(round(avg(lw.overall_risk_score), 2), 0.00) AS avg_student_risk_score,
    (count(DISTINCT
        CASE
            WHEN ((lw.risk_level)::text = ANY ((ARRAY['HIGH'::character varying, 'CRITICAL'::character varying])::text[])) THEN s.student_id
            ELSE NULL::integer
        END))::integer AS high_risk_student_count
   FROM (((((public.courses c
     LEFT JOIN public.users fu ON ((c.faculty_id = fu.user_id)))
     LEFT JOIN public.tasks t ON ((c.course_id = t.course_id)))
     LEFT JOIN public.students s ON ((s.semester = c.semester)))
     LEFT JOIN public.student_tasks st ON (((st.task_id = t.task_id) AND (st.student_id = s.student_id))))
     LEFT JOIN public.v_latest_workload lw ON ((lw.student_id = s.student_id)))
  GROUP BY c.course_id, c.course_code, c.course_name, c.credits, c.semester, c.faculty_id, fu.username;


--
-- Name: v_high_risk_students; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_high_risk_students AS
 SELECT s.student_id,
    s.user_id,
    u.username AS student_name,
    u.email AS student_email,
    s.roll_no,
    s.program,
    s.semester,
    s.section,
    adv.username AS advisor_name,
    wa.analysis_id,
    wa.total_estimated_hours,
    wa.available_hours,
    wa.temporal_pressure,
    wa.workload_pressure,
    wa.cognitive_pressure,
    wa.assessment_pressure,
    wa.dependency_pressure,
    wa.overall_risk_score,
    wa.risk_level,
    wa.calculated_at,
    (( SELECT count(*) AS count
           FROM public.collisions col
          WHERE ((col.student_id = s.student_id) AND (col.resolved = false))))::integer AS active_collisions_count,
    (( SELECT count(*) AS count
           FROM (public.student_tasks st2
             JOIN public.tasks t2 ON ((st2.task_id = t2.task_id)))
          WHERE ((st2.student_id = s.student_id) AND ((st2.status)::text <> 'completed'::text) AND (t2.deadline_datetime >= now()))))::integer AS pending_tasks_count
   FROM (((public.students s
     JOIN public.users u ON ((s.user_id = u.user_id)))
     LEFT JOIN public.users adv ON ((s.advisor_id = adv.user_id)))
     JOIN public.v_latest_workload wa ON ((wa.student_id = s.student_id)))
  WHERE ((wa.overall_risk_score >= 55.00) OR ((wa.risk_level)::text = ANY ((ARRAY['HIGH'::character varying, 'CRITICAL'::character varying])::text[])));


--
-- Name: v_student_task_overview; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_student_task_overview AS
 SELECT st.student_task_id,
    s.student_id,
    s.roll_no,
    u.username AS student_name,
    u.email AS student_email,
    s.program,
    s.semester AS student_semester,
    s.section,
    c.course_id,
    c.course_code,
    c.course_name,
    c.faculty_id,
    fu.username AS faculty_name,
    t.task_id,
    t.title AS task_title,
    t.description AS task_description,
    t.task_type,
    t.release_datetime,
    t.deadline_datetime,
    t.estimated_hours,
    t.difficulty_level,
    t.cognitive_load,
    t.assessment_weight,
    t.is_team_task,
    t.status AS task_status,
    st.assigned_at,
    st.status AS submission_status,
    st.actual_hours,
    st.completion_percentage,
    st.submitted_at,
    st.score,
    ((t.deadline_datetime < now()) AND ((st.completion_percentage < (100)::numeric) OR ((st.status)::text <> 'completed'::text))) AS is_overdue,
    (trunc((EXTRACT(epoch FROM (t.deadline_datetime - now())) / (3600)::numeric)))::integer AS hours_until_deadline
   FROM (((((public.student_tasks st
     JOIN public.students s ON ((st.student_id = s.student_id)))
     JOIN public.users u ON ((s.user_id = u.user_id)))
     JOIN public.tasks t ON ((st.task_id = t.task_id)))
     JOIN public.courses c ON ((t.course_id = c.course_id)))
     LEFT JOIN public.users fu ON ((c.faculty_id = fu.user_id)));


--
-- Name: workload_analysis_analysis_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.workload_analysis ALTER COLUMN analysis_id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.workload_analysis_analysis_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: availability availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_pkey PRIMARY KEY (availability_id);


--
-- Name: collisions collisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collisions
    ADD CONSTRAINT collisions_pkey PRIMARY KEY (collision_id);


--
-- Name: courses courses_course_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_course_code_key UNIQUE (course_code);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (course_id);


--
-- Name: simulations simulations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulations
    ADD CONSTRAINT simulations_pkey PRIMARY KEY (simulation_id);


--
-- Name: student_tasks student_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_tasks
    ADD CONSTRAINT student_tasks_pkey PRIMARY KEY (student_task_id);


--
-- Name: students students_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (student_id);


--
-- Name: students students_roll_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_roll_no_key UNIQUE (roll_no);


--
-- Name: task_dependencies task_dependencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_dependencies
    ADD CONSTRAINT task_dependencies_pkey PRIMARY KEY (dependency_id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (task_id);


--
-- Name: student_tasks uq_student_task; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_tasks
    ADD CONSTRAINT uq_student_task UNIQUE (student_id, task_id);


--
-- Name: task_dependencies uq_task_dependency; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_dependencies
    ADD CONSTRAINT uq_task_dependency UNIQUE (task_id, prerequisite_task_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (user_id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: workload_analysis workload_analysis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workload_analysis
    ADD CONSTRAINT workload_analysis_pkey PRIMARY KEY (analysis_id);


--
-- Name: idx_availability_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_availability_student ON public.availability USING btree (student_id, start_datetime);


--
-- Name: idx_collisions_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_collisions_student ON public.collisions USING btree (student_id, resolved);


--
-- Name: idx_courses_faculty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_faculty ON public.courses USING btree (faculty_id);


--
-- Name: idx_simulations_faculty; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_simulations_faculty ON public.simulations USING btree (faculty_id, created_at DESC);


--
-- Name: idx_student_tasks_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_student_tasks_task ON public.student_tasks USING btree (task_id);


--
-- Name: idx_students_semester; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_students_semester ON public.students USING btree (semester);


--
-- Name: idx_students_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_students_user ON public.students USING btree (user_id);


--
-- Name: idx_tasks_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_course ON public.tasks USING btree (course_id);


--
-- Name: idx_tasks_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tasks_deadline ON public.tasks USING btree (deadline_datetime);


--
-- Name: idx_workload_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workload_student ON public.workload_analysis USING btree (student_id, analysis_id DESC);


--
-- Name: task_dependencies trg_prevent_circular_dependencies; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prevent_circular_dependencies BEFORE INSERT OR UPDATE OF task_id, prerequisite_task_id ON public.task_dependencies FOR EACH ROW EXECUTE FUNCTION public.fn_prevent_circular_dependencies();


--
-- Name: student_tasks trg_student_tasks_after_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_student_tasks_after_insert AFTER INSERT ON public.student_tasks FOR EACH ROW EXECUTE FUNCTION public.fn_student_tasks_after_insert();


--
-- Name: tasks trg_tasks_deadline_check; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tasks_deadline_check BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.fn_tasks_deadline_check();


--
-- Name: availability availability_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.availability
    ADD CONSTRAINT availability_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE CASCADE;


--
-- Name: collisions collisions_analysis_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collisions
    ADD CONSTRAINT collisions_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.workload_analysis(analysis_id) ON DELETE SET NULL;


--
-- Name: collisions collisions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collisions
    ADD CONSTRAINT collisions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE CASCADE;


--
-- Name: courses courses_faculty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: simulations simulations_faculty_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulations
    ADD CONSTRAINT simulations_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: simulations simulations_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulations
    ADD CONSTRAINT simulations_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(task_id) ON DELETE CASCADE;


--
-- Name: student_tasks student_tasks_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_tasks
    ADD CONSTRAINT student_tasks_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE CASCADE;


--
-- Name: student_tasks student_tasks_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.student_tasks
    ADD CONSTRAINT student_tasks_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(task_id) ON DELETE CASCADE;


--
-- Name: students students_advisor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_advisor_id_fkey FOREIGN KEY (advisor_id) REFERENCES public.users(user_id) ON DELETE SET NULL;


--
-- Name: students students_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE;


--
-- Name: task_dependencies task_dependencies_prerequisite_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_dependencies
    ADD CONSTRAINT task_dependencies_prerequisite_task_id_fkey FOREIGN KEY (prerequisite_task_id) REFERENCES public.tasks(task_id) ON DELETE CASCADE;


--
-- Name: task_dependencies task_dependencies_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.task_dependencies
    ADD CONSTRAINT task_dependencies_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.tasks(task_id) ON DELETE CASCADE;


--
-- Name: tasks tasks_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(course_id) ON DELETE CASCADE;


--
-- Name: workload_analysis workload_analysis_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workload_analysis
    ADD CONSTRAINT workload_analysis_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(student_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict TEYDfH5qGYUo8BVlJbmGMgVDEPfy6o47T79UnvTPgirpJ5u28VJksUXxdXYtbYZ

