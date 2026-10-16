-- Disposable CI database only. Live reader tests themselves remain read-only.
SET NAMES utf8mb4;
CREATE TABLE checkpoint_collations (
  id VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci PRIMARY KEY,
  binary_id VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  latin_id VARCHAR(32) CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL,
  sequence_id BIGINT NOT NULL,
  updated DATETIME(6) NOT NULL
);
INSERT INTO checkpoint_collations VALUES
  ('a', 'Z', 'a', 1, '2026-01-01 00:00:00.123456'),
  ('é', 'a', 'é', 1, '2026-01-01 00:00:00.123456'),
  ('z', 'z', 'z', 1, '2026-01-01 00:00:00.123456');
