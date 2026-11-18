import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  getTableColumns,
  getTableName,
  is,
  normalizeRelation,
  SQL,
} from "drizzle-orm";
import { getTableConfig, PgDialect, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import * as models from "../src/models";

const dialect = new PgDialect();
const tables: PgTable[] = [
  models.users,
  models.profiles,
  models.doctors,
  models.doctorSchedules,
  models.doctorUnavailability,
  models.patients,
  models.appointments,
  models.aiActions,
  models.actionHistory,
  models.notifications,
  models.refreshTokens,
  models.passwordResetTokens,
  models.emailVerificationTokens,
];

function sqlText(chunk: SQL) {
  return dialect.sqlToQuery(chunk).sql;
}

function columns(table: PgTable): PgColumn[] {
  return Object.values(getTableColumns(table));
}

function fk(table: PgTable, column: string) {
  const found = getTableConfig(table).foreignKeys.filter((f) =>
    f.reference().columns.some((c) => c.name === column),
  );
  assert.equal(found.length, 1, `${getTableName(table)}.${column} has one foreign key`);
  const ref = found[0]!.reference();
  return {
    target: `${getTableName(ref.foreignTable)}.${ref.foreignColumns[0]!.name}`,
    onDelete: found[0]!.onDelete ?? "no action",
  };
}

function indexNames(table: PgTable) {
  return getTableConfig(table).indexes.map((i) => i.config.name);
}

function index(table: PgTable, name: string) {
  const found = getTableConfig(table).indexes.find((i) => i.config.name === name);
  assert.ok(found, `${getTableName(table)} has index ${name}`);
  return found.config;
}

function defaultOf(column: PgColumn): string | undefined {
  if (!column.hasDefault) return undefined;
  return is(column.default, SQL) ? `sql:${sqlText(column.default)}` : JSON.stringify(column.default);
}

describe("models", () => {
  it("defines the ten ER tables plus the three auth token tables, and no others", () => {
    assert.deepEqual(tables.map(getTableName).sort(), [
      "action_history",
      "ai_actions",
      "appointments",
      "doctor_schedules",
      "doctor_unavailability",
      "doctors",
      "email_verification_tokens",
      "notifications",
      "password_reset_tokens",
      "patients",
      "profiles",
      "refresh_tokens",
      "users",
    ]);
  });

  it("enums have exactly the ER values", () => {
    assert.deepEqual(models.userRole.enumName, "user_role");
    assert.deepEqual(models.userRole.enumValues, ["admin", "receptionist", "doctor", "patient"]);
    assert.deepEqual(models.gender.enumName, "gender");
    assert.deepEqual(models.gender.enumValues, ["male", "female", "other"]);
    assert.deepEqual(models.appointmentStatus.enumName, "appointment_status");
    assert.deepEqual(models.appointmentStatus.enumValues, [
      "scheduled",
      "completed",
      "cancelled",
      "no_show",
      "rescheduled",
    ]);
    assert.deepEqual(models.actionType.enumName, "action_type");
    assert.deepEqual(models.actionType.enumValues, ["book", "reschedule", "cancel"]);
    assert.deepEqual(models.actionStatus.enumName, "action_status");
    assert.deepEqual(models.actionStatus.enumValues, ["pending", "approved", "rejected", "expired"]);
    assert.deepEqual(models.notificationType.enumName, "notification_type");
    assert.deepEqual(models.notificationType.enumValues, [
      "booked",
      "rescheduled",
      "cancelled",
      "reminder",
      "action_pending",
    ]);
  });

  it("users: login data only, case-insensitive unique email", () => {
    assert.deepEqual(columns(models.users).map((c) => c.name), [
      "id",
      "email",
      "password_hash",
      "email_verified_at",
      "created_at",
      "updated_at",
    ]);
    const idx = index(models.users, "users_email_lower_unique");
    assert.equal(idx.unique, true);
    assert.equal(idx.where, undefined);
    assert.equal(idx.columns.length, 1);
    const expr = idx.columns[0];
    assert.ok(is(expr, SQL));
    assert.equal(sqlText(expr), 'lower("users"."email")');
    assert.equal(models.users.email.isUnique, false, "uniqueness comes from the lower() index only");
  });

  it("nullable columns are exactly the ER's nullable columns", () => {
    const expected: Record<string, string[]> = {
      users: ["email_verified_at"],
      profiles: ["phone", "avatar_url"],
      doctors: [],
      doctor_schedules: [],
      doctor_unavailability: ["reason"],
      patients: ["profile_id", "email", "address", "medical_notes"],
      appointments: ["reason", "notes", "rescheduled_from"],
      ai_actions: ["doctor_id", "related_patient_id", "related_appointment_id"],
      action_history: ["ai_action_id", "approved_by", "appointment_id", "before_state"],
      notifications: ["related_appointment_id", "related_ai_action_id"],
      refresh_tokens: ["revoked_at", "replaced_by_id"],
      password_reset_tokens: ["used_at"],
      email_verification_tokens: ["used_at"],
    };
    for (const table of tables) {
      const nullable = columns(table)
        .filter((c) => !c.notNull)
        .map((c) => c.name);
      assert.deepEqual(nullable, expected[getTableName(table)], getTableName(table));
    }
  });

  it("defaults are exactly the ER's defaults", () => {
    const uuid = "sql:gen_random_uuid()";
    const now = "sql:now()";
    const expected: Record<string, Record<string, string>> = {
      users: { id: uuid, created_at: now, updated_at: now },
      profiles: { language_preference: '"en"', created_at: now, updated_at: now },
      doctors: { id: uuid, is_active: "true", created_at: now, updated_at: now },
      doctor_schedules: {
        id: uuid,
        slot_duration_minutes: "30",
        is_active: "true",
        created_at: now,
        updated_at: now,
      },
      doctor_unavailability: { id: uuid, created_at: now, updated_at: now },
      patients: { id: uuid, created_at: now, updated_at: now },
      appointments: { id: uuid, status: '"scheduled"', created_at: now, updated_at: now },
      ai_actions: { id: uuid, status: '"pending"', created_at: now, updated_at: now },
      action_history: { id: uuid, executed_at: now, created_at: now },
      notifications: { id: uuid, is_read: "false", created_at: now },
      refresh_tokens: { id: uuid, family_id: uuid, created_at: now },
      password_reset_tokens: { id: uuid, created_at: now },
      email_verification_tokens: { id: uuid, created_at: now },
    };
    for (const table of tables) {
      const actual: Record<string, string> = {};
      for (const c of columns(table)) {
        const d = defaultOf(c);
        if (d !== undefined) actual[c.name] = d;
      }
      assert.deepEqual(actual, expected[getTableName(table)], getTableName(table));
    }

    assert.equal(models.profiles.id.hasDefault, false);

    assert.equal(models.aiActions.expiresAt.hasDefault, false);

    assert.equal(models.refreshTokens.expiresAt.hasDefault, false);
    assert.equal(models.passwordResetTokens.expiresAt.hasDefault, false);
    assert.equal(models.emailVerificationTokens.expiresAt.hasDefault, false);
  });

  it("has the six ER check constraints", () => {
    const checks = tables.flatMap((t) =>
      getTableConfig(t).checks.map((c) => [c.name, sqlText(c.value)] as const),
    );
    assert.deepEqual(checks, [
      ["doctors_experience_years_check", '"doctors"."experience_years" >= 0'],
      ["doctors_consultation_fee_check", '"doctors"."consultation_fee" > 0'],
      ["doctor_schedules_day_of_week_check", '"doctor_schedules"."day_of_week" between 0 and 6'],
      ["doctor_schedules_time_order_check", '"doctor_schedules"."end_time" > "doctor_schedules"."start_time"'],
      [
        "doctor_unavailability_date_order_check",
        '"doctor_unavailability"."end_date" >= "doctor_unavailability"."start_date"',
      ],
      ["appointments_time_order_check", '"appointments"."end_time" > "appointments"."start_time"'],
    ]);
  });

  it("has exactly the approved unique constraints", () => {
    const single = tables.flatMap((t) =>
      columns(t)
        .filter((c) => c.isUnique)
        .map((c) => `${getTableName(t)}.${c.name}:${c.uniqueName}`),
    );
    assert.deepEqual(single, [
      "profiles.phone:profiles_phone_unique",
      "doctors.profile_id:doctors_profile_id_unique",
      "patients.profile_id:patients_profile_id_unique",
      "appointments.rescheduled_from:appointments_rescheduled_from_unique",
      "action_history.ai_action_id:action_history_ai_action_id_unique",
      "refresh_tokens.token_hash:refresh_tokens_token_hash_unique",
      "password_reset_tokens.token_hash:password_reset_tokens_token_hash_unique",
      "email_verification_tokens.token_hash:email_verification_tokens_token_hash_unique",
    ]);

    const composite = tables.flatMap((t) =>
      getTableConfig(t).uniqueConstraints.map(
        (u) => `${getTableName(t)}:${u.getName()}(${u.columns.map((c) => c.name).join(",")})`,
      ),
    );
    assert.deepEqual(composite, [
      "doctor_schedules:doctor_schedules_doctor_day_start_unique(doctor_id,day_of_week,start_time)",
    ]);

    const uniqueIndexes = tables.flatMap((t) =>
      getTableConfig(t)
        .indexes.filter((i) => i.config.unique)
        .map((i) => i.config.name),
    );
    assert.deepEqual(uniqueIndexes, ["users_email_lower_unique", "unique_active_doctor_slot"]);
  });

  it("reschedule link is optional one-to-one", () => {
    assert.equal(models.appointments.rescheduledFrom.notNull, false);
    assert.equal(models.appointments.rescheduledFrom.isUnique, true);
    assert.deepEqual(fk(models.appointments, "rescheduled_from"), {
      target: "appointments.id",
      onDelete: "no action",
    });
  });

  it("uses CASCADE only where approved, RESTRICT where documented, NO ACTION elsewhere", () => {
    const expected: Array<[PgTable, string, string, string]> = [
      [models.profiles, "id", "users.id", "cascade"],
      [models.doctors, "profile_id", "profiles.id", "no action"],
      [models.doctorSchedules, "doctor_id", "doctors.id", "cascade"],
      [models.doctorUnavailability, "doctor_id", "doctors.id", "cascade"],
      [models.patients, "profile_id", "profiles.id", "no action"],
      [models.appointments, "patient_id", "patients.id", "restrict"],
      [models.appointments, "doctor_id", "doctors.id", "restrict"],
      [models.appointments, "booked_by", "profiles.id", "no action"],
      [models.appointments, "rescheduled_from", "appointments.id", "no action"],
      [models.aiActions, "requested_by", "profiles.id", "no action"],
      [models.aiActions, "doctor_id", "doctors.id", "no action"],
      [models.aiActions, "related_patient_id", "patients.id", "no action"],
      [models.aiActions, "related_appointment_id", "appointments.id", "no action"],
      [models.actionHistory, "ai_action_id", "ai_actions.id", "no action"],
      [models.actionHistory, "performed_by", "profiles.id", "no action"],
      [models.actionHistory, "approved_by", "profiles.id", "no action"],
      [models.actionHistory, "appointment_id", "appointments.id", "no action"],
      [models.notifications, "user_id", "profiles.id", "no action"],
      [models.notifications, "related_appointment_id", "appointments.id", "no action"],
      [models.notifications, "related_ai_action_id", "ai_actions.id", "no action"],
      [models.refreshTokens, "user_id", "users.id", "cascade"],
      [models.refreshTokens, "replaced_by_id", "refresh_tokens.id", "no action"],
      [models.passwordResetTokens, "user_id", "users.id", "cascade"],
      [models.emailVerificationTokens, "user_id", "users.id", "cascade"],
    ];
    for (const [table, column, target, onDelete] of expected) {
      assert.deepEqual(fk(table, column), { target, onDelete }, `${getTableName(table)}.${column}`);
    }
    const total = tables.reduce((n, t) => n + getTableConfig(t).foreignKeys.length, 0);
    assert.equal(total, expected.length, "no undocumented foreign keys");
  });

  it("profiles.phone is optional, unique, with no separate phone index", () => {
    assert.equal(models.profiles.phone.isUnique, true);
    assert.equal(models.profiles.phone.notNull, false);
    assert.deepEqual(indexNames(models.profiles), ["idx_profiles_role"]);
  });

  it("partial index: one active booking per doctor slot", () => {
    const idx = index(models.appointments, "unique_active_doctor_slot");
    assert.equal(idx.unique, true);
    assert.deepEqual(
      idx.columns.map((c) => ("name" in c ? c.name : "?")),
      ["doctor_id", "appointment_date", "start_time"],
    );
    assert.ok(idx.where);
    assert.equal(sqlText(idx.where), `"appointments"."status" not in ('cancelled', 'rescheduled')`);

    for (const v of ["cancelled", "rescheduled"] as const) {
      assert.ok(models.appointmentStatus.enumValues.includes(v));
    }
  });

  it("partial index: unread notifications per user", () => {
    const idx = index(models.notifications, "idx_notifications_user_unread");
    assert.equal(idx.unique, false);
    assert.deepEqual(
      idx.columns.map((c) => ("name" in c ? c.name : "?")),
      ["user_id", "is_read"],
    );
    assert.ok(idx.where);
    assert.equal(sqlText(idx.where), '"notifications"."is_read" = false');
  });

  it("only the two documented indexes are partial", () => {
    const partial = tables.flatMap((t) =>
      getTableConfig(t)
        .indexes.filter((i) => i.config.where)
        .map((i) => i.config.name),
    );
    assert.deepEqual(partial, ["unique_active_doctor_slot", "idx_notifications_user_unread"]);
  });

  it("uses date, time, timestamptz and numeric(10,2)", () => {
    assert.equal(models.appointments.appointmentDate.getSQLType(), "date");
    assert.equal(models.appointments.startTime.getSQLType(), "time");
    assert.equal(models.doctorSchedules.endTime.getSQLType(), "time");
    assert.equal(models.doctorUnavailability.startDate.getSQLType(), "date");
    assert.equal(models.patients.dateOfBirth.getSQLType(), "date");
    assert.equal(models.aiActions.expiresAt.getSQLType(), "timestamp with time zone");
    assert.equal(models.actionHistory.executedAt.getSQLType(), "timestamp with time zone");
    assert.equal(models.doctors.consultationFee.getSQLType(), "numeric(10, 2)");
  });

  it("keeps every ER index name", () => {
    assert.deepEqual(indexNames(models.doctors), ["idx_doctors_specialization", "idx_doctors_is_active"]);
    assert.deepEqual(indexNames(models.doctorSchedules), ["idx_schedules_doctor_day"]);
    assert.deepEqual(indexNames(models.doctorUnavailability), ["idx_unavailability_doctor_dates"]);
    assert.deepEqual(indexNames(models.patients), ["idx_patients_phone", "idx_patients_name"]);
    assert.deepEqual(indexNames(models.appointments), [
      "unique_active_doctor_slot",
      "idx_appointments_patient",
      "idx_appointments_doctor_date",
      "idx_appointments_status",
      "idx_appointments_date",
    ]);
    assert.deepEqual(indexNames(models.aiActions), [
      "idx_ai_actions_status",
      "idx_ai_actions_requested_by",
      "idx_ai_actions_doctor",
    ]);
    assert.deepEqual(indexNames(models.actionHistory), ["idx_history_performed_by", "idx_history_executed_at"]);
    assert.deepEqual(indexNames(models.notifications), [
      "idx_notifications_user_unread",
      "idx_notifications_ai_action",
    ]);
    assert.deepEqual(indexNames(models.refreshTokens), ["idx_refresh_tokens_user", "idx_refresh_tokens_family"]);
    assert.deepEqual(indexNames(models.passwordResetTokens), ["idx_password_reset_tokens_user"]);
    assert.deepEqual(indexNames(models.emailVerificationTokens), ["idx_email_verification_tokens_user"]);
  });

  describe("relations", () => {
    const { tables: config, tableNamesMap } = extractTablesRelationalConfig(models, createTableRelationsHelpers);

    it("every relation resolves to real columns", () => {
      let count = 0;
      for (const table of Object.values(config)) {
        for (const relation of Object.values(table.relations)) {
          const { fields, references } = normalizeRelation(config, tableNamesMap, relation);
          assert.ok(fields.length > 0 && fields.length === references.length, relation.fieldName);
          count++;
        }
      }
      assert.equal(count, 46);
    });

    it("every 'one' relation with fields matches a declared foreign key", () => {
      const declared = new Set(
        tables.flatMap((t) =>
          getTableConfig(t).foreignKeys.map((f) => {
            const r = f.reference();
            return `${getTableName(t)}.${r.columns[0]!.name}->${getTableName(r.foreignTable)}.${r.foreignColumns[0]!.name}`;
          }),
        ),
      );
      for (const table of Object.values(config)) {
        for (const relation of Object.values(table.relations)) {
          const cfg = (relation as { config?: { fields?: PgColumn[]; references?: PgColumn[] } }).config;
          if (!cfg?.fields || !cfg.references) continue;
          const key = `${getTableName(relation.sourceTable as PgTable)}.${cfg.fields[0]!.name}->${getTableName(relation.referencedTable as PgTable)}.${cfg.references[0]!.name}`;
          assert.ok(declared.has(key), `${relation.fieldName}: ${key}`);
        }
      }
    });

    it("appointments has rescheduledFrom and no rescheduledTo", () => {
      const rel = config.appointments!.relations;
      assert.ok(rel.rescheduledFrom);
      assert.equal(rel.rescheduledTo, undefined);
      const { fields, references } = normalizeRelation(config, tableNamesMap, rel.rescheduledFrom);
      assert.deepEqual(
        [fields[0]!.name, references[0]!.name],
        ["rescheduled_from", "id"],
      );
    });

    it("action_history has one-to-one aiAction and two named profile links", () => {
      const rel = config.actionHistory!.relations;
      assert.equal(rel.performedBy!.relationName, "history_performed_by");
      assert.equal(rel.approvedBy!.relationName, "history_approved_by");
      const aiActionSide = config.aiActions!.relations.history!;
      assert.equal(aiActionSide.constructor.name, "One");
    });
  });
});

type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assertType = <T extends true>() => undefined as unknown as T;

assertType<
  Equal<
    RequiredKeys<models.NewAppointment>,
    "patientId" | "doctorId" | "appointmentDate" | "startTime" | "endTime" | "bookedBy"
  >
>();
assertType<Equal<RequiredKeys<models.NewUser>, "email" | "passwordHash">>();
assertType<Equal<RequiredKeys<models.NewRefreshToken>, "userId" | "tokenHash" | "expiresAt">>();
assertType<Equal<RequiredKeys<models.NewPasswordResetToken>, "userId" | "tokenHash" | "expiresAt">>();
assertType<Equal<models.Profile["phone"], string | null>>();
assertType<Equal<models.Doctor["consultationFee"], string>>();
assertType<Equal<models.Appointment["appointmentDate"], string>>();
assertType<Equal<models.Appointment["rescheduledFrom"], string | null>>();
assertType<Equal<models.AiAction["expiresAt"], Date>>();
assertType<
  Equal<
    RequiredKeys<models.NewAiAction>,
    "actionType" | "requestedBy" | "payload" | "aiSummary" | "userInput" | "expiresAt"
  >
>();
