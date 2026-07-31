import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFacilityRental1786060800000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rental_facilities (
        id            UUID          NOT NULL DEFAULT gen_random_uuid(),
        name          VARCHAR       NOT NULL,
        description   TEXT,
        base_price    NUMERIC(15,2) NOT NULL,
        capacity      INTEGER,
        is_active     BOOLEAN       NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rental_facilities" PRIMARY KEY (id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE rental_pricing_tiers (
        id              UUID          NOT NULL DEFAULT gen_random_uuid(),
        member_category VARCHAR       NOT NULL,
        discount_type   VARCHAR       NOT NULL,
        discount_value  NUMERIC(10,2) NOT NULL,
        is_active       BOOLEAN       NOT NULL DEFAULT true,
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rental_pricing_tiers" PRIMARY KEY (id),
        CONSTRAINT "UQ_rental_pricing_tiers_member_category" UNIQUE (member_category)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE rental_addons (
        id             UUID          NOT NULL DEFAULT gen_random_uuid(),
        name           VARCHAR       NOT NULL,
        description    TEXT,
        price          NUMERIC(15,2) NOT NULL,
        caution_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        is_active      BOOLEAN       NOT NULL DEFAULT true,
        asset_id       UUID,
        created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rental_addons" PRIMARY KEY (id),
        CONSTRAINT "FK_rental_addons_asset_id" FOREIGN KEY (asset_id)
          REFERENCES assets (id) ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE TABLE rental_calendar_blocks (
        id              UUID        NOT NULL DEFAULT gen_random_uuid(),
        facility_id     UUID        NOT NULL,
        start_date_time TIMESTAMPTZ NOT NULL,
        end_date_time   TIMESTAMPTZ NOT NULL,
        reason          TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rental_calendar_blocks" PRIMARY KEY (id),
        CONSTRAINT "FK_rental_calendar_blocks_facility_id" FOREIGN KEY (facility_id)
          REFERENCES rental_facilities (id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE rental_bookings (
        id                      UUID          NOT NULL DEFAULT gen_random_uuid(),
        facility_id             UUID          NOT NULL,
        member_id               UUID          NOT NULL,
        start_date_time         TIMESTAMPTZ   NOT NULL,
        end_date_time           TIMESTAMPTZ   NOT NULL,
        status                  VARCHAR       NOT NULL DEFAULT 'PENDING',
        member_category         VARCHAR       NOT NULL,
        base_price              NUMERIC(15,2) NOT NULL,
        discount_type           VARCHAR,
        discount_value          NUMERIC(10,2),
        discount_source         VARCHAR       NOT NULL DEFAULT 'NONE',
        service_fee             NUMERIC(15,2) NOT NULL,
        caution_total           NUMERIC(15,2) NOT NULL,
        grand_total             NUMERIC(15,2) NOT NULL,
        override_discount_type  VARCHAR,
        override_discount_value NUMERIC(10,2),
        override_discount_note  TEXT,
        purpose                 TEXT,
        notes                   TEXT,
        rejection_reason        TEXT,
        created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rental_bookings" PRIMARY KEY (id),
        CONSTRAINT "FK_rental_bookings_facility_id" FOREIGN KEY (facility_id)
          REFERENCES rental_facilities (id) ON DELETE RESTRICT,
        CONSTRAINT "FK_rental_bookings_member_id" FOREIGN KEY (member_id)
          REFERENCES members (id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE rental_booking_addons (
        id           UUID          NOT NULL DEFAULT gen_random_uuid(),
        booking_id   UUID          NOT NULL,
        addon_id     UUID          NOT NULL,
        quantity     INTEGER       NOT NULL DEFAULT 1,
        unit_price   NUMERIC(15,2) NOT NULL,
        unit_caution NUMERIC(15,2) NOT NULL,
        created_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rental_booking_addons" PRIMARY KEY (id),
        CONSTRAINT "FK_rental_booking_addons_booking_id" FOREIGN KEY (booking_id)
          REFERENCES rental_bookings (id) ON DELETE CASCADE,
        CONSTRAINT "FK_rental_booking_addons_addon_id" FOREIGN KEY (addon_id)
          REFERENCES rental_addons (id) ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE rental_payments (
        id          UUID          NOT NULL DEFAULT gen_random_uuid(),
        booking_id  UUID          NOT NULL,
        type        VARCHAR       NOT NULL,
        amount      NUMERIC(15,2) NOT NULL,
        status      VARCHAR       NOT NULL DEFAULT 'PENDING',
        paid_at     TIMESTAMPTZ,
        refunded_at TIMESTAMPTZ,
        reference   VARCHAR,
        proof_url   VARCHAR,
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rental_payments" PRIMARY KEY (id),
        CONSTRAINT "FK_rental_payments_booking_id" FOREIGN KEY (booking_id)
          REFERENCES rental_bookings (id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_rental_bookings_facility_id_status" ON rental_bookings (facility_id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rental_bookings_member_id" ON rental_bookings (member_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rental_bookings_start_date_time" ON rental_bookings (start_date_time)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rental_payments_booking_id" ON rental_payments (booking_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_rental_calendar_blocks_facility_id" ON rental_calendar_blocks (facility_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rental_calendar_blocks_facility_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rental_payments_booking_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rental_bookings_start_date_time"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rental_bookings_member_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rental_bookings_facility_id_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS rental_payments`);
    await queryRunner.query(`DROP TABLE IF EXISTS rental_booking_addons`);
    await queryRunner.query(`DROP TABLE IF EXISTS rental_bookings`);
    await queryRunner.query(`DROP TABLE IF EXISTS rental_calendar_blocks`);
    await queryRunner.query(`DROP TABLE IF EXISTS rental_addons`);
    await queryRunner.query(`DROP TABLE IF EXISTS rental_pricing_tiers`);
    await queryRunner.query(`DROP TABLE IF EXISTS rental_facilities`);
  }
}
